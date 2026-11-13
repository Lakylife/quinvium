//! Generátor výpočetních shaderů WGSL. Keccak-f1600 používá dvojice 32bitových slov,
//! protože WGSL 64bitová čísla nemá. Rotace se generují s konstantami, ať je kód co nejrychlejší.

const WORKGROUP: u32 = 64;
const ROT: [u32; 25] = [
    0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];
const RC: [u64; 24] = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000, 0x000000000000808b,
    0x0000000080000001, 0x8000000080008081, 0x8000000000008009, 0x000000000000008a, 0x0000000000000088,
    0x0000000080008009, 0x000000008000000a, 0x000000008000808b, 0x800000000000008b, 0x8000000000008089,
    0x8000000000008003, 0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
];

fn rotl(l: &str, h: &str, n: u32) -> (String, String) {
    match n {
        0 => (l.to_string(), h.to_string()),
        32 => (h.to_string(), l.to_string()),
        n if n < 32 => (
            format!("(({l} << {n}u) | ({h} >> {}u))", 32 - n),
            format!("(({h} << {n}u) | ({l} >> {}u))", 32 - n),
        ),
        n => {
            let m = n - 32;
            (
                format!("(({h} << {m}u) | ({l} >> {}u))", 32 - m),
                format!("(({l} << {m}u) | ({h} >> {}u))", 32 - m),
            )
        }
    }
}

fn keccak() -> String {
    let mut s = String::new();
    let lo: Vec<String> = RC.iter().map(|v| format!("0x{:08x}u", *v as u32)).collect();
    let hi: Vec<String> = RC.iter().map(|v| format!("0x{:08x}u", (*v >> 32) as u32)).collect();
    s += &format!("var<private> RC_L: array<u32, 24> = array<u32, 24>({});\n", lo.join(","));
    s += &format!("var<private> RC_H: array<u32, 24> = array<u32, 24>({});\n", hi.join(","));
    s += "fn keccak_f(st: ptr<function, array<u32, 50>>) {\n";
    for i in 0..25 {
        s += &format!("  var a{i}l = (*st)[{}]; var a{i}h = (*st)[{}];\n", i * 2, i * 2 + 1);
    }
    s += "  for (var r = 0u; r < 24u; r++) {\n";
    for x in 0..5 {
        for p in ["l", "h"] {
            s += &format!(
                "    let c{x}{p} = a{}{p} ^ a{}{p} ^ a{}{p} ^ a{}{p} ^ a{}{p};\n",
                x, x + 5, x + 10, x + 15, x + 20
            );
        }
    }
    for x in 0..5usize {
        let prev = (x + 4) % 5;
        let next = (x + 1) % 5;
        let (rl, rh) = rotl(&format!("c{next}l"), &format!("c{next}h"), 1);
        s += &format!("    let d{x}l = c{prev}l ^ {rl};\n    let d{x}h = c{prev}h ^ {rh};\n");
    }
    for i in 0..25usize {
        let x = i % 5;
        s += &format!("    a{i}l ^= d{x}l; a{i}h ^= d{x}h;\n");
    }
    for i in 0..25usize {
        let x = i % 5;
        let y = i / 5;
        let t = y + 5 * ((2 * x + 3 * y) % 5);
        let (rl, rh) = rotl(&format!("a{i}l"), &format!("a{i}h"), ROT[i]);
        s += &format!("    let b{t}l = {rl}; let b{t}h = {rh};\n");
    }
    for y in 0..5usize {
        for x in 0..5usize {
            let i = x + 5 * y;
            let j = (x + 1) % 5 + 5 * y;
            let k = (x + 2) % 5 + 5 * y;
            s += &format!("    a{i}l = b{i}l ^ ((~b{j}l) & b{k}l); a{i}h = b{i}h ^ ((~b{j}h) & b{k}h);\n");
        }
    }
    s += "    a0l ^= RC_L[r]; a0h ^= RC_H[r];\n  }\n";
    for i in 0..25 {
        s += &format!("  (*st)[{}] = a{i}l; (*st)[{}] = a{i}h;\n", i * 2, i * 2 + 1);
    }
    s += "}\n";
    s
}

const FNV: &str = "fn fnv(a: u32, b: u32) -> u32 { return (a * 0x01000193u) ^ b; }\n";

/// Keccak-f1600 rozepsaný do jednorázových hodnot. Bez polí a smyček drží překladač vše v registrech.
/// Pole ve funkci jdou na kartách NVIDIA do pomalé lokální paměti, což výkon srazí desetinásobně.
fn keccak_inline(s: &mut String, tag: &str, input: Vec<String>) -> Vec<String> {
    let mut a = input;
    for (r, rc) in RC.iter().enumerate() {
        let n = |name: &str| format!("{tag}{r}{name}");
        for x in 0..5 {
            for w in 0..2 {
                let terms: Vec<&str> = (0..5).map(|y| a[(x + 5 * y) * 2 + w].as_str()).collect();
                *s += &format!("  let {} = {};\n", n(&format!("c{x}{w}")), terms.join(" ^ "));
            }
        }
        for x in 0..5usize {
            let prev = (x + 4) % 5;
            let next = (x + 1) % 5;
            let (rl, rh) = rotl(&n(&format!("c{next}0")), &n(&format!("c{next}1")), 1);
            *s += &format!("  let {} = {} ^ {rl};\n  let {} = {} ^ {rh};\n", n(&format!("d{x}0")), n(&format!("c{prev}0")), n(&format!("d{x}1")), n(&format!("c{prev}1")));
        }
        let mut b = vec![String::new(); 50];
        for i in 0..25usize {
            let x = i % 5;
            let y = i / 5;
            let t = y + 5 * ((2 * x + 3 * y) % 5);
            let (tl, th) = (n(&format!("t{i}0")), n(&format!("t{i}1")));
            *s += &format!("  let {tl} = {} ^ {};\n  let {th} = {} ^ {};\n", a[i * 2], n(&format!("d{x}0")), a[i * 2 + 1], n(&format!("d{x}1")));
            let (rl, rh) = rotl(&tl, &th, ROT[i]);
            let (bl, bh) = (n(&format!("b{t}0")), n(&format!("b{t}1")));
            *s += &format!("  let {bl} = {rl};\n  let {bh} = {rh};\n");
            b[t * 2] = bl;
            b[t * 2 + 1] = bh;
        }
        for y in 0..5usize {
            for x in 0..5usize {
                let i = x + 5 * y;
                let j = (x + 1) % 5 + 5 * y;
                let k = (x + 2) % 5 + 5 * y;
                for w in 0..2 {
                    let mut value = format!("{} ^ ((~{}) & {})", b[i * 2 + w], b[j * 2 + w], b[k * 2 + w]);
                    if i == 0 {
                        let part = if w == 0 { *rc as u32 } else { (*rc >> 32) as u32 };
                        value = format!("{value} ^ 0x{part:08x}u");
                    }
                    let name = n(&format!("a{i}{w}"));
                    *s += &format!("  let {name} = {value};\n");
                    a[i * 2 + w] = name;
                }
            }
        }
    }
    a
}

pub const MAX_RESULTS: usize = 16;

/// Hledání nonce. `chunks` je počet bufferů DAG, `page_bits` log2 počtu 128bajtových stránek v bufferu.
/// Šestnáct slov se čte po čtveřicích: jedna instrukce místo čtyř, stejná šířka jako cesta do paměti.
pub fn search_shader(chunks: u32, page_bits: u32) -> String {
    let mut s = String::new();
    s += "struct Params { header: array<u32, 8>, nonce_lo: u32, nonce_hi: u32, target0: u32, target1: u32, pages: u32, pad0: u32, pad1: u32, pad2: u32 }\n";
    s += &format!("struct Output {{ count: atomic<u32>, items: array<u32, {}> }}\n", MAX_RESULTS * 2);
    s += "@group(0) @binding(0) var<storage, read> p: Params;\n";
    s += "@group(0) @binding(1) var<storage, read_write> out: Output;\n";
    for c in 0..chunks {
        s += &format!("@group(0) @binding({}) var<storage, read> dag{c}: array<vec4<u32>>;\n", c + 2);
    }
    s += FNV;
    s += "fn fnv4(a: vec4<u32>, b: vec4<u32>) -> vec4<u32> { return (a * 0x01000193u) ^ b; }\n";
    s += "fn bswap(v: u32) -> u32 { return (v << 24u) | ((v & 0xff00u) << 8u) | ((v >> 8u) & 0xff00u) | (v >> 24u); }\n";
    s += &format!("@compute @workgroup_size({WORKGROUP})\n");
    s += "fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n";
    s += "  let lo = p.nonce_lo + gid.x;\n  let hi = p.nonce_hi + select(0u, 1u, lo < gid.x);\n";
    s += "  let h0 = p.header[0]; let h1 = p.header[1]; let h2 = p.header[2]; let h3 = p.header[3];\n";
    s += "  let h4 = p.header[4]; let h5 = p.header[5]; let h6 = p.header[6]; let h7 = p.header[7];\n";

    let mut first: Vec<String> = (0..8).map(|i| format!("h{i}")).collect();
    first.push("lo".into());
    first.push("hi".into());
    first.resize(50, "0u".into());
    first[10] = "1u".into();
    first[17] = "0x80000000u".into();
    let st = keccak_inline(&mut s, "x", first);

    for i in 0..4 {
        s += &format!("  let seed{i} = vec4<u32>({}, {}, {}, {});\n", st[i * 4], st[i * 4 + 1], st[i * 4 + 2], st[i * 4 + 3]);
    }
    for i in 0..8 {
        s += &format!("  var m{i} = seed{};\n", i % 4);
    }
    let mask = (1u64 << page_bits) - 1;
    const LANES: [&str; 4] = ["x", "y", "z", "w"];
    for i in 0..64u32 {
        let word = i % 32;
        s += &format!("  let page{i} = fnv({i}u ^ {}, m{}.{}) % p.pages;\n", st[0], word / 4, LANES[(word % 4) as usize]);
        s += &format!("  let base{i} = (page{i} & 0x{mask:x}u) * 8u;\n");
        if chunks == 1 {
            for w in 0..8 {
                s += &format!("  m{w} = fnv4(m{w}, dag0[base{i} + {w}u]);\n");
            }
        } else {
            s += &format!("  switch (page{i} >> {page_bits}u) {{\n");
            for c in 0..chunks {
                let label = if c == chunks - 1 { "default".to_string() } else { format!("case {c}u") };
                s += &format!("    {label}: {{");
                for w in 0..8 {
                    s += &format!(" m{w} = fnv4(m{w}, dag{c}[base{i} + {w}u]);");
                }
                s += " }\n";
            }
            s += "  }\n";
        }
    }
    for i in 0..8 {
        s += &format!("  let q{i} = fnv(fnv(fnv(m{i}.x, m{i}.y), m{i}.z), m{i}.w);\n");
    }

    let mut second: Vec<String> = st[..16].to_vec();
    second.extend((0..8).map(|i| format!("q{i}")));
    second.resize(50, "0u".into());
    second[24] = "1u".into();
    second[33] = "0x80000000u".into();
    let k = keccak_inline(&mut s, "z", second);

    s += &format!("  let r0 = bswap({});\n  let r1 = bswap({});\n", k[0], k[1]);
    s += "  if (r0 < p.target0 || (r0 == p.target0 && r1 <= p.target1)) {\n";
    s += "    let n = atomicAdd(&out.count, 1u);\n";
    s += &format!("    if (n < {}u) {{ out.items[n * 2u] = lo; out.items[n * 2u + 1u] = hi; }}\n", MAX_RESULTS);
    s += "  }\n}\n";
    s
}

/// Výpočet DAG na grafické kartě.
pub fn dag_shader() -> String {
    let mut s = String::new();
    s += "struct Params { start: u32, rows: u32, out_offset: u32, pad: u32 }\n";
    s += "@group(0) @binding(0) var<storage, read> p: Params;\n";
    s += "@group(0) @binding(1) var<storage, read> cache: array<u32>;\n";
    s += "@group(0) @binding(2) var<storage, read_write> dag: array<u32>;\n";
    s += FNV;
    s += &keccak();
    s += &format!("@compute @workgroup_size({WORKGROUP})\n");
    s += r#"fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let item = p.start + gid.x;
  var st: array<u32, 50>;
  let c = (item % p.rows) * 16u;
  for (var k = 0u; k < 16u; k++) { st[k] = cache[c + k]; }
  st[0] ^= item; st[16] = 1u; st[17] = 0x80000000u;
  keccak_f(&st);
  var mix: array<u32, 16>;
  for (var k = 0u; k < 16u; k++) { mix[k] = st[k]; }
  for (var j = 0u; j < 256u; j++) {
    let parent = (fnv(item ^ j, mix[j % 16u]) % p.rows) * 16u;
    for (var k = 0u; k < 16u; k++) { mix[k] = fnv(mix[k], cache[parent + k]); }
  }
  var f: array<u32, 50>;
  for (var k = 0u; k < 16u; k++) { f[k] = mix[k]; }
  f[16] = 1u; f[17] = 0x80000000u;
  keccak_f(&f);
  let o = (p.out_offset + gid.x) * 16u;
  for (var k = 0u; k < 16u; k++) { dag[o + k] = f[k]; }
}
"#;
    s
}

pub const WORKGROUP_SIZE: u32 = WORKGROUP;
