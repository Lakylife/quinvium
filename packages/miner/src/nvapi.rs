//! Performance state of an NVIDIA card on Windows. The driver may keep compute in the power-saving P5 state with memory at a quarter of its clock,
//! even when the card is fully loaded, and Ethash is directly proportional to the memory clock. The function exists in the driver but not in the public
//! interface, so a separate short-lived process calls it. If the driver does not know it or refuses, mining continues as before.

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
            let library = Library::new("nvapi64.dll").map_err(|e| format!("the NVIDIA driver is not available: {e}"))?;
            let query: libloading::Symbol<Query> = library.get(b"nvapi_QueryInterface\0").map_err(|e| e.to_string())?;
            let function = |id: u32, name: &str| {
                let f = query(id);
                if f.is_null() { Err(format!("the driver does not know the function {name}")) } else { Ok(f) }
            };
            let initialize: Initialize = std::mem::transmute(function(INITIALIZE, "Initialize")?);
            let enum_gpus: EnumGpus = std::mem::transmute(function(ENUM_PHYSICAL_GPUS, "EnumPhysicalGPUs")?);
            let set: SetState = std::mem::transmute(function(SET_FORCE_PSTATE, "SetForcePstate")?);
            let code = initialize();
            if code != 0 {
                return Err(format!("initialisation returned {code}"));
            }
            let mut handles = [null_mut::<c_void>(); MAX_GPUS];
            let mut count = 0u32;
            let code = enum_gpus(handles.as_mut_ptr(), &mut count);
            if code != 0 {
                return Err(format!("the card list returned {code}"));
            }
            let results: Vec<String> = handles[..count as usize].iter().map(|h| set(*h, state, FALLBACK_LOWER_PERFORMANCE).to_string()).collect();
            Ok(format!("cards {count}, results {}", results.join(",")))
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn force(_state: u32) -> Result<String, String> {
        Err("only on Windows".into())
    }
}

pub use imp::force;
