import type { EqdpEntry, EstEntry, ItemMeta } from "./types";

// Port of ItemMetadata.Deserialize (ItemMetadata.cs:869-967). Reads the header table then each
// present segment. EQP/GMP/IMC kept as opaque bytes; EQDP/EST structured (ItemMetadata.cs:715-847).
const TYPE_IMC = 1;
const TYPE_EQDP = 2;
const TYPE_EQP = 3;
const TYPE_EST = 4;
const TYPE_GMP = 5;

export function deserializeMeta(data: Uint8Array): ItemMeta {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = dv.getUint32(0, true);
  let p = 4;
  let path = "";
  while (data[p] !== 0) {
    path += String.fromCharCode(data[p]!);
    p++;
  }
  p++; // skip NUL
  const headerCount = dv.getUint32(p, true);
  const perHeaderSize = dv.getUint32(p + 4, true);
  const headerStart = dv.getUint32(p + 8, true);

  const seg = new Map<number, { offset: number; size: number }>();
  for (let i = 0; i < headerCount; i++) {
    const base = headerStart + i * perHeaderSize;
    seg.set(dv.getUint32(base, true), {
      offset: dv.getUint32(base + 4, true),
      size: dv.getUint32(base + 8, true),
    });
  }

  const imcSeg = seg.get(TYPE_IMC);
  let imc: Uint8Array[] | null = null;
  if (imcSeg) {
    imc = [];
    for (let o = 0; o < imcSeg.size; o += 6) {
      imc.push(data.slice(imcSeg.offset + o, imcSeg.offset + o + 6));
    }
  }

  const eqpSeg = seg.get(TYPE_EQP);
  const eqp = eqpSeg
    ? data.slice(eqpSeg.offset, eqpSeg.offset + eqpSeg.size)
    : null;

  const eqdpSeg = seg.get(TYPE_EQDP);
  let eqdp: EqdpEntry[] | null = null;
  if (eqdpSeg) {
    eqdp = [];
    for (let o = 0; o < eqdpSeg.size; o += 5) {
      const b = eqdpSeg.offset + o;
      eqdp.push({ race: dv.getUint32(b, true), value: dv.getUint8(b + 4) });
    }
  }

  const estSeg = seg.get(TYPE_EST);
  let est: EstEntry[] | null = null;
  if (estSeg) {
    est = [];
    for (let o = 0; o < estSeg.size; o += 6) {
      const b = estSeg.offset + o;
      est.push({
        race: dv.getUint16(b, true),
        setId: dv.getUint16(b + 2, true),
        skelId: dv.getUint16(b + 4, true),
      });
    }
  }

  const gmpSeg = seg.get(TYPE_GMP);
  const gmp = gmpSeg
    ? data.slice(gmpSeg.offset, gmpSeg.offset + gmpSeg.size)
    : null;

  return { version, path, imc, eqp, eqdp, est, gmp };
}
