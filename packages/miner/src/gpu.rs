//! GPU mining through wgpu: the DAG is computed directly on the card, the search runs in batches.
use crate::{ethash, shader, Card, SearchResult};
use std::time::Instant;

const MAX_CHUNK_BYTES: u64 = 1 << 31;
const STAGE: wgpu::BufferUsages = wgpu::BufferUsages::COPY_DST.union(wgpu::BufferUsages::STORAGE);

pub struct Device {
    pub name: String,
    pub backend: String,
    device: wgpu::Device,
    queue: wgpu::Queue,
    chunk_bytes: u64,
}

pub fn list_adapters() -> Vec<wgpu::Adapter> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::VULKAN | wgpu::Backends::METAL | wgpu::Backends::DX12,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let mut list = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()));
    // On Windows the same card is often visible through both Vulkan and DX12. Vulkan takes precedence.
    list.sort_by_key(|a| match a.get_info().backend {
        wgpu::Backend::Vulkan | wgpu::Backend::Metal => 0,
        _ => 1,
    });
    let mut seen: Vec<String> = Vec::new();
    list.retain(|a| {
        let i = a.get_info();
        if i.device_type == wgpu::DeviceType::Cpu || seen.contains(&i.name) {
            return false;
        }
        seen.push(i.name);
        true
    });
    list
}

impl Device {
    pub fn open(adapter: &wgpu::Adapter) -> Result<Self, String> {
        let info = adapter.get_info();
        let limits = adapter.limits();
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("aether"),
            required_features: wgpu::Features::empty(),
            required_limits: limits.clone(),
            ..Default::default()
        }))
        .map_err(|e| e.to_string())?;
        let cap = (limits.max_storage_buffer_binding_size as u64).min(limits.max_buffer_size).min(MAX_CHUNK_BYTES);
        let mut chunk_bytes = 1u64 << 24;
        while chunk_bytes * 2 <= cap {
            chunk_bytes *= 2;
        }
        Ok(Device {
            name: info.name,
            backend: format!("{:?}", info.backend),
            device,
            queue,
            chunk_bytes,
        })
    }

    fn wait(&self) {
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
    }

    fn pipeline(&self, source: String) -> wgpu::ComputePipeline {
        // All indexes in the shaders are bounded by a modulus or the loop range,
        // so runtime bounds checks only slow things down. It shows in mining.
        let module = unsafe {
            self.device.create_shader_module_trusted(
                wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(source.into()) },
                wgpu::ShaderRuntimeChecks::unchecked(),
            )
        };
        self.device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: None,
            layout: None,
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        })
    }

    fn storage(&self, size: u64, usage: wgpu::BufferUsages) -> wgpu::Buffer {
        self.device.create_buffer(&wgpu::BufferDescriptor { label: None, size, usage, mapped_at_creation: false })
    }

    fn read_back(&self, src: &wgpu::Buffer, offset: u64, size: u64) -> Vec<u8> {
        let staging = self.storage(size, wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST);
        let mut enc = self.device.create_command_encoder(&Default::default());
        enc.copy_buffer_to_buffer(src, offset, &staging, 0, size);
        self.queue.submit([enc.finish()]);
        let slice = staging.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        self.wait();
        let out = slice.get_mapped_range().expect("mapování bufferu").to_vec();
        staging.unmap();
        out
    }
}

pub struct Dag {
    pub epoch: u64,
    pub full_size: u64,
    pub cache: Vec<u32>,
    chunks: Vec<wgpu::Buffer>,
    chunk_bytes: u64,
}

/// Computes the DAG on the card and checks a sample of items against the CPU.
pub fn build_dag(d: &Device, epoch: u64, report: &dyn Fn(u32)) -> Result<Dag, String> {
    let cache = ethash::generate_cache(ethash::cache_size(epoch), &ethash::seed_hash(epoch));
    let full_size = ethash::dataset_size(epoch);
    let chunk_bytes = d.chunk_bytes;
    let count = full_size.div_ceil(chunk_bytes);
    if count > 6 {
        return Err("DAG se nevejde do limitů této karty".into());
    }
    let cache_buf = d.storage((cache.len() * 4) as u64, STAGE);
    d.queue.write_buffer(&cache_buf, 0, bytemuck::cast_slice(&cache));

    let mut chunks = Vec::new();
    for i in 0..count {
        let size = (full_size - i * chunk_bytes).min(chunk_bytes);
        chunks.push(d.storage(size, wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC));
    }

    let pipe = d.pipeline(shader::dag_shader());
    let params = d.storage(16, STAGE);
    let items_total = (full_size / 64) as u32;
    let rows = (cache.len() / 16) as u32;
    let mut batch: u32 = 1 << 12;
    let mut done: u32 = 0;
    let started = Instant::now();
    while done < items_total {
        let chunk_idx = (done as u64 * 64 / chunk_bytes) as usize;
        let chunk_end = (((chunk_idx as u64 + 1) * chunk_bytes) / 64).min(items_total as u64) as u32;
        let n = batch.min(chunk_end - done).min(wgpu::Limits::default().max_compute_workgroups_per_dimension * shader::WORKGROUP_SIZE);
        let out_offset = done - (chunk_idx as u64 * chunk_bytes / 64) as u32;
        d.queue.write_buffer(&params, 0, bytemuck::cast_slice(&[done, rows, out_offset, 0u32]));
        let group = d.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &pipe.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: params.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: cache_buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: chunks[chunk_idx].as_entire_binding() },
            ],
        });
        let t = Instant::now();
        let mut enc = d.device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_compute_pass(&Default::default());
            pass.set_pipeline(&pipe);
            pass.set_bind_group(0, &group, &[]);
            pass.dispatch_workgroups(n.div_ceil(shader::WORKGROUP_SIZE), 1, 1);
        }
        d.queue.submit([enc.finish()]);
        d.wait();
        done += n.div_ceil(shader::WORKGROUP_SIZE) * shader::WORKGROUP_SIZE;
        done = done.min(items_total);
        let ms = t.elapsed().as_millis();
        if ms < 200 {
            batch = batch.saturating_mul(2).min(1 << 21);
        } else if ms > 800 {
            batch = (batch / 2).max(1 << 10);
        }
        report((done as u64 * 100 / items_total as u64) as u32);
    }
    eprintln!("[{}] DAG hotový za {:.1} s", d.name, started.elapsed().as_secs_f32());

    // A check of randomly spread items: a card error is revealed before mining in vain.
    for k in 0..16u64 {
        let item = (items_total as u64 / 17) * (k + 1);
        let chunk = (item * 64 / chunk_bytes) as usize;
        let off = item * 64 - chunk as u64 * chunk_bytes;
        let bytes = d.read_back(&chunks[chunk], off, 64);
        let got: &[u32] = bytemuck::cast_slice(&bytes);
        if got != ethash::dataset_item(&cache, item as u32) {
            return Err(format!("položka DAG {item} nesouhlasí s výpočtem na procesoru, zkontrolujte stabilitu karty"));
        }
    }
    Ok(Dag { epoch, full_size, cache, chunks, chunk_bytes })
}

pub struct Searcher {
    pipe: wgpu::ComputePipeline,
    params: wgpu::Buffer,
    output: wgpu::Buffer,
    group: wgpu::BindGroup,
    pub batch: u32,
}

const OUTPUT_BYTES: u64 = 4 + (shader::MAX_RESULTS as u64) * 8;

pub fn searcher(d: &Device, dag: &Dag) -> Searcher {
    let page_bits = (dag.chunk_bytes / 128).trailing_zeros();
    let pipe = d.pipeline(shader::search_shader(dag.chunks.len() as u32, page_bits));
    let params = d.storage(64, STAGE);
    let output = d.storage(OUTPUT_BYTES, STAGE | wgpu::BufferUsages::COPY_SRC);
    let mut entries = vec![
        wgpu::BindGroupEntry { binding: 0, resource: params.as_entire_binding() },
        wgpu::BindGroupEntry { binding: 1, resource: output.as_entire_binding() },
    ];
    for (i, c) in dag.chunks.iter().enumerate() {
        entries.push(wgpu::BindGroupEntry { binding: i as u32 + 2, resource: c.as_entire_binding() });
    }
    let group = d.device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout: &pipe.get_bind_group_layout(0),
        entries: &entries,
    });
    Searcher { pipe, params, output, group, batch: 1 << 16 }
}

impl Searcher {
    /// Searches a batch of nonces from `start`. `target` is the upper 64 bits of the target.
    pub fn run(&mut self, d: &Device, dag: &Dag, header: &[u8; 32], start: u64, target: (u32, u32)) -> SearchResult {
        let mut p = [0u32; 16];
        for i in 0..8 {
            p[i] = u32::from_le_bytes([header[i * 4], header[i * 4 + 1], header[i * 4 + 2], header[i * 4 + 3]]);
        }
        p[8] = start as u32;
        p[9] = (start >> 32) as u32;
        p[10] = target.0;
        p[11] = target.1;
        p[12] = (dag.full_size / 128) as u32;
        d.queue.write_buffer(&self.params, 0, bytemuck::cast_slice(&p));
        d.queue.write_buffer(&self.output, 0, &[0u8; 4]);

        let groups = self.batch.div_ceil(shader::WORKGROUP_SIZE);
        let t = Instant::now();
        let mut enc = d.device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_compute_pass(&Default::default());
            pass.set_pipeline(&self.pipe);
            pass.set_bind_group(0, &self.group, &[]);
            pass.dispatch_workgroups(groups, 1, 1);
        }
        d.queue.submit([enc.finish()]);
        let bytes = d.read_back(&self.output, 0, OUTPUT_BYTES);
        let words: &[u32] = bytemuck::cast_slice(&bytes);
        let found = (words[0] as usize).min(shader::MAX_RESULTS);
        let nonces = (0..found).map(|i| words[1 + i * 2] as u64 | ((words[2 + i * 2] as u64) << 32)).collect();
        let hashes = groups as u64 * shader::WORKGROUP_SIZE as u64;

        // A batch of about 150 ms: the card does not freeze and new work takes effect quickly.
        let ms = t.elapsed().as_millis();
        if ms < 100 {
            self.batch = self.batch.saturating_mul(2).min(1 << 24);
        } else if ms > 300 {
            self.batch = (self.batch / 2).max(1 << 12);
        }
        SearchResult { hashes, nonces }
    }
}

/// A card driven through Vulkan, DirectX 12 or Metal.
pub struct WgpuCard {
    device: Device,
    dag: Option<Dag>,
    searcher: Option<Searcher>,
}

impl WgpuCard {
    pub fn open(adapter: &wgpu::Adapter) -> Result<Self, String> {
        Ok(Self { device: Device::open(adapter)?, dag: None, searcher: None })
    }
}

impl Card for WgpuCard {
    fn name(&self) -> String {
        self.device.name.clone()
    }

    fn backend(&self) -> String {
        self.device.backend.clone()
    }

    fn prepare(&mut self, epoch: u64, report: &dyn Fn(u32)) -> Result<(), String> {
        // The old DAG is freed before the new one starts being computed.
        drop(self.searcher.take());
        drop(self.dag.take());
        let dag = build_dag(&self.device, epoch, report)?;
        self.searcher = Some(searcher(&self.device, &dag));
        self.dag = Some(dag);
        Ok(())
    }

    fn cache(&self) -> &[u32] {
        &self.dag.as_ref().expect("DAG je připravený").cache
    }

    fn full_size(&self) -> u64 {
        self.dag.as_ref().expect("DAG je připravený").full_size
    }

    fn search(&mut self, header: &[u8; 32], start: u64, target: (u32, u32)) -> SearchResult {
        let dag = self.dag.as_ref().expect("DAG je připravený");
        self.searcher.as_mut().expect("DAG je připravený").run(&self.device, dag, header, start, target)
    }
}
