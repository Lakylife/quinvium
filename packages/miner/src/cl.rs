//! Mining through OpenCL. NVIDIA and AMD drivers treat OpenCL as a compute workload and run the card at full clocks,
//! whereas with Vulkan NVIDIA keeps memory in the power-saving P5 state and performance is a tenth. The library is loaded at run time:
//! on a computer without OpenCL the program starts normally and uses wgpu.
use crate::{ethash, shader, Card, SearchResult};
use libloading::Library;
use std::ffi::{c_void, CString};
use std::ptr::{null, null_mut};
use std::sync::Arc;
use std::time::Instant;

type Handle = *mut c_void;
type Int = i32;
const SUCCESS: Int = 0;
const DEVICE_TYPE_GPU: u64 = 1 << 2;
const DEVICE_NAME: u32 = 0x102B;
const DEVICE_EXTENSIONS: u32 = 0x1030;
const DEVICE_VENDOR: u32 = 0x102C;
const DEVICE_GLOBAL_MEM_SIZE: u32 = 0x101F;
const DEVICE_MAX_MEM_ALLOC_SIZE: u32 = 0x1010;
const DEVICE_HOST_UNIFIED_MEMORY: u32 = 0x1035;
const PROGRAM_BUILD_LOG: u32 = 0x1183;
const MEM_READ_WRITE: u64 = 1 << 0;
const MEM_READ_ONLY: u64 = 1 << 2;
const MEM_COPY_HOST_PTR: u64 = 1 << 5;
const SEARCH_MS: (u128, u128) = (100, 300);
const DAG_MS: (u128, u128) = (200, 800);
const MAX_PARTS: u64 = 4;
const OUTPUT_BYTES: usize = 4 + shader::MAX_RESULTS as usize * 8;

macro_rules! api {
    ($($field:ident: $symbol:literal fn($($arg:ty),*) -> $ret:ty;)*) => {
        struct Api {
            _lib: Library,
            $($field: unsafe extern "system" fn($($arg),*) -> $ret,)*
        }
        impl Api {
            fn load() -> Result<Api, String> {
                let mut last = String::from("OpenCL library not found");
                for name in LIBRARIES {
                    match unsafe { Library::new(name) } {
                        Ok(lib) => unsafe {
                            $(let $field = *lib
                                .get::<unsafe extern "system" fn($($arg),*) -> $ret>($symbol)
                                .map_err(|e| e.to_string())?;)*
                            return Ok(Api { _lib: lib, $($field,)* });
                        },
                        Err(e) => last = e.to_string(),
                    }
                }
                Err(last)
            }
        }
    };
}

#[cfg(windows)]
const LIBRARIES: &[&str] = &["OpenCL.dll"];
#[cfg(target_os = "macos")]
const LIBRARIES: &[&str] = &["/System/Library/Frameworks/OpenCL.framework/OpenCL"];
#[cfg(all(not(windows), not(target_os = "macos")))]
const LIBRARIES: &[&str] = &["libOpenCL.so.1", "libOpenCL.so"];

api! {
    get_platforms: b"clGetPlatformIDs\0" fn(u32, *mut Handle, *mut u32) -> Int;
    get_devices: b"clGetDeviceIDs\0" fn(Handle, u64, u32, *mut Handle, *mut u32) -> Int;
    device_info: b"clGetDeviceInfo\0" fn(Handle, u32, usize, *mut c_void, *mut usize) -> Int;
    create_context: b"clCreateContext\0" fn(*const isize, u32, *const Handle, *const c_void, *const c_void, *mut Int) -> Handle;
    create_queue: b"clCreateCommandQueue\0" fn(Handle, Handle, u64, *mut Int) -> Handle;
    create_buffer: b"clCreateBuffer\0" fn(Handle, u64, usize, *mut c_void, *mut Int) -> Handle;
    create_program: b"clCreateProgramWithSource\0" fn(Handle, u32, *const *const i8, *const usize, *mut Int) -> Handle;
    build_program: b"clBuildProgram\0" fn(Handle, u32, *const Handle, *const i8, *const c_void, *const c_void) -> Int;
    build_info: b"clGetProgramBuildInfo\0" fn(Handle, Handle, u32, usize, *mut c_void, *mut usize) -> Int;
    create_kernel: b"clCreateKernel\0" fn(Handle, *const i8, *mut Int) -> Handle;
    set_arg: b"clSetKernelArg\0" fn(Handle, u32, usize, *const c_void) -> Int;
    run: b"clEnqueueNDRangeKernel\0" fn(Handle, Handle, u32, *const usize, *const usize, *const usize, u32, *const Handle, *mut Handle) -> Int;
    write: b"clEnqueueWriteBuffer\0" fn(Handle, Handle, u32, usize, usize, *const c_void, u32, *const Handle, *mut Handle) -> Int;
    read: b"clEnqueueReadBuffer\0" fn(Handle, Handle, u32, usize, usize, *mut c_void, u32, *const Handle, *mut Handle) -> Int;
    finish: b"clFinish\0" fn(Handle) -> Int;
    release_mem: b"clReleaseMemObject\0" fn(Handle) -> Int;
    release_kernel: b"clReleaseKernel\0" fn(Handle) -> Int;
    release_program: b"clReleaseProgram\0" fn(Handle) -> Int;
}

fn check(code: Int, what: &str) -> Result<(), String> {
    if code == SUCCESS {
        Ok(())
    } else {
        Err(format!("OpenCL {what}: error {code}"))
    }
}

/// A graphics card offered by the OpenCL driver.
#[derive(Clone)]
pub struct Gpu {
    api: Arc<Api>,
    device: Handle,
    pub name: String,
    pub vendor: String,
    memory: u64,
    max_alloc: u64,
    unified: bool,
}

// The OpenCL driver is safe for use from one thread at a time; a card is always served by a single thread.
unsafe impl Send for Gpu {}
unsafe impl Send for Api {}
unsafe impl Sync for Api {}

fn info_bytes(api: &Api, device: Handle, param: u32) -> Vec<u8> {
    let mut size = 0usize;
    unsafe { (api.device_info)(device, param, 0, null_mut(), &mut size) };
    let mut out = vec![0u8; size];
    unsafe { (api.device_info)(device, param, size, out.as_mut_ptr().cast(), null_mut()) };
    out
}

fn info_text(api: &Api, device: Handle, param: u32) -> String {
    String::from_utf8_lossy(&info_bytes(api, device, param)).trim_matches('\0').trim().to_string()
}

fn info_number(api: &Api, device: Handle, param: u32) -> u64 {
    let b = info_bytes(api, device, param);
    let mut out = [0u8; 8];
    out[..b.len().min(8)].copy_from_slice(&b[..b.len().min(8)]);
    u64::from_le_bytes(out)
}

/// Graphics cards with dedicated memory. An integrated card has slow shared memory and is offered only when there is nothing else.
pub fn list() -> Vec<Gpu> {
    let Ok(api) = Api::load().map(Arc::new) else { return Vec::new() };
    let mut count = 0u32;
    unsafe { (api.get_platforms)(0, null_mut(), &mut count) };
    let mut platforms = vec![null_mut(); count as usize];
    if count == 0 || unsafe { (api.get_platforms)(count, platforms.as_mut_ptr(), null_mut()) } != SUCCESS {
        return Vec::new();
    }
    let mut found = Vec::new();
    for platform in platforms {
        let mut n = 0u32;
        if unsafe { (api.get_devices)(platform, DEVICE_TYPE_GPU, 0, null_mut(), &mut n) } != SUCCESS || n == 0 {
            continue;
        }
        let mut devices = vec![null_mut(); n as usize];
        unsafe { (api.get_devices)(platform, DEVICE_TYPE_GPU, n, devices.as_mut_ptr(), null_mut()) };
        for device in devices {
            found.push(Gpu {
                api: api.clone(),
                device,
                name: info_text(&api, device, DEVICE_NAME),
                vendor: info_text(&api, device, DEVICE_VENDOR),
                memory: info_number(&api, device, DEVICE_GLOBAL_MEM_SIZE),
                max_alloc: info_number(&api, device, DEVICE_MAX_MEM_ALLOC_SIZE),
                unified: info_number(&api, device, DEVICE_HOST_UNIFIED_MEMORY) != 0,
            });
        }
    }
    if found.iter().any(|g| !g.unified) {
        found.retain(|g| !g.unified);
    }
    found
}

impl Gpu {
    /// Name and extension for diagnostics.
    pub fn summary(&self) -> String {
        format!("{}: {}", self.title(), info_text(&self.api, self.device, DEVICE_EXTENSIONS))
    }

    pub fn title(&self) -> String {
        let v = self.vendor.to_lowercase();
        let brand = if v.contains("nvidia") {
            "NVIDIA "
        } else if v.contains("advanced micro") || v.contains("amd") {
            "AMD "
        } else {
            ""
        };
        let clean = self.name.trim_end_matches(" Compute Engine");
        if clean.to_lowercase().starts_with(brand.trim().to_lowercase().as_str()) && !brand.is_empty() {
            clean.to_string()
        } else {
            format!("{brand}{clean}")
        }
    }

    pub fn open(self) -> Result<Engine, String> {
        let api = self.api.clone();
        let mut code = 0;
        let context = unsafe { (api.create_context)(null(), 1, &self.device, null(), null(), &mut code) };
        check(code, "kontext")?;
        let queue = unsafe { (api.create_queue)(context, self.device, 0, &mut code) };
        check(code, "fronta")?;
        Ok(Engine {
            name: self.title(),
            device: self.device,
            memory: self.memory,
            max_alloc: self.max_alloc,
            api,
            context,
            queue,
            program: None,
            parts: Vec::new(),
            part_bytes: 0,
            output: null_mut(),
            search: null_mut(),
            cache: Vec::new(),
            full_size: 0,
            batch: 1 << 18,
        })
    }
}

pub struct Engine {
    pub name: String,
    device: Handle,
    memory: u64,
    max_alloc: u64,
    api: Arc<Api>,
    context: Handle,
    queue: Handle,
    program: Option<Handle>,
    parts: Vec<Handle>,
    part_bytes: u64,
    output: Handle,
    search: Handle,
    cache: Vec<u32>,
    full_size: u64,
    batch: usize,
}

unsafe impl Send for Engine {}

impl Engine {
    fn buffer(&self, flags: u64, size: usize, data: *mut c_void) -> Result<Handle, String> {
        let mut code = 0;
        let b = unsafe { (self.api.create_buffer)(self.context, flags, size, data, &mut code) };
        check(code, "buffer").map(|_| b)
    }

    fn compile(&self, parts: u64, part_bits: u32) -> Result<Handle, String> {
        let source = include_str!("ethash.cl");
        let text = CString::new(source).map_err(|e| e.to_string())?;
        let ptr = text.as_ptr();
        let length = source.len();
        let mut code = 0;
        let program = unsafe { (self.api.create_program)(self.context, 1, &ptr, &length, &mut code) };
        check(code, "program")?;
        let mask = if part_bits >= 32 { u32::MAX } else { (1u32 << part_bits) - 1 };
        let options = CString::new(format!(
            "-D PARTS={parts} -D PART_BITS={part_bits} -D PART_MASK={mask}U -D MAX_RESULTS={}",
            shader::MAX_RESULTS
        ))
        .map_err(|e| e.to_string())?;
        let result = unsafe { (self.api.build_program)(program, 1, &self.device, options.as_ptr(), null(), null()) };
        if result != SUCCESS {
            let mut size = 0usize;
            unsafe { (self.api.build_info)(program, self.device, PROGRAM_BUILD_LOG, 0, null_mut(), &mut size) };
            let mut log = vec![0u8; size];
            unsafe { (self.api.build_info)(program, self.device, PROGRAM_BUILD_LOG, size, log.as_mut_ptr().cast(), null_mut()) };
            let text = String::from_utf8_lossy(&log);
            return Err(format!("kernel compilation failed: {}", text.chars().take(600).collect::<String>()));
        }
        Ok(program)
    }

    fn kernel(&self, program: Handle, name: &str) -> Result<Handle, String> {
        let name = CString::new(name).map_err(|e| e.to_string())?;
        let mut code = 0;
        let k = unsafe { (self.api.create_kernel)(program, name.as_ptr(), &mut code) };
        check(code, "kernel").map(|_| k)
    }

    fn arg<T>(&self, kernel: Handle, index: u32, value: &T) -> Result<(), String> {
        let code = unsafe { (self.api.set_arg)(kernel, index, std::mem::size_of::<T>(), (value as *const T).cast()) };
        check(code, "parametr")
    }

    fn release_all(&mut self) {
        unsafe {
            for p in self.parts.drain(..) {
                (self.api.release_mem)(p);
            }
            if !self.search.is_null() {
                (self.api.release_kernel)(self.search);
                self.search = null_mut();
            }
            if !self.output.is_null() {
                (self.api.release_mem)(self.output);
                self.output = null_mut();
            }
            if let Some(p) = self.program.take() {
                (self.api.release_program)(p);
            }
        }
    }

    fn build(&mut self, epoch: u64, report: &dyn Fn(u32)) -> Result<(), String> {
        self.release_all();
        let cache = ethash::generate_cache(ethash::cache_size(epoch), &ethash::seed_hash(epoch));
        let full_size = ethash::dataset_size(epoch);
        if self.memory < full_size + full_size / 8 {
            return Err("the DAG does not fit into the card memory".into());
        }
        // One buffer may be at most `max_alloc`. The part size is a power of two so a page can be found by shifting.
        let mut part_bytes = 1u64 << 63;
        while part_bytes > self.max_alloc {
            part_bytes >>= 1;
        }
        part_bytes = part_bytes.max(1 << 27);
        while full_size.div_ceil(part_bytes) > MAX_PARTS {
            part_bytes <<= 1;
        }
        if full_size <= self.max_alloc {
            part_bytes = full_size.next_power_of_two();
        }
        // Cards need a split DAG only in later epochs; the test forces it even in epoch 0.
        if let Some(mb) = std::env::var("AETHER_CL_PART_MB").ok().and_then(|v| v.parse::<u64>().ok()) {
            part_bytes = mb << 20;
        }
        let parts = full_size.div_ceil(part_bytes);
        let part_bits = (part_bytes / 128).trailing_zeros();
        let program = self.compile(parts, part_bits)?;
        self.program = Some(program);

        for i in 0..parts {
            let size = (full_size - i * part_bytes).min(part_bytes);
            let b = self.buffer(MEM_READ_WRITE, size as usize, null_mut())?;
            self.parts.push(b);
        }
        self.part_bytes = part_bytes;
        let bytes: &[u8] = bytemuck::cast_slice(&cache);
        let cache_buffer = self.buffer(MEM_READ_ONLY | MEM_COPY_HOST_PTR, bytes.len(), bytes.as_ptr() as *mut c_void)?;
        let kernel = self.kernel(program, "dag_items")?;

        let rows = (cache.len() / 16) as u32;
        let total = (full_size / 64) as u32;
        let items_per_part = (part_bytes / 64) as u32;
        let mut batch: usize = 1 << 14;
        let mut done = 0u32;
        let started = Instant::now();
        while done < total {
            let part = (done / items_per_part) as usize;
            let part_end = ((part as u32 + 1).saturating_mul(items_per_part)).min(total);
            let n = batch.min((part_end - done) as usize);
            let base = done - part as u32 * items_per_part;
            self.arg(kernel, 0, &self.parts[part])?;
            self.arg(kernel, 1, &cache_buffer)?;
            self.arg(kernel, 2, &done)?;
            self.arg(kernel, 3, &base)?;
            self.arg(kernel, 4, &rows)?;
            let t = Instant::now();
            let global = [n];
            check(unsafe { (self.api.run)(self.queue, kernel, 1, null(), global.as_ptr(), null(), 0, null(), null_mut()) }, "DAG generation")?;
            check(unsafe { (self.api.finish)(self.queue) }, "waiting for the DAG")?;
            done += n as u32;
            let ms = t.elapsed().as_millis();
            if ms < DAG_MS.0 {
                batch = (batch * 2).min(1 << 21);
            } else if ms > DAG_MS.1 {
                batch = (batch / 2).max(1 << 10);
            }
            report((done as u64 * 100 / total as u64) as u32);
        }
        unsafe {
            (self.api.release_kernel)(kernel);
            (self.api.release_mem)(cache_buffer);
        }
        eprintln!("[{}] DAG ready in {:.1} s", self.name, started.elapsed().as_secs_f32());

        // A card or driver error shows up immediately, not after hours of futile mining.
        for k in 0..16u64 {
            let item = (total as u64 / 17) * (k + 1);
            let part = (item * 64 / part_bytes) as usize;
            let offset = (item * 64 - part as u64 * part_bytes) as usize;
            let mut got = [0u32; 16];
            let code = unsafe { (self.api.read)(self.queue, self.parts[part], 1, offset, 64, got.as_mut_ptr().cast(), 0, null(), null_mut()) };
            check(code, "reading the DAG")?;
            if got != ethash::dataset_item(&cache, item as u32) {
                return Err(format!("DAG item {item} does not match the CPU calculation"));
            }
        }

        let search = self.kernel(program, "search")?;
        self.output = self.buffer(MEM_READ_WRITE, OUTPUT_BYTES, null_mut())?;
        self.arg(search, 0, &self.output)?;
        for (i, part) in self.parts.iter().enumerate() {
            self.arg(search, 1 + i as u32, part)?;
        }
        self.search = search;
        self.cache = cache;
        self.full_size = full_size;
        Ok(())
    }
}

impl Card for Engine {
    fn name(&self) -> String {
        self.name.clone()
    }

    fn backend(&self) -> String {
        "OpenCL".into()
    }

    fn prepare(&mut self, epoch: u64, report: &dyn Fn(u32)) -> Result<(), String> {
        self.build(epoch, report)?;
        // Another driver may compile the computation differently. A solution on an easy target is checked against the CPU.
        let header = [7u8; 32];
        let easy = (0x0100_0000u32, 0xffff_ffffu32);
        let mut limit = [0xffu8; 32];
        limit[..4].copy_from_slice(&easy.0.to_be_bytes());
        let (mut checked, mut nonce) = (0, 1u64);
        for _ in 0..64 {
            let found = self.search(&header, nonce, easy);
            nonce += found.hashes;
            for n in found.nonces {
                let (_, result) = ethash::hashimoto_light(&self.cache, self.full_size, &header, n);
                if result > limit {
                    return Err(format!("the card returned a wrong solution for nonce {n}"));
                }
                checked += 1;
            }
            if checked >= 4 {
                return Ok(());
            }
        }
        Err("the card found no solution on an easy target".into())
    }

    fn cache(&self) -> &[u32] {
        &self.cache
    }

    fn full_size(&self) -> u64 {
        self.full_size
    }

    fn search(&mut self, header: &[u8; 32], start: u64, target: (u32, u32)) -> SearchResult {
        let first = 1 + self.parts.len() as u32;
        for i in 0..8u32 {
            let word = u32::from_le_bytes([header[i as usize * 4], header[i as usize * 4 + 1], header[i as usize * 4 + 2], header[i as usize * 4 + 3]]);
            let _ = self.arg(self.search, first + i, &word);
        }
        let full = ((target.0 as u64) << 32) | target.1 as u64;
        let pages = (self.full_size / 128) as u32;
        let _ = self.arg(self.search, first + 8, &start);
        let _ = self.arg(self.search, first + 9, &full);
        let _ = self.arg(self.search, first + 10, &pages);
        let zero = [0u8; 4];
        let t = Instant::now();
        unsafe {
            (self.api.write)(self.queue, self.output, 1, 0, 4, zero.as_ptr().cast(), 0, null(), null_mut());
            let global = [self.batch];
            (self.api.run)(self.queue, self.search, 1, null(), global.as_ptr(), null(), 0, null(), null_mut());
            (self.api.finish)(self.queue);
        }
        let mut words = vec![0u32; OUTPUT_BYTES / 4];
        unsafe { (self.api.read)(self.queue, self.output, 1, 0, OUTPUT_BYTES, words.as_mut_ptr().cast(), 0, null(), null_mut()) };
        let found = (words[0] as usize).min(shader::MAX_RESULTS as usize);
        let nonces = (0..found).map(|i| words[1 + i * 2] as u64 | ((words[2 + i * 2] as u64) << 32)).collect();
        let hashes = self.batch as u64;

        // A batch of about 200 ms: the card does not freeze and new work takes effect quickly.
        let ms = t.elapsed().as_millis();
        if ms < SEARCH_MS.0 {
            self.batch = (self.batch * 2).min(1 << 26);
        } else if ms > SEARCH_MS.1 {
            self.batch = (self.batch / 2).max(1 << 12);
        }
        SearchResult { hashes, nonces }
    }
}
