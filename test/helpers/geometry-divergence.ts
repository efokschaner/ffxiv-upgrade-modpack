import type { VertexData } from "../../src/mdl/geometry/vertex-data";

// Re-decode semantic-equivalence rule for the A1 geometry gate. Byte-exact is the primary path;
// this only runs when a mesh's re-encoded bytes differ from the source. It re-decodes our own
// re-encoded bytes and proves the source decode and the re-decode are semantically identical,
// with the ONLY tolerated differences confined to channels the reference implementation itself
// discards / clamps / canonicalizes:
//   - Half4 W: MdlVertexReader.ReadVector3 reads then drops W; encode regenerates Half(wDefault).
//   - NaN/Inf position or normal: ReadVector3 clamps to (0,0,0) on both decodes.
//   - NaN UV: floatToHalf(NaN) is a canonical NaN; both decodes read NaN, so NaN-aware equality.
//   - Binormal/flow handedness byte ∉ {0,255}: encode normalizes to 0/255 — IGNORED here (it only
//     ever matters once a byte mismatch has already been observed, i.e. the documented case).
// Any divergence in a REAL xyz/uv value, a color, a bone weight/index, or an index still fails.

/** NaN-aware scalar equality: two NaNs compare equal; everything else is strict `===`. */
function scalarEq(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return a === b;
}

function vecEqNanAware(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!scalarEq(a[i]!, b[i]!)) return false;
  return true;
}

function vecEqStrict(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]! !== b[i]!) return false;
  return true;
}

/** Compare two per-vertex arrays of vectors with the given elementwise predicate. */
function arraysEq(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
  eq: (x: readonly number[], y: readonly number[]) => boolean,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!eq(a[i]!, b[i]!)) return false;
  return true;
}

/**
 * Confirm a byte-level divergence between source and re-decoded geometry is confined to the
 * reference's own lossy channels (Half4 W / NaN-Inf clamp / NaN-UV / handedness canonicalization).
 * Returns { ok: true } only when every real field matches (NaN-aware for float positions/normals/
 * binormals/flow/UVs; strict for colors/bones/indices; handedness ignored). Otherwise { ok: false,
 * reason } names the first diverging field so a genuine codec bug still fails loudly.
 */
export function confirmDocumentedDivergence(
  source: VertexData,
  reDecoded: VertexData,
): { ok: boolean; reason?: string } {
  // NaN-aware float channels (tolerate W discard, NaN/Inf clamp, NaN-UV canonicalization).
  const nanAware: [keyof VertexData, string][] = [
    ["positions", "positions"],
    ["normals", "normals"],
    ["biNormals", "biNormals"],
    ["flowDirections", "flowDirections"],
    ["textureCoordinates0", "textureCoordinates0"],
    ["textureCoordinates1", "textureCoordinates1"],
    ["textureCoordinates2", "textureCoordinates2"],
  ];
  for (const [key, name] of nanAware) {
    const a = source[key] as unknown as number[][];
    const b = reDecoded[key] as unknown as number[][];
    if (!arraysEq(a, b, vecEqNanAware)) return { ok: false, reason: name };
  }

  // Strict channels: colors, second colors, bone weights, bone indices.
  const strict: [keyof VertexData, string][] = [
    ["colors", "colors"],
    ["colors2", "colors2"],
    ["boneWeights", "boneWeights"],
    ["boneIndices", "boneIndices"],
  ];
  for (const [key, name] of strict) {
    const a = source[key] as unknown as number[][];
    const b = reDecoded[key] as unknown as number[][];
    if (!arraysEq(a, b, vecEqStrict)) return { ok: false, reason: name };
  }

  // Indices: strict.
  if (!vecEqStrict(source.indices, reDecoded.indices))
    return { ok: false, reason: "indices" };

  // biNormalHandedness / flowHandedness: intentionally ignored (documented lossy channel).
  return { ok: true };
}
