//! Quinvium Miner: těžba Ethash na grafických kartách.
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

Použití:
  quintium-miner --address 0x... [--node http://127.0.0.1:8545] [--device N|all]
  quintium-miner --list          vypíše grafické karty
  quintium-miner --gpu-state <0|16>  výkon karty NVIDIA ve Windows: 0 plný, 16 podle ovladače
  quintium-miner --benchmark     změří výkon bez připojení k uzlu

Volby:
  --address <0x...>   adresa, na kterou jde odměna
  --node <url>        uzel Quinvium (výchozí http://127.0.0.1:8545)
  --device <N|all>    číslo karty ze seznamu, výchozí all
  --backend <auto|opencl|wgpu>  způsob výpočtu, výchozí auto (OpenCL, když ho karta umí)
  --intensity <10-100> výkon v procentech, výchozí 100
  --pool <0x...>      těžit do poolu s touto adresou, --node je pak server poolu
  --worker <název>    název zařízení v poolu, výchozí rig
  --help              tato nápověda
";

pub struct SearchResult {
    pub hashes: u64,
    pub nonces: Vec<u64>,
}

/// Jedna grafická karta bez ohledu na to, přes co se s ní mluví.
pub trait Card: Send {
    fn name(&self) -> String;
    fn backend(&self) -> String;
    /// Spočítá a ověří DAG epochy. `report` dostává procenta.
    fn prepare(&mut self, epoch: u64, report: &dyn Fn(u32)) -> Result<(), String>;
    fn cache(&self) -> &[u32];
    fn full_size(&self) -> u64;
    /// Prohledá dávku nonce od `start`. `target` je horních 64 bitů cíle.
    fn search(&mut self, header: &[u8; 32], start: u64, target: (u32, u32)) -> SearchResult;
}

/// Karta nalezená v počítači. U OpenCL je připravená náhrada, kdyby ovladač výpočet nezvládl.
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
                        eprintln!("OpenCL nejde použít: {e}");
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
        return Err("neplatný hex".into());
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
    v.try_into().map_err(|_| "očekáváno 32 bajtů".to_string())
}

fn parse_job(v: &Value) -> Result<Job, String> {
    let a = v.as_array().ok_or("neplatná práce")?;
    let text = |i: usize| a.get(i).and_then(Value::as_str).ok_or("neplatná práce");
    Ok(Job {
        seal: to32(parse_hex(text(0)?)?)?,
        target: to32(parse_hex(text(2)?)?)?,
        number: u64::from_str_radix(text(3)?.trim_start_matches("0x"), 16).map_err(|e| e.to_string())?,
    })
}

/// Položky seznamu RLP. Hlavička bloku žádné vnořené seznamy nemá.
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

/// Server poolu nesmí podstrčit cizí práci: hlavička musí platit do kontraktu poolu a nést adresu těžaře.
/// Díky tomu těžař vidí, že jeho výkon nejde někomu jinému, a nemusí serveru věřit.
fn check_pool_job(v: &Value, seal: &[u8; 32], pool: &[u8], miner: &[u8]) -> Result<(), String> {
    let fields = v.get(4).and_then(Value::as_str).ok_or("server neposlal hlavičku práce")?;
    let bytes = parse_hex(fields)?;
    if ethash::keccak256(&bytes) != *seal {
        return Err("hlavička neodpovídá práci".into());
    }
    let items = rlp_items(&bytes).ok_or("neplatná hlavička")?;
    if items.len() != 13 || items[1] != pool {
        return Err("práce neplatí do zvoleného poolu".into());
    }
    if items[11].len() < 20 || &items[11][..20] != miner {
        return Err("práce nenese adresu tohoto těžaře".into());
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

fn gpu_worker(index: usize, source: Source, shared: Arc<Shared>, node: String, intensity: u32) {
    let (mut card, mut fallback) = match source.open() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[karta {index}] nelze otevřít: {e}");
            return;
        }
    };
    println!("[{}] backend {}", card.name(), card.backend());
    let mut ready: Option<u64> = None;
    let mut nonce = seed_nonce(index);
    let rpc = Rpc::new(&node).expect("adresa uzlu");
    loop {
        let Some(job) = shared.job.lock().unwrap().clone() else {
            thread::sleep(Duration::from_millis(200));
            continue;
        };
        let epoch = job.number / ethash::EPOCH_LENGTH;
        if ready != Some(epoch) {
            let name = card.name();
            println!("[{name}] počítám DAG pro epochu {epoch}...");
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
                    eprintln!("[{}] chyba DAG: {e}", card.name());
                    let Some(adapter) = fallback.take() else { return };
                    eprintln!("[{}] přecházím na výpočet přes wgpu", card.name());
                    match gpu::WgpuCard::open(&adapter) {
                        Ok(c) => {
                            card = Box::new(c);
                            println!("[{}] backend {}", card.name(), card.backend());
                        }
                        Err(e) => {
                            eprintln!("[karta {index}] nelze otevřít: {e}");
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
        // Nižší výkon je přestávka mezi dávkami: karta se méně hřeje a počítač zůstává svižný.
        if intensity < 100 {
            thread::sleep(batch_started.elapsed().mul_f64((100 - intensity) as f64 / intensity as f64));
        }
        nonce = nonce.wrapping_add(result.hashes);
        shared.hashes.fetch_add(result.hashes, Ordering::Relaxed);
        for n in result.nonces {
            let (mix, res) = ethash::hashimoto_light(card.cache(), card.full_size(), &job.seal, n);
            if res > job.target {
                continue; // shoda jen v horních 64 bitech
            }
            let method = if shared.pool { "aether_poolSubmit" } else { "aether_submitWork" };
            let reply = rpc.call(method, json!([hex(&n.to_be_bytes()), hex(&job.seal), hex(&mix)]));
            if shared.pool {
                match reply {
                    Ok(v) if v.get("accepted").and_then(Value::as_bool) == Some(true) => {
                        shared.shares.fetch_add(1, Ordering::Relaxed);
                        if v.get("block").is_some_and(|b| !b.is_null()) {
                            shared.found.fetch_add(1, Ordering::Relaxed);
                            println!("[{}] NALEZEN BLOK #{} pro pool", card.name(), job.number);
                        }
                    }
                    Ok(v) if v.get("stale").and_then(Value::as_bool) == Some(true) => {
                        shared.stale.fetch_add(1, Ordering::Relaxed);
                    }
                    Ok(v) => {
                        shared.rejected.fetch_add(1, Ordering::Relaxed);
                        println!("[{}] podíl odmítnut: {}", card.name(), v.get("reason").and_then(Value::as_str).unwrap_or("?"));
                    }
                    Err(e) => eprintln!("[{}] chyba odeslání: {e}", card.name()),
                }
                continue;
            }
            match reply {
                Ok(v) if v.get("stale").and_then(Value::as_bool) == Some(true) => {
                    shared.stale.fetch_add(1, Ordering::Relaxed);
                    println!("[{}] blok #{} přišel pozdě a osiřel", card.name(), job.number);
                }
                Ok(v) if v.get("accepted").and_then(Value::as_bool) == Some(true) => {
                    shared.found.fetch_add(1, Ordering::Relaxed);
                    println!("[{}] NALEZEN BLOK #{}", card.name(), job.number);
                }
                Ok(v) => {
                    shared.rejected.fetch_add(1, Ordering::Relaxed);
                    println!("[{}] blok odmítnut: {}", card.name(), v.get("reason").and_then(Value::as_str).unwrap_or("?"));
                }
                Err(e) => eprintln!("[{}] chyba odeslání: {e}", card.name()),
            }
        }
    }
}

fn benchmark(backend: &str) -> Result<(), String> {
    let source = discover(backend).into_iter().next().ok_or("nebyla nalezena žádná grafická karta")?;
    let (mut card, _) = source.open()?;
    println!("Karta: {} ({})", card.name(), card.backend());
    let started = Instant::now();
    card.prepare(0, &|p| {
        if p % 20 == 0 {
            println!("DAG {p} %");
        }
    })?;
    println!("DAG ověřen proti procesoru za {:.1} s.", started.elapsed().as_secs_f32());
    let header = [7u8; 32];

    // Nízká obtížnost: každé řešení z karty se přepočítá na procesoru a musí souhlasit.
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
                return Err(format!("karta vrátila chybné řešení pro nonce {n}"));
            }
            checked += 1;
        }
    }
    println!("Řešení karty ověřena na procesoru: {checked}");

    let started = Instant::now();
    let mut hashes = 0u64;
    while started.elapsed() < Duration::from_secs(20) {
        let r = card.search(&header, nonce, (0, 0));
        hashes += r.hashes;
        nonce = nonce.wrapping_add(r.hashes);
    }
    println!("Výkon: {}", format_rate(hashes as f64 / started.elapsed().as_secs_f64()));
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
        let state: u32 = state.parse().map_err(|_| "--gpu-state musí být číslo")?;
        println!("{}", nvapi::force(state)?);
        for gpu in cl::list() {
            println!("OpenCL: {}", gpu.summary());
        }
        return Ok(());
    }
    let backend = value("--backend").unwrap_or_else(|| "auto".into());
    if !["auto", "opencl", "wgpu"].contains(&backend.as_str()) {
        return Err("--backend musí být auto, opencl nebo wgpu".into());
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

    let address = value("--address").ok_or("chybí --address, viz --help")?;
    let bytes = parse_hex(&address).map_err(|_| "neplatná adresa")?;
    if bytes.len() != 20 {
        return Err("adresa musí mít 20 bajtů".into());
    }
    let node = value("--node").unwrap_or_else(|| "http://127.0.0.1:8545".into());
    let rpc = Rpc::new(&node)?;
    let pool = match value("--pool") {
        Some(p) => {
            let b = parse_hex(&p).map_err(|_| "neplatná adresa poolu")?;
            if b.len() != 20 {
                return Err("adresa poolu musí mít 20 bajtů".into());
            }
            Some(b)
        }
        None => None,
    };
    let worker = value("--worker").unwrap_or_else(|| "rig".into());

    let mut sources = discover(&backend);
    if sources.is_empty() {
        return Err("nebyla nalezena žádná grafická karta".into());
    }
    if let Some(d) = value("--device").filter(|d| d != "all") {
        let i: usize = d.parse().map_err(|_| "neplatné číslo karty")?;
        if i >= sources.len() {
            return Err("taková karta neexistuje, viz --list".into());
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
    match &pool {
        Some(p) => println!("Těžím na adresu {address} do poolu {} přes server {node}", hex(p)),
        None => println!("Těžím na adresu {address} přes uzel {node}"),
    }
    for (i, source) in sources.into_iter().enumerate() {
        let (s, n) = (shared.clone(), node.clone());
        thread::spawn(move || gpu_worker(i, source, s, n, intensity));
    }

    let mut last_seal = [0u8; 32];
    let (mut last_print, mut last_hashes) = (Instant::now(), 0u64);
    let id = hex(&seed_nonce(99).to_be_bytes().repeat(4));
    let mut connected = true;
    loop {
        let work = match &pool {
            Some(p) => rpc.call("aether_poolWork", json!([address, worker])).and_then(|v| {
                let job = parse_job(&v)?;
                check_pool_job(&v, &job.seal, p, &bytes)?;
                Ok(job)
            }),
            None => rpc.call("aether_getWork", json!([address])).and_then(|v| parse_job(&v)),
        };
        match work {
            Ok(job) => {
                if !connected {
                    println!("Spojení s uzlem obnoveno.");
                    connected = true;
                }
                if job.seal != last_seal {
                    last_seal = job.seal;
                    *shared.job.lock().unwrap() = Some(job);
                }
            }
            Err(e) => {
                if connected {
                    eprintln!("Uzel neodpovídá: {e}");
                    connected = false;
                }
                *shared.job.lock().unwrap() = None;
            }
        }
        thread::sleep(Duration::from_millis(500));
        if last_print.elapsed() >= Duration::from_secs(10) {
            let total = shared.hashes.load(Ordering::Relaxed);
            let rate = (total - last_hashes) as f64 / last_print.elapsed().as_secs_f64();
            let shares = if shared.pool { format!(", podíly {}", shared.shares.load(Ordering::Relaxed)) } else { String::new() };
            println!(
                "Výkon {}, nalezené bloky {}, osiřelé {}, odmítnuté {}{}",
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
    // Jinak by konzole Windows zobrazila česká písmena špatně.
    unsafe {
        SetConsoleOutputCP(65001);
    }
}

#[cfg(not(windows))]
fn console_utf8() {}

fn main() {
    console_utf8();
    if let Err(e) = run() {
        eprintln!("Chyba: {e}");
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
    fn prace_musi_platit_do_poolu_a_nest_adresu_tezare() {
        let (pool, miner, other) = ([0xaa; 20], [0xbb; 20], [0xcc; 20]);
        let extra = [&miner[..], &[0; 12]].concat();
        let (v, seal) = work(&header(&pool, &extra));
        assert_eq!(check_pool_job(&v, &seal, &pool, &miner), Ok(()));
        assert!(check_pool_job(&v, &seal, &other, &miner).unwrap_err().contains("poolu"));
        assert!(check_pool_job(&v, &seal, &pool, &other).unwrap_err().contains("adresu"));
        assert!(check_pool_job(&v, &[9; 32], &pool, &miner).unwrap_err().contains("neodpovídá"));
    }

    #[test]
    fn hlavicka_bez_adresy_nebo_poskozena_neprojde() {
        let (pool, miner) = ([0xaa; 20], [0xbb; 20]);
        let (v, seal) = work(&header(&pool, &miner[..10]));
        assert!(check_pool_job(&v, &seal, &pool, &miner).is_err());
        let mut broken = header(&pool, &miner);
        broken.pop();
        let (v, seal) = work(&broken);
        assert_eq!(check_pool_job(&v, &seal, &pool, &miner).unwrap_err(), "neplatná hlavička");
        assert!(rlp_items(&[]).is_none());
        assert!(rlp_items(&[0xc1]).is_none());
    }
}
