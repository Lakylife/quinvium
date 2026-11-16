// Ethash for OpenCL: the same algorithm as ethash.rs and shader.rs. Every solution is checked on the CPU before it is submitted.
// Macros are filled in by cl.rs: PARTS is the number of DAG buffers, PART_BITS the size of one of them in pages of 128 bytes.
#define FNV_PRIME 0x01000193U
#define FNV(x, y) (((x) * FNV_PRIME) ^ (y))
#define ROL(x, n) rotate((ulong)(x), (ulong)(n))

__constant ulong RC[24] = {
  0x0000000000000001UL, 0x0000000000008082UL, 0x800000000000808AUL, 0x8000000080008000UL, 0x000000000000808BUL, 0x0000000080000001UL,
  0x8000000080008081UL, 0x8000000000008009UL, 0x000000000000008AUL, 0x0000000000000088UL, 0x0000000080008009UL, 0x000000008000000AUL,
  0x000000008000808BUL, 0x800000000000008BUL, 0x8000000000008089UL, 0x8000000000008003UL, 0x8000000000008002UL, 0x8000000000000080UL,
  0x000000000000800AUL, 0x800000008000000AUL, 0x8000000080008081UL, 0x8000000000008080UL, 0x0000000080000001UL, 0x8000000080008008UL,
};

// One round of Keccak-f1600 over the variables a0..a24.
#define KECCAK_ROUND(r) { \
  c0 = a0 ^ a5 ^ a10 ^ a15 ^ a20; c1 = a1 ^ a6 ^ a11 ^ a16 ^ a21; c2 = a2 ^ a7 ^ a12 ^ a17 ^ a22; \
  c3 = a3 ^ a8 ^ a13 ^ a18 ^ a23; c4 = a4 ^ a9 ^ a14 ^ a19 ^ a24; \
  d0 = c4 ^ ROL(c1, 1); d1 = c0 ^ ROL(c2, 1); d2 = c1 ^ ROL(c3, 1); d3 = c2 ^ ROL(c4, 1); d4 = c3 ^ ROL(c0, 1); \
  b0 = a0 ^ d0;              b10 = ROL(a1 ^ d1, 1);    b20 = ROL(a2 ^ d2, 62);   b5 = ROL(a3 ^ d3, 28);    b15 = ROL(a4 ^ d4, 27); \
  b16 = ROL(a5 ^ d0, 36);    b1 = ROL(a6 ^ d1, 44);    b11 = ROL(a7 ^ d2, 6);    b21 = ROL(a8 ^ d3, 55);   b6 = ROL(a9 ^ d4, 20); \
  b7 = ROL(a10 ^ d0, 3);     b17 = ROL(a11 ^ d1, 10);  b2 = ROL(a12 ^ d2, 43);   b12 = ROL(a13 ^ d3, 25);  b22 = ROL(a14 ^ d4, 39); \
  b23 = ROL(a15 ^ d0, 41);   b8 = ROL(a16 ^ d1, 45);   b18 = ROL(a17 ^ d2, 15);  b3 = ROL(a18 ^ d3, 21);   b13 = ROL(a19 ^ d4, 8); \
  b14 = ROL(a20 ^ d0, 18);   b24 = ROL(a21 ^ d1, 2);   b9 = ROL(a22 ^ d2, 61);   b19 = ROL(a23 ^ d3, 56);  b4 = ROL(a24 ^ d4, 14); \
  a0 = b0 ^ (~b1 & b2) ^ RC[r]; a1 = b1 ^ (~b2 & b3); a2 = b2 ^ (~b3 & b4); a3 = b3 ^ (~b4 & b0); a4 = b4 ^ (~b0 & b1); \
  a5 = b5 ^ (~b6 & b7); a6 = b6 ^ (~b7 & b8); a7 = b7 ^ (~b8 & b9); a8 = b8 ^ (~b9 & b5); a9 = b9 ^ (~b5 & b6); \
  a10 = b10 ^ (~b11 & b12); a11 = b11 ^ (~b12 & b13); a12 = b12 ^ (~b13 & b14); a13 = b13 ^ (~b14 & b10); a14 = b14 ^ (~b10 & b11); \
  a15 = b15 ^ (~b16 & b17); a16 = b16 ^ (~b17 & b18); a17 = b17 ^ (~b18 & b19); a18 = b18 ^ (~b19 & b15); a19 = b19 ^ (~b15 & b16); \
  a20 = b20 ^ (~b21 & b22); a21 = b21 ^ (~b22 & b23); a22 = b22 ^ (~b23 & b24); a23 = b23 ^ (~b24 & b20); a24 = b24 ^ (~b20 & b21); }

#define KECCAK_F() { \
  ulong c0, c1, c2, c3, c4, d0, d1, d2, d3, d4; \
  ulong b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15, b16, b17, b18, b19, b20, b21, b22, b23, b24; \
  for (uint r = 0; r < 24; r++) KECCAK_ROUND(r) }

// Keccak-512 of 64 bytes in the array s[8]; used when computing the DAG.
static inline void keccak512_64(ulong *s) {
  ulong a0 = s[0], a1 = s[1], a2 = s[2], a3 = s[3], a4 = s[4], a5 = s[5], a6 = s[6], a7 = s[7], a8 = 0x8000000000000001UL;
  ulong a9 = 0, a10 = 0, a11 = 0, a12 = 0, a13 = 0, a14 = 0, a15 = 0, a16 = 0, a17 = 0, a18 = 0, a19 = 0, a20 = 0, a21 = 0, a22 = 0, a23 = 0, a24 = 0;
  KECCAK_F();
  s[0] = a0; s[1] = a1; s[2] = a2; s[3] = a3; s[4] = a4; s[5] = a5; s[6] = a6; s[7] = a7;
}

#if PARTS == 1
#define DAG_ARGS __global const uint16 *restrict d0
#elif PARTS == 2
#define DAG_ARGS __global const uint16 *restrict d0, __global const uint16 *restrict d1
#elif PARTS == 3
#define DAG_ARGS __global const uint16 *restrict d0, __global const uint16 *restrict d1, __global const uint16 *restrict d2
#else
#define DAG_ARGS __global const uint16 *restrict d0, __global const uint16 *restrict d1, __global const uint16 *restrict d2, __global const uint16 *restrict d3
#endif

// A DAG page is 128 bytes, that is two uint16 items in a row.
typedef union { uint16 v[2]; uint w[32]; } mix_t;

__kernel void search(__global volatile uint *restrict output, DAG_ARGS,
                     uint h0, uint h1, uint h2, uint h3, uint h4, uint h5, uint h6, uint h7, ulong start, ulong target, uint pages) {
  const ulong nonce = start + get_global_id(0);
  ulong a0 = (ulong)h0 | ((ulong)h1 << 32), a1 = (ulong)h2 | ((ulong)h3 << 32), a2 = (ulong)h4 | ((ulong)h5 << 32), a3 = (ulong)h6 | ((ulong)h7 << 32);
  ulong a4 = nonce, a5 = 1UL, a6 = 0, a7 = 0, a8 = 0x8000000000000000UL;
  ulong a9 = 0, a10 = 0, a11 = 0, a12 = 0, a13 = 0, a14 = 0, a15 = 0, a16 = 0, a17 = 0, a18 = 0, a19 = 0, a20 = 0, a21 = 0, a22 = 0, a23 = 0, a24 = 0;
  KECCAK_F();
  const ulong s0 = a0, s1 = a1, s2 = a2, s3 = a3, s4 = a4, s5 = a5, s6 = a6, s7 = a7;

  mix_t m;
  m.v[0].s01 = (uint2)((uint)s0, (uint)(s0 >> 32)); m.v[0].s23 = (uint2)((uint)s1, (uint)(s1 >> 32));
  m.v[0].s45 = (uint2)((uint)s2, (uint)(s2 >> 32)); m.v[0].s67 = (uint2)((uint)s3, (uint)(s3 >> 32));
  m.v[0].s89 = (uint2)((uint)s4, (uint)(s4 >> 32)); m.v[0].sab = (uint2)((uint)s5, (uint)(s5 >> 32));
  m.v[0].scd = (uint2)((uint)s6, (uint)(s6 >> 32)); m.v[0].sef = (uint2)((uint)s7, (uint)(s7 >> 32));
  m.v[1] = m.v[0];
  const uint init0 = (uint)s0;
  for (uint i = 0; i < 64; i++) {
    const uint p = FNV(init0 ^ i, m.w[i & 31]) % pages;
#if PARTS == 1
    __global const uint16 *page = d0 + (size_t)p * 2;
#elif PARTS == 2
    __global const uint16 *page = (((p >> PART_BITS) == 0) ? d0 : d1) + (size_t)(p & PART_MASK) * 2;
#elif PARTS == 3
    const uint part = p >> PART_BITS;
    __global const uint16 *page = (part == 0 ? d0 : part == 1 ? d1 : d2) + (size_t)(p & PART_MASK) * 2;
#else
    const uint part = p >> PART_BITS;
    __global const uint16 *page = (part == 0 ? d0 : part == 1 ? d1 : part == 2 ? d2 : d3) + (size_t)(p & PART_MASK) * 2;
#endif
    m.v[0] = FNV(m.v[0], page[0]);
    m.v[1] = FNV(m.v[1], page[1]);
  }
  uint c[8];
  for (uint k = 0; k < 8; k++) {
    uint x = FNV(m.w[k * 4], m.w[k * 4 + 1]);
    x = FNV(x, m.w[k * 4 + 2]);
    c[k] = FNV(x, m.w[k * 4 + 3]);
  }

  a0 = s0; a1 = s1; a2 = s2; a3 = s3; a4 = s4; a5 = s5; a6 = s6; a7 = s7;
  a8 = (ulong)c[0] | ((ulong)c[1] << 32); a9 = (ulong)c[2] | ((ulong)c[3] << 32);
  a10 = (ulong)c[4] | ((ulong)c[5] << 32); a11 = (ulong)c[6] | ((ulong)c[7] << 32);
  a12 = 1UL; a13 = 0; a14 = 0; a15 = 0; a16 = 0x8000000000000000UL; a17 = 0; a18 = 0; a19 = 0; a20 = 0; a21 = 0; a22 = 0; a23 = 0; a24 = 0;
  KECCAK_F();
  const uint lo = (uint)a0, hi = (uint)(a0 >> 32);
  const ulong top = ((ulong)(rotate(lo & 0x00FF00FFU, 24U) | rotate(lo & 0xFF00FF00U, 8U)) << 32)
                  | (ulong)(rotate(hi & 0x00FF00FFU, 24U) | rotate(hi & 0xFF00FF00U, 8U));
  if (top <= target) {
    const uint n = atomic_inc(&output[0]);
    if (n < MAX_RESULTS) {
      output[1 + n * 2] = (uint)nonce;
      output[2 + n * 2] = (uint)(nonce >> 32);
    }
  }
}

// DAG items are 64 bytes. The output goes into one part, the caller sets the offset.
__kernel void dag_items(__global uint16 *restrict out, __global const uint16 *restrict cache, uint start, uint out_base, uint rows) {
  const uint item = start + get_global_id(0);
  union { uint16 v; uint w[16]; ulong q[8]; } s;
  s.v = cache[item % rows];
  s.w[0] ^= item;
  {
    ulong q[8];
    for (uint k = 0; k < 8; k++) q[k] = s.q[k];
    keccak512_64(q);
    for (uint k = 0; k < 8; k++) s.q[k] = q[k];
  }
  for (uint j = 0; j < 256; j++) {
    const uint parent = FNV(item ^ j, s.w[j & 15]) % rows;
    s.v = FNV(s.v, cache[parent]);
  }
  ulong q[8];
  for (uint k = 0; k < 8; k++) q[k] = s.q[k];
  keccak512_64(q);
  for (uint k = 0; k < 8; k++) s.q[k] = q[k];
  out[get_global_id(0) + out_base] = s.v;
}
