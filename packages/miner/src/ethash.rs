//! Ethash na procesoru: lehká cache a ověření každého řešení před odesláním uzlu.
use tiny_keccak::{Hasher, Keccak};

pub const EPOCH_LENGTH: u64 = 30000;
const DATASET_PARENTS: u32 = 256;
const CACHE_ROUNDS: usize = 3;
const ACCESSES: u32 = 64;
const FNV_PRIME: u32 = 0x0100_0193;

fn is_prime(n: u64) -> bool {
    if n < 2 {
        return false;
    }
    if n % 2 == 0 {
        return n == 2;
    }
    let mut i = 3;
    while i * i <= n {
        if n % i == 0 {
            return false;
        }
        i += 2;
    }
    true
}

pub fn cache_size(epoch: u64) -> u64 {
    let mut size = (1u64 << 24) + (1u64 << 17) * epoch - 64;
    while !is_prime(size / 64) {
        size -= 128;
    }
    size
}

pub fn dataset_size(epoch: u64) -> u64 {
    let mut size = (1u64 << 30) + (1u64 << 23) * epoch - 128;
    while !is_prime(size / 128) {
        size -= 256;
    }
    size
}

pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut h = Keccak::v256();
    let mut out = [0u8; 32];
    h.update(data);
    h.finalize(&mut out);
    out
}

fn keccak512(data: &[u8]) -> [u8; 64] {
    let mut h = Keccak::v512();
    let mut out = [0u8; 64];
    h.update(data);
    h.finalize(&mut out);
    out
}

fn fnv(a: u32, b: u32) -> u32 {
    a.wrapping_mul(FNV_PRIME) ^ b
}

pub fn seed_hash(epoch: u64) -> [u8; 32] {
    let mut seed = [0u8; 32];
    for _ in 0..epoch {
        seed = keccak256(&seed);
    }
    seed
}

fn words_of(bytes: &[u8; 64]) -> [u32; 16] {
    let mut w = [0u32; 16];
    for (i, c) in bytes.chunks_exact(4).enumerate() {
        w[i] = u32::from_le_bytes([c[0], c[1], c[2], c[3]]);
    }
    w
}

fn bytes_of(words: &[u32; 16]) -> [u8; 64] {
    let mut b = [0u8; 64];
    for (i, w) in words.iter().enumerate() {
        b[i * 4..i * 4 + 4].copy_from_slice(&w.to_le_bytes());
    }
    b
}

/// Lehká cache epochy jako 32bitová slova little-endian.
pub fn generate_cache(size: u64, seed: &[u8; 32]) -> Vec<u32> {
    let rows = (size / 64) as usize;
    let mut cache = vec![[0u32; 16]; rows];
    let mut last = keccak512(seed);
    cache[0] = words_of(&last);
    for row in cache.iter_mut().skip(1) {
        last = keccak512(&last);
        *row = words_of(&last);
    }
    for _ in 0..CACHE_ROUNDS {
        for j in 0..rows {
            let src = cache[(j + rows - 1) % rows];
            let xor = cache[cache[j][0] as usize % rows];
            let mut temp = [0u32; 16];
            for k in 0..16 {
                temp[k] = src[k] ^ xor[k];
            }
            cache[j] = words_of(&keccak512(&bytes_of(&temp)));
        }
    }
    cache.into_iter().flatten().collect()
}

/// Jedna 64bajtová položka DAG spočítaná z lehké cache.
pub fn dataset_item(cache: &[u32], index: u32) -> [u32; 16] {
    let rows = (cache.len() / 16) as u32;
    let mut mix = [0u32; 16];
    mix.copy_from_slice(&cache[(index % rows) as usize * 16..(index % rows) as usize * 16 + 16]);
    mix[0] ^= index;
    mix = words_of(&keccak512(&bytes_of(&mix)));
    for j in 0..DATASET_PARENTS {
        let parent = (fnv(index ^ j, mix[(j % 16) as usize]) % rows) as usize;
        for k in 0..16 {
            mix[k] = fnv(mix[k], cache[parent * 16 + k]);
        }
    }
    words_of(&keccak512(&bytes_of(&mix)))
}

/// Výpočet hashimoto nad lehkou cache. Vrací mix digest a výsledek.
pub fn hashimoto_light(cache: &[u32], full_size: u64, header: &[u8; 32], nonce: u64) -> ([u8; 32], [u8; 32]) {
    let pages = (full_size / 128) as u32;
    let mut input = [0u8; 40];
    input[..32].copy_from_slice(header);
    input[32..].copy_from_slice(&nonce.to_le_bytes());
    let seed = keccak512(&input);
    let s = words_of(&seed);
    let mut mix = [0u32; 32];
    for i in 0..32 {
        mix[i] = s[i % 16];
    }
    for i in 0..ACCESSES {
        let parent = fnv(i ^ s[0], mix[i as usize % 32]) % pages;
        let a = dataset_item(cache, parent * 2);
        let b = dataset_item(cache, parent * 2 + 1);
        for k in 0..16 {
            mix[k] = fnv(mix[k], a[k]);
            mix[k + 16] = fnv(mix[k + 16], b[k]);
        }
    }
    let mut digest = [0u8; 32];
    for i in 0..8 {
        let c = fnv(fnv(fnv(mix[i * 4], mix[i * 4 + 1]), mix[i * 4 + 2]), mix[i * 4 + 3]);
        digest[i * 4..i * 4 + 4].copy_from_slice(&c.to_le_bytes());
    }
    let mut last = [0u8; 96];
    last[..64].copy_from_slice(&seed);
    last[64..].copy_from_slice(&digest);
    (digest, keccak256(&last))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex32(s: &str) -> [u8; 32] {
        let mut o = [0u8; 32];
        for i in 0..32 {
            o[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
        }
        o
    }

    #[test]
    fn velikosti() {
        assert_eq!(cache_size(0), 16776896);
        assert_eq!(dataset_size(0), 1073739904);
        assert_eq!(cache_size(1), 16907456);
        assert_eq!(dataset_size(1), 1082130304);
    }

    #[test]
    fn skutecny_blok_22_z_etherea() {
        let cache = generate_cache(cache_size(0), &seed_hash(0));
        let header = hex32("372eca2454ead349c3df0ab5d00b0b706b23e49d469387db91811cee0358fc6d");
        let (mix, result) = hashimoto_light(&cache, dataset_size(0), &header, 0x495732e0ed7a801c);
        assert_eq!(mix, hex32("2f74cdeb198af0b9abe65d22d372e22fb2d474371774a9583c1cc427a07939f5"));
        assert_eq!(result, hex32("00000b184f1fdd88bfd94c86c39e65db0c36144d5e43f745f722196e730cb614"));
    }

    #[test]
    fn skutecne_bloky_etherea_napric_epochami() {
        // Stejné bloky jako v testu uzlu, miner s uzlem se musí shodnout bajt po bajtu.
        let vektory = [
            (30000u64, "76a35fb221d2f471375c7db942b0513b9d0e2589711988cfb2ecdfaf5e171ba3", "a8e9c2db86671707", "dc0b2bc9e4f3fd8ce5d0d971a78d035fa964cf5714ae772990fe4d4562902dba"),
            (59999u64, "1aeb7bf2c3b1f3a89f7d319bc546711d6f7876dcf3691479ab3b03461f73a5c3", "0d14080598b6cb24", "f12fe4060d0077ddd44643927a723a1eeec138b9c1e88b29df53f36c3e69a78b"),
            (60000u64, "6715fced93c1adb320c3a53a48dc8ef4974be091406249cbc251e2af6badf5e2", "15b925123675bb6c", "0d89d35d270e4a6147db970f12372ca72753a14756a7cfe811fe716a4ff5d64d"),
            (1000000u64, "1b8a36104313bd87fc7679a7d073e7292de22a0e055bdf36df1f8fd011d2a53a", "cd4c55b941cf9015", "92c4129a0ae2361b452a9edeece55c12eceeab866316195e3d87fc1b005b6645"),
            (4500000u64, "ec2d03946cddf8f1e4ae17b31eb3a0446d3d6ec48b3cd36d3592304293f33eb1", "603e7140080abc2d", "c9d96b3dc6cef784cee881317abb5f724e8bd3f3ba4744212e3263cbdd093eb5"),
            (7000000u64, "231eca6104ec39399e66ca6e8deeb803e01d737fc27f585d2c7ec874f99856ee", "9813a6b0181c0880", "c21561e4cf2933f9d4312bdba29e7a9cc0b06d838a518af6fd92934cd1cdf95d"),
            (12000000u64, "1940ee93bb48f1982b9fc546ae69ca9a59de4e55f9944900b3abf04436eb1ee1", "b62c052c3d4a3866", "114f16f97d044682678844ea69212d6764998107ccb698fc6ae4fd2d71a33104"),
            (15537393u64, "8ca1efe3b67419eadf7d1a1f4cc9b18e5131a189908624708bd0d28d07eeedb6", "62a3ee77461d4fc9", "4cbec03dddd4b939730a7fe6048729604d4266e82426d472a2b2024f3cc4043f"),
        ];
        for (cislo, seal, nonce, mix) in vektory {
            let epoch = cislo / 30000;
            let cache = generate_cache(cache_size(epoch), &seed_hash(epoch));
            let nonce = u64::from_str_radix(nonce, 16).unwrap();
            let (digest, _) = hashimoto_light(&cache, dataset_size(epoch), &hex32(seal), nonce);
            assert_eq!(digest, hex32(mix), "blok {cislo}, epocha {epoch}");
        }
    }
}
