//! Výkonový stav karty NVIDIA ve Windows. Ovladač může výpočet nechat v úsporném stavu P5 s pamětí na čtvrtině taktu,
//! i když je karta plně vytížená, a Ethash je přímo úměrný taktu paměti. Funkce je v ovladači, ale není ve veřejném
//! rozhraní, proto ji volá samostatný krátký proces. Když ji ovladač nezná nebo odmítne, těžba poběží dál jako dřív.

#[cfg(windows)]
mod imp {
    use libloading::Library;
    use std::ffi::c_void;
    use std::ptr::null_mut;

    const MAX_GPUS: usize = 64;
    const INITIALIZE: u32 = 0x0150_E828;
    const ENUM_PHYSICAL_GPUS: u32 = 0xE5AC_921F;
    const SET_FORCE_PSTATE: u32 = 0x025B_FB10;
    const FALLBACK_LOWER_PERFORMANCE: u32 = 2;

    type Query = unsafe extern "C" fn(u32) -> *mut c_void;
    type Initialize = unsafe extern "C" fn() -> i32;
    type EnumGpus = unsafe extern "C" fn(*mut *mut c_void, *mut u32) -> i32;
    type SetState = unsafe extern "C" fn(*mut c_void, u32, u32) -> i32;

    pub fn force(state: u32) -> Result<String, String> {
        unsafe {
            let library = Library::new("nvapi64.dll").map_err(|e| format!("ovladač NVIDIA není k dispozici: {e}"))?;
            let query: libloading::Symbol<Query> = library.get(b"nvapi_QueryInterface\0").map_err(|e| e.to_string())?;
            let function = |id: u32, name: &str| {
                let f = query(id);
                if f.is_null() { Err(format!("ovladač nezná funkci {name}")) } else { Ok(f) }
            };
            let initialize: Initialize = std::mem::transmute(function(INITIALIZE, "Initialize")?);
            let enum_gpus: EnumGpus = std::mem::transmute(function(ENUM_PHYSICAL_GPUS, "EnumPhysicalGPUs")?);
            let set: SetState = std::mem::transmute(function(SET_FORCE_PSTATE, "SetForcePstate")?);
            let code = initialize();
            if code != 0 {
                return Err(format!("inicializace vrátila {code}"));
            }
            let mut handles = [null_mut::<c_void>(); MAX_GPUS];
            let mut count = 0u32;
            let code = enum_gpus(handles.as_mut_ptr(), &mut count);
            if code != 0 {
                return Err(format!("seznam karet vrátil {code}"));
            }
            let results: Vec<String> = handles[..count as usize].iter().map(|h| set(*h, state, FALLBACK_LOWER_PERFORMANCE).to_string()).collect();
            Ok(format!("karet {count}, výsledky {}", results.join(",")))
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn force(_state: u32) -> Result<String, String> {
        Err("jen ve Windows".into())
    }
}

pub use imp::force;
