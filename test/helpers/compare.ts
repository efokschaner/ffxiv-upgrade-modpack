import { allFiles, type ModpackData } from "../../src/model/modpack";

export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => structurallyEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>; const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    const av = ao[k]; const bv = bo[k];
    if ((av === null || av === undefined) && (bv === null || bv === undefined)) continue;
    if (!structurallyEqual(av, bv)) return false;
  }
  return true;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function compareInnerFilesByteIdentical(a: ModpackData, b: ModpackData): { ok: boolean; mismatches: string[] } {
  const map = (d: ModpackData) => new Map(allFiles(d).map((f) => [f.gamePath, f.data]));
  const am = map(a); const bm = map(b);
  const mismatches: string[] = [];
  for (const [path, data] of am) {
    const other = bm.get(path);
    if (!other) { mismatches.push(`missing in golden: ${path}`); continue; }
    if (!bytesEqual(data, other)) mismatches.push(`bytes differ: ${path}`);
  }
  for (const path of bm.keys()) if (!am.has(path)) mismatches.push(`extra in golden: ${path}`);
  return { ok: mismatches.length === 0, mismatches };
}
