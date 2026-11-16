//! Quinvium Miner: Ethash mining on graphics cards.
mod cl;
mod ethash;
mod gpu;
mod nvapi;
mod rpc;
mod shader;

use rpc::Rpc;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const REPORT_PERCENT: u64 = 5;

const HELP: &str = "Quinvium Miner 2.1.0

Usage:
  quintium-miner --address 0x... [--node http://127.0.0.1:8545] [--device N|all]
  quintium-miner --list          lists graphics cards
  quintium-miner --gpu-state <0|16>  NVIDIA card performance on Windows: 0 full, 16 as the driver decides
  quintium-miner --benchmark     measures the hashrate without connecting to a node

Options:
  --address <0x...>   address that receives the reward
  --node <url>        Quinvium node (default http://127.0.0.1:8545)
  --device <N|all>    card number from the list, default all
  --backend <auto|opencl|wgpu>  how to compute, default auto (OpenCL when the card supports it)
  --intensity <10-100> power in percent, default 100
  --pool <0x...>      mine into the pool with this address, --node is then the pool server
  --worker <name>     device name in the pool, default rig
  --fallback <url,…>  backup nodes for solo mining when the main target (pool) does not respond; the miner returns once it is back
  --help              this help
";

pub struct SearchResult {
    pub hashes: u64,
    pub nonces: Vec<u64>,
}

/// One graphics card regardless of what is used to talk to it.
pub trait Card: Send {
    fn name(&self) -> String;
    fn backend(&self) -> String;
    /// Computes and verifies the epoch's DAG. `report` receives percentages.
    fn prepare(&mut self, epoch: u64, report: &dyn Fn(u32)) -> Result<(), String>;
    fn cache(&self) -> &[u32];
    fn full_size(&self) -> u64;
    /// Searches a batch of nonces from `start`. `target` is the upper 64 bits of the target.
    fn search(&mut self, header: &[u8; 32], start: u64, target: (u32, u32)) -> SearchResult;
}

/// A card found in the computer. For OpenCL a fallback is prepared in case the driver cannot handle the computation.
enum Source {
    OpenCl(cl::Gpu, Option<wgpu::Adapter>),
    Wgpu(wgpu::Adapter),
}

impl Source {
    fn label(&self) -> (String, String) {
        match self {
            Source::OpenCl(g, _) => (g.title(), "OpenCL".into()),
            Source::Wgpu(a) => {
                let i = a.get_info();
                (i.name, format!("{:?}", i.backend))
            }
        }
    }

    fn open(self) -> Result<(Box<dyn Card>, Option<wgpu::Adapter>), String> {
        match self {
            Source::OpenCl(g, fallback) => match g.open() {
                Ok(engine) => Ok((Box::new(engine), fallback)),
                Err(e) => match fallback {
                    Some(a) => {
                        eprintln!("OpenCL cannot be used: {e}");
                        Ok((Box::new(gpu::WgpuCard::open(&a)?), None))
                    }
                    None => Err(e),
                },
            },
            Source::Wgpu(a) => Ok((Box::new(gpu::WgpuCard::open(&a)?), None)),
        }
    }
}

fn discover(backend: &str) -> Vec<Source> {
    let mut adapters: Vec<Option<wgpu::Adapter>> = gpu::list_adapters().into_iter().map(Some).collect();
    let opencl = if backend == "wgpu" { Vec::new() } else { cl::list() };
    if opencl.is_empty() {
        return if backend == "opencl" { Vec::new() } else { adapters.into_iter().flatten().map(Source::Wgpu).collect() };
    }
    opencl
        .into_iter()
        .map(|g| {
            let title = g.title().to_lowercase();
            let same = adapters.iter().position(|a| a.as_ref().is_some_and(|a| title.contains(&a.get_info().name.to_lowercase()) || a.get_info().name.to_lowercase().contains(&title)));
            let fallback = same.and_then(|i| adapters[i].take());
            Source::OpenCl(g, if backend == "opencl" { None } else { fallback })
        })
        .collect()
}

#[derive(Clone)]
struct Job {
    seal: [u8; 32],
    number: u64,
    target: [u8; 32],
    /// Where this work came from and where its result goes: a pool server or the miner's own node.
    node: Arc<str>,
    pool: bool,
}

struct Shared {
    job: Mutex<Option<Job>>,
    hashes: AtomicU64,
    found: AtomicU64,
    shares: AtomicU64,
    stale: AtomicU64,
    rejected: AtomicU64,
    pool: bool,
}

fn parse_hex(s: &str) -> Result<Vec<u8>, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.len() % 2 != 0 {
        return Err("invalid hex".into());
    }
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|e| e.to_string())).collect()
}

fn hex(b: &[u8]) -> String {
    let mut s = String::from("0x");
    for x in b {
        s += &format!("{x:02x}");
    }
    s
}

fn to32(v: Vec<u8>) -> Result<[u8; 32], String> {
    v.try_into().map_err(|_| "expected 32 bytes".to_string())
}

fn parse_job(v: &Value) -> Result<Job, String> {
    let a = v.as_array().ok_or("invalid work")?;
    let text = |i: usize| a.get(i).and_then(Value::as_str).ok_or("invalid work");
    Ok(Job {
        seal: to32(parse_hex(text(0)?)?)?,
        target: to32(parse_hex(text(2)?)?)?,
        number: u64::from_str_radix(text(3)?.trim_start_matches("0x"), 16).map_err(|e| e.to_string())?,
        node: Arc::from(""),
        pool: false,
    })
}

/// RLP list items. A block header has no nested lists.
fn rlp_items(data: &[u8]) -> Option<Vec<&[u8]>> {
    let number = |bytes: &[u8]| bytes.iter().fold(0usize, |v, b| (v << 8) | *b as usize);
    let (mut p, end) = match *data.first()? {
        b @ 0xc0..=0xf7 => (1, 1 + (b - 0xc0) as usize),
        b @ 0xf8..=0xff => {
            let n = (b - 0xf7) as usize;
            (1 + n, 1 + n + number(data.get(1..1 + n)?))
        }
        _ => return None,
    };
    if end != data.len() {
        return None;
    }
    let mut out = Vec::new();
    while p < end {
        let b = data[p];
        let (start, len) = match b {
            0..=0x7f => (p, 1),
            0x80..=0xb7 => (p + 1, (b - 0x80) as usize),
            0xb8..=0xbf => {
                let n = (b - 0xb7) as usize;
                (p + 1 + n, number(data.get(p + 1..p + 1 + n)?))
            }
            _ => return None,
        };
        out.push(data.get(start..start + len)?);
        p = start + len;
    }
    Some(out)
}

/// The pool server must not slip in foreign work: the header must pay to the pool contract and carry the miner's address.
/// Thanks to this the miner sees that their hashrate does not go to someone else and does not have to trust the server.
fn check_pool_job(v: &Value, seal: &[u8; 32], pool: &[u8], miner: &[u8]) -> Result<(), String> {
    let fields = v.get(4).and_then(Value::as_str).ok_or("the server did not send the work header")?;
    let bytes = parse_hex(fields)?;
    if ethash::keccak256(&bytes) != *seal {
        return Err("the header does not match the work".into());
    }
    let items = rlp_items(&bytes).ok_or("invalid header")?;
    if items.len() != 13 || items[1] != pool {
        return Err("the work does not pay into the chosen pool".into());
    }
    if items[11].len() < 20 || &items[11][..20] != miner {
        return Err("the work does not carry the address of this miner".into());
    }
    Ok(())
}

fn format_rate(h: f64) -> String {
    if h >= 1e6 {
        format!("{:.2} MH/s", h / 1e6)
    } else if h >= 1e3 {
        format!("{:.2} kH/s", h / 1e3)
    } else {
        format!("{h:.0} H/s")
    }
}

fn seed_nonce(i: usize) -> u64 {
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1);
    (t ^ ((i as u64 + 1) << 56)).wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

fn gpu_worker(index: usize, source: Source, shared: Arc<Shared>, intensity: u32) {
    let (mut card, mut fallback) = match source.open() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[card {index}] cannot be opened: {e}");
            return;
        }
    };
    println!("[{}] backend {}", card.name(), card.backend());
    let mut ready: Option<u64> = None;
    let mut nonce = seed_nonce(index);
    let mut rpc: Option<(Arc<str>, Rpc)> = None;
    loop {
        let Some(job) = shared.job.lock().unwrap().clone() else {
            thread::sleep(Duration::from_millis(200));
            continue;
        };
        let epoch = job.number / ethash::EPOCH_LENGTH;
        if ready != Some(epoch) {
            let name = card.name();
            println!("[{name}] computing DAG for epoch {epoch}...");
            let last = AtomicU64::new(0);
            let progress = move |p: u32| {
                if p as u64 >= last.load(Ordering::Relaxed) + REPORT_PERCENT {
                    last.store(p as u64, Ordering::Relaxed);
                    println!("[{name}] DAG {p} %");
                }
            };
            match card.prepare(epoch, &progress) {
                Ok(()) => ready = Some(epoch),
                Err(e) => {
                    eprintln!("[{}] DAG error: {e}", card.name());
                    let Some(adapter) = fallback.take() else { return };
                    eprintln!("[{}] switching to wgpu", card.name());
                    match gpu::WgpuCard::open(&adapter) {
                        Ok(c) => {
                            card = Box::new(c);
                            println!("[{}] backend {}", card.name(), card.backend());
                        }
                        Err(e) => {
                            eprintln!("[card {index}] cannot be opened: {e}");
                            return;
                        }
                    }
                    continue;
                }
            }
        }
        let target = (
            u32::from_be_bytes([job.target[0], job.target[1], job.target[2], job.target[3]]),
            u32::from_be_bytes([job.target[4], job.target[5], job.target[6], job.target[7]]),
        );
        let batch_started = Instant::now();
        let result = card.search(&job.seal, nonce, target);
        // Lower intensity is a pause between batches: the card runs cooler and the computer stays responsive.
        if intensity < 100 {
            thread::sleep(batch_started.elapsed().mul_f64((100 - intensity) as f64 / intensity as f64));
        }
        nonce = nonce.wrapping_add(result.hashes);
        shared.hashes.fetch_add(result.hashes, Ordering::Relaxed);
        for n in result.nonces {
            let (mix, res) = ethash::hashimoto_light(card.cache(), card.full_size(), &job.seal, n);
            if res > job.target {
                continue; // match only in the upper 64 bits
            }
            let method = if job.pool { "aether_poolSubmit" } else { "aether_submitWork" };
            if rpc.as_ref().map(|(u, _)| u != &job.node).unwrap_or(true) {
                match Rpc::new(&job.node) {
                    Ok(r) => rpc = Some((job.node.clone(), r)),
                    Err(e) => {
                        eprintln!("[{}] submit error: {e}", card.name());
                        continue;
                    }
                }
            }
            let reply = rpc.as_ref().unwrap().1.call(method, json!([hex(&n.to_be_bytes()), hex(&job.seal), hex(&mix)]));
            if job.pool {
                match reply {
                    Ok(v) if v.get("accepted").and_then(Value::as_bool) == Some(true) => {
                        shared.shares.fetch_add(1, Ordering::Relaxed);
                        if v.get("block").is_some_and(|b| !b.is_null()) {
                            shared.found.fetch_add(1, Ordering::Relaxed);
                            println!("[{}] BLOCK FOUND #{} for the pool", card.name(), job.number);
                        }
                    }
                    Ok(v) if v.get("stale").and_then(Value::as_bool) == Some(true) => {
                        shared.stale.fetch_add(1, Ordering::Relaxed);
                    }
                    Ok(v) => {
                        shared.rejected.fetch_add(1, Ordering::Relaxed);
                        println!("[{}] share rejected: {}", card.name(), v.get("reason").and_then(Value::as_str).unwrap_or("?"));
                    }
                    Err(e) => eprintln!("[{}] submit error: {e}", card.name()),
                }
                continue;
            }
            match reply {
                Ok(v) if v.get("stale").and_then(Value::as_bool) == Some(true) => {
                    shared.stale.fetch_add(1, Ordering::Relaxed);
                    println!("[{}] block #{} came too late and is stale", card.name(), job.number);
                }
                Ok(v) if v.get("accepted").and_then(Value::as_bool) == Some(true) => {
                    shared.found.fetch_add(1, Ordering::Relaxed);
                    println!("[{}] BLOCK FOUND #{}", card.name(), job.number);
                }
                Ok(v) => {
                    shared.rejected.fetch_add(1, Ordering::Relaxed);
                    println!("[{}] block rejected: {}", card.name(), v.get("reason").and_then(Value::as_str).unwrap_or("?"));
                }
                Err(e) => eprintln!("[{}] submit error: {e}", card.name()),
            }
        }
    }
}

/// After this many failed requests to the primary target (every 0.5 s) the miner switches to a fallback.
const FALLBACK_AFTER: u32 = 20;
/// How often the primary target is tried again while mining on a fallback.
const FALLBACK_RETRY_SECS: u64 = 60;

/// Solo work from the first fallback node that answers; remembers which one it is.
fn fallback_work(fallbacks: &[(Arc<str>, Rpc)], on: &mut Option<usize>, address: &str) -> Option<Job> {
    let start = on.unwrap_or(0);
    for k in 0..fallbacks.len() {
        let i = (start + k) % fallbacks.len();
        let (url, rpc) = &fallbacks[i];
        if let Ok(mut job) = rpc.call("aether_getWork", json!([address])).and_then(|v| parse_job(&v)) {
            if *on != Some(i) {
                println!("The main target does not respond, mining solo through the backup node {url}.");
            }
            *on = Some(i);
            job.node = url.clone();
            return Some(job);
        }
    }
    None
}

fn benchmark(backend: &str) -> Result<(), String> {
    let source = discover(backend).into_iter().next().ok_or("no graphics card found")?;
    let (mut card, _) = source.open()?;
    println!("Card: {} ({})", card.name(), card.backend());
    let started = Instant::now();
    card.prepare(0, &|p| {
        if p % 20 == 0 {
            println!("DAG {p} %");
        }
    })?;
    println!("DAG verified against the CPU in {:.1} s.", started.elapsed().as_secs_f32());
    let header = [7u8; 32];

    // Low difficulty: every solution from the card is recomputed on the CPU and must match.
    let (mut checked, mut nonce) = (0, 1u64);
    let easy = (0x0100_0000u32, 0xffff_ffffu32);
    let mut full = [0xffu8; 32];
    full[..4].copy_from_slice(&easy.0.to_be_bytes());
    while checked < 8 {
        let r = card.search(&header, nonce, easy);
        nonce += r.hashes;
        for n in r.nonces {
            let (_, res) = ethash::hashimoto_light(card.cache(), card.full_size(), &header, n);
            if res > full {
                return Err(format!("the card returned a wrong solution for nonce {n}"));
            }
            checked += 1;
        }
    }
    println!("Card solutions verified on the CPU: {checked}");

    let started = Instant::now();
    let mut hashes = 0u64;
    while started.elapsed() < Duration::from_secs(20) {
        let r = card.search(&header, nonce, (0, 0));
        hashes += r.hashes;
        nonce = nonce.wrapping_add(r.hashes);
    }
    println!("Hashrate: {}", format_rate(hashes as f64 / started.elapsed().as_secs_f64()));
    Ok(())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| args.iter().any(|a| a == name);
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();

    if flag("--help") || flag("-h") {
        print!("{HELP}");
        return Ok(());
    }
    if let Some(state) = value("--gpu-state") {
        let state: u32 = state.parse().map_err(|_| "--gpu-state must be a number")?;
        println!("{}", nvapi::force(state)?);
        for gpu in cl::list() {
            println!("OpenCL: {}", gpu.summary());
        }
        return Ok(());
    }
    let backend = value("--backend").unwrap_or_else(|| "auto".into());
    if !["auto", "opencl", "wgpu"].contains(&backend.as_str()) {
        return Err("--backend must be auto, opencl or wgpu".into());
    }
    if flag("--list") {
        for (i, s) in discover(&backend).iter().enumerate() {
            let (name, kind) = s.label();
            println!("{i}: {name} ({kind})");
        }
        return Ok(());
    }
    if flag("--benchmark") {
        return benchmark(&backend);
    }

    let address = value("--address").ok_or("missing --address, see --help")?;
    let bytes = parse_hex(&address).map_err(|_| "invalid address")?;
    if bytes.len() != 20 {
        return Err("the address must have 20 bytes".into());
    }
    let node = value("--node").unwrap_or_else(|| "http://127.0.0.1:8545".into());
    let rpc = Rpc::new(&node)?;
    // A pool that stops answering is not a reason to stop mining: the miner then mines solo through these nodes
    // (its own node first) and goes back to the pool as soon as the pool answers again.
    let fallbacks: Vec<(Arc<str>, Rpc)> = value("--fallback")
        .map(|v| v.split(',').map(str::trim).filter(|u| !u.is_empty()).map(String::from).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .map(|u| Rpc::new(&u).map(|r| (Arc::from(u.as_str()), r)))
        .collect::<Result<_, _>>()?;
    let pool = match value("--pool") {
        Some(p) => {
            let b = parse_hex(&p).map_err(|_| "invalid pool address")?;
            if b.len() != 20 {
                return Err("the pool address must have 20 bytes".into());
            }
            Some(b)
        }
        None => None,
    };
    let worker = value("--worker").unwrap_or_else(|| "rig".into());

    let mut sources = discover(&backend);
    if sources.is_empty() {
        return Err("no graphics card found".into());
    }
    if let Some(d) = value("--device").filter(|d| d != "all") {
        let i: usize = d.parse().map_err(|_| "invalid card number")?;
        if i >= sources.len() {
            return Err("no such card, see --list".into());
        }
        sources = vec![sources.swap_remove(i)];
    }

    let intensity = value("--intensity").and_then(|v| v.parse::<u32>().ok()).unwrap_or(100).clamp(10, 100);
    let shared = Arc::new(Shared {
        job: Mutex::new(None),
        hashes: AtomicU64::new(0),
        found: AtomicU64::new(0),
        shares: AtomicU64::new(0),
        stale: AtomicU64::new(0),
        rejected: AtomicU64::new(0),
        pool: pool.is_some(),
    });
    let node_id: Arc<str> = Arc::from(node.as_str());
    match &pool {
        Some(p) => println!("Mining to {address} into the pool {} through the server {node}", hex(p)),
        None => println!("Mining to {address} through the node {node}"),
    }
    for (i, source) in sources.into_iter().enumerate() {
        let s = shared.clone();
        thread::spawn(move || gpu_worker(i, source, s, intensity));
    }

    let mut last_seal = [0u8; 32];
    let (mut last_print, mut last_hashes) = (Instant::now(), 0u64);
    let id = hex(&seed_nonce(99).to_be_bytes().repeat(4));
    let mut connected = true;
    let mut failures = 0u32;
    let mut on_fallback: Option<usize> = None;
    let mut last_try_primary = Instant::now();
    loop {
        // While mining on a fallback, the primary target is asked again every 60 s.
        let try_primary = on_fallback.is_none() || last_try_primary.elapsed() >= Duration::from_secs(FALLBACK_RETRY_SECS);
        let primary = if try_primary {
            last_try_primary = Instant::now();
            Some(match &pool {
                Some(p) => rpc.call("aether_poolWork", json!([address, worker])).and_then(|v| {
                    let mut job = parse_job(&v)?;
                    check_pool_job(&v, &job.seal, p, &bytes)?;
                    job.node = node_id.clone();
                    job.pool = true;
                    Ok(job)
                }),
                None => rpc.call("aether_getWork", json!([address])).and_then(|v| parse_job(&v)).map(|mut job| {
                    job.node = node_id.clone();
                    job
                }),
            })
        } else {
            None
        };
        let work = match primary {
            Some(Ok(job)) => {
                failures = 0;
                if let Some(i) = on_fallback.take() {
                    println!("The main target {node} responds again, leaving the backup node {}.", fallbacks[i].0);
                }
                Ok(job)
            }
            other => {
                if let Some(Err(e)) = &other {
                    failures += 1;
                    if on_fallback.is_none() && failures < FALLBACK_AFTER {
                        Err(e.clone())
                    } else {
                        fallback_work(&fallbacks, &mut on_fallback, &address)
                            .ok_or_else(|| e.clone())
                    }
                } else {
                    fallback_work(&fallbacks, &mut on_fallback, &address).ok_or_else(|| "the backup node does not respond".to_string())
                }
            }
        };
        match work {
            Ok(job) => {
                if !connected {
                    println!("Connection to the node restored.");
                    connected = true;
                }
                if job.seal != last_seal {
                    last_seal = job.seal;
                    *shared.job.lock().unwrap() = Some(job);
                }
            }
            Err(e) => {
                if connected {
                    eprintln!("The node does not respond: {e}");
                    connected = false;
                }
                *shared.job.lock().unwrap() = None;
            }
        }
        thread::sleep(Duration::from_millis(500));
        if last_print.elapsed() >= Duration::from_secs(10) {
            let total = shared.hashes.load(Ordering::Relaxed);
            let rate = (total - last_hashes) as f64 / last_print.elapsed().as_secs_f64();
            let shares = if shared.pool { format!(", shares {}", shared.shares.load(Ordering::Relaxed)) } else { String::new() };
            println!(
                "Hashrate {}, blocks found {}, stale {}, rejected {}{}",
                format_rate(rate),
                shared.found.load(Ordering::Relaxed),
                shared.stale.load(Ordering::Relaxed),
                shared.rejected.load(Ordering::Relaxed),
                shares
            );
            let _ = rpc.call("eth_submitHashrate", json!([format!("0x{:x}", rate as u64), id]));
            last_hashes = total;
            last_print = Instant::now();
        }
    }
}

#[cfg(windows)]
fn console_utf8() {
    extern "system" {
        fn SetConsoleOutputCP(id: u32) -> i32;
    }
    // Otherwise the Windows console would show non-ASCII characters incorrectly.
    unsafe {
        SetConsoleOutputCP(65001);
    }
}

#[cfg(not(windows))]
fn console_utf8() {}

fn main() {
    console_utf8();
    if let Err(e) = run() {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(b: &[u8]) -> Vec<u8> {
        if b.len() == 1 && b[0] < 0x80 {
            return b.to_vec();
        }
        let mut v = if b.len() < 56 { vec![0x80 + b.len() as u8] } else { vec![0xb9, (b.len() >> 8) as u8, b.len() as u8] };
        v.extend_from_slice(b);
        v
    }

    fn header(pool: &[u8], extra: &[u8]) -> Vec<u8> {
        let fields: [&[u8]; 13] =
            [&[1; 32], pool, &[2; 32], &[3; 32], &[4; 32], &[0; 256], &[5], &[6], &[7, 8, 9], &[], &[10, 11, 12, 13], extra, &[14]];
        let body: Vec<u8> = fields.iter().flat_map(|f| item(f)).collect();
        let mut out = vec![0xf9, (body.len() >> 8) as u8, body.len() as u8];
        out.extend(body);
        out
    }

    fn work(fields: &[u8]) -> (Value, [u8; 32]) {
        (json!(["0x", "0x", "0x", "0x1", hex(fields)]), ethash::keccak256(fields))
    }

    #[test]
    fn work_must_pay_into_the_pool_and_carry_the_miner_address() {
        let (pool, miner, other) = ([0xaa; 20], [0xbb; 20], [0xcc; 20]);
        let extra = [&miner[..], &[0; 12]].concat();
        let (v, seal) = work(&header(&pool, &extra));
        assert_eq!(check_pool_job(&v, &seal, &pool, &miner), Ok(()));
        assert!(check_pool_job(&v, &seal, &other, &miner).unwrap_err().contains("pool"));
        assert!(check_pool_job(&v, &seal, &pool, &other).unwrap_err().contains("address"));
        assert!(check_pool_job(&v, &[9; 32], &pool, &miner).unwrap_err().contains("does not match"));
    }

    #[test]
    fn header_without_address_or_damaged_is_refused() {
        let (pool, miner) = ([0xaa; 20], [0xbb; 20]);
        let (v, seal) = work(&header(&pool, &miner[..10]));
        assert!(check_pool_job(&v, &seal, &pool, &miner).is_err());
        let mut broken = header(&pool, &miner);
        broken.pop();
        let (v, seal) = work(&broken);
        assert_eq!(check_pool_job(&v, &seal, &pool, &miner).unwrap_err(), "invalid header");
        assert!(rlp_items(&[]).is_none());
        assert!(rlp_items(&[0xc1]).is_none());
    }
}
