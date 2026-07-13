// SHA-1 (FIPS 180-1). Scaffolding, not a port: it stands in for C#'s `SHA1.Create()` in
// ResolveDuplicates (PmpExtensions.cs:478), where the digest is used ONLY as a content-equality key
// for deduplication — never persisted, never compared against a TexTools-produced hash. Any
// collision-resistant hash would reproduce TexTools' behaviour; SHA-1 is what the C# uses, so we
// use it too and keep the mapping obvious. Implemented here rather than via node:crypto because the
// library is browser-targeted, and via SubtleCrypto's async API is unusable from a sync writer.

function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

/** SHA-1 digest of `data`, returned as lowercase hex (40 chars). */
export function sha1Hex(data: Uint8Array): string {
  const bitLen = data.length * 8;
  // Padding: 0x80, then zero bytes, until length % 64 == 56, then the 64-bit big-endian bit length.
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  // bitLen fits in 32 bits for any input this library ever hashes (well under 2^32 bits ==
  // 512MiB); the high 32 bits of the FIPS 180-1 64-bit length field are therefore always zero.
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getInt32(offset + t * 4, false);
    }
    for (let t = 16; t < 80; t++) {
      w[t] = rotl(w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!, 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let t = 0; t < 80; t++) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[t]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}
