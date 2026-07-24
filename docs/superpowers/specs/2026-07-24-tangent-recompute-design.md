# Port `CalculateTangents`' full binormal/handedness recompute — Design & handoff

**Date:** 2026-07-24
**Status:** Implemented 2026-07-24.

R2 (§5) was decided by coverage: `test/mdl/model/binormals-present.test.ts` never called
`getWeldedMeshData`/`calculateTangentsForMesh` (it only parsed vertex declarations), and the parse
functions it did exercise (`parseMdl`/`parseGeometryLayout`/`parseVertexDeclarations`) were already at
100% line/branch coverage from the corpus `/upgrade`/`/resave` harness independent of R2 — so removing
it dropped no line from covered to uncovered. **Retired**
(`git rm test/mdl/model/binormals-present.test.ts`). Also confirmed empirically: `Math.fround` was
**not** needed — the float64 vector math in `calculateTangentsForMesh`/`getWeldedMeshData` matched the
`/resave` golden byte-for-byte on the first run.

**Goal:** port the unported "full recompute" branch of `ModelModifiers.CalculateTangentsForMesh`
(`ModelModifiers.cs:2140-2253`) plus its weld helper `GetWeldedMeshData` (`:1935-2100`), so a LoD0
mesh that carries **no** binormals gets its `Binormal` and `Handedness` recomputed on load exactly as
TexTools does — instead of our port silently emitting all-zero binormals.

**Closes:** [`docs/backlog/2026-07-21-unported-tangent-recompute.md`](../../backlog/2026-07-21-unported-tangent-recompute.md)
(prioritized #1) — this spec becomes its durable record.

**Roadmap:** design §8.1 model-normalizer row (round-4 model port). Read the foundation spec
([`2026-06-30-dawntrail-modpack-upgrader-design.md`](2026-06-30-dawntrail-modpack-upgrader-design.md))
first for where this fits.

**Builds on:** the model-normalizer work that ported `MergeGeometryData` / `MergeShapeData` /
`CopyShapeTangentsForPart` (as `copyShapeBinormals`) into `src/mdl/model/model-modifiers.ts`. This
design finishes `CalculateTangents` by adding the branch those left out.

---

## 1. The problem

`ModelModifiers.CalculateTangentsForMesh` (`ModelModifiers.cs:2102-2138`) dispatches per mesh group:

- **Fast path** (`:2127-2137`) — taken when **any** vertex has a non-zero binormal. Writes only the
  *unserialized* `Tangent`, then `CopyShapeTangentsForPart`. Byte-neutral apart from the shape copy,
  which is already ported as `copyShapeBinormals`.
- **Full recompute** (`:2140-2253`) — taken when **no** vertex has a binormal. Welds the mesh
  (`GetWeldedMeshData`, `:1935-2100`), accumulates per-triangle tangent/bitangent sums, then writes
  `Binormal` **and** `Handedness` onto every welded base vertex (both serialized), and finally
  `CopyShapeTangentsForPart`. **This branch — and the weld helper it calls — is unported.**

`from-raw.ts` omits `CalculateTangents` entirely on the strength of R2
(`test/mdl/model/binormals-present.test.ts`), the corpus scan asserting every LoD0 mesh carries
binormals so only the fast path can run. R2 now has one counterexample:

```
SM-Cherry Blossom Upscale.ttmp2 :: bgcommon/hou/outdoor/general/0112/bgparts/gar_b0_m0112.mdl mesh 0
```

`normalizeModel` on that model **succeeds** (2776 bytes out) — no fail-loud guard catches it — so our
output carries all-zero binormals where TexTools carries computed ones. Rubric class 1 (silent wrong
output).

## 2. There IS a real oracle — the backlog item's premise is falsified

The backlog item claims "no oracle covers it": the pack's `/upgrade` golden is a `.noop`, so
`/upgrade` never compares the normalized bytes. That is true for `/upgrade` but **not** for
`/resave`. TexTools' load path — `WizardData.FromWizardGroup` → `FixOldModel` →
`Mdl.GetXivMdl` → `TTModel.FromRaw` → `CalculateTangents` (`TTModel.cs:2728`) — is taken by **both**
`/upgrade` and `/resave` (see `src/upgrade/load-fixes.ts`'s header). `/resave` always **writes** the
load-fixed model, so its golden captures the recomputed binormals even when `/upgrade` no-ops.

**Confirmed empirically** (2026-07-24) by decoding `gar_b0_m0112.mdl` from our normalized output and
from the cached `/resave` golden (`test/corpus/.resave-cache/be237…b43.bin`):

```
ours 2776 B   golden 2776 B   169 differing bytes
byte 0:        ours=6  golden=5              ← the known v6-version seam (separate item, see §6)
bytes 1280…:   48 × 4-byte groups, stride 28 ← the Ubyte4n Binormal element
OURS   binormals: all zero (quantized 128,128,128)
GOLDEN binormals: -0.498,-0.004,-0.867 …     ← TexTools' recomputed values
```

So this is a normal byte-parity port with a mechanical oracle already cached, recorded today in the
pack's `/resave` baseline
(`test/corpus/.resave-baseline/be237…b43.json`) as an opaque `payload` mismatch
(`gar_b0_m0112.mdl … 2776 vs 2776 bytes`). The port turns those 168 binormal bytes byte-exact; byte 0
(the v6 seam) stays baselined under its own item.

## 3. Design

### 3.1 New code, in `src/mdl/model/model-modifiers.ts` (split, don't blend)

All three symbols belong to `ModelModifiers`, so they live beside the already-ported merges. Each
cites `file · symbol · lines`.

- **`getWeldedMeshData(group)`** — port of `GetWeldedMeshData` (`:1935-2100`), `weldMirrors=false`
  only (the recompute never passes `true`). Returns `{ indices, vertexTable }` where `vertexTable[n]`
  is the list of original `TtVertex` objects welded into new vertex `n`. Steps, in order:
  1. Concatenate parts: `indices` = each part's `triangleIndices` offset by the running vertex count;
     `vertices` = parts' vertices concatenated.
  2. Build the triangle-adjacency graph `connectedVertices: Map<number, Set<number>>` from every
     triangle (each of the three vertices connected to the other two).
  3. Weld: for each vertex in order, bucket by weld key, and merge into an existing welded vertex iff
     `UV1`, `Position`, and `Normal` are all equal **and** it is not a UV-seam mirror point (the
     `alreadyConnectedVertices` / `myConnectedVerts` cross-check at `:2036-2054`). Otherwise start a
     new welded vertex.
  4. Translate indices through `oldToNewVertex`.

- **`calculateTangentsFromBinormalsForPart(part)`** — port of `CalculateTangentsFromBinormalsForPart`
  (`:2272-2281`): writes the unserialized `Tangent` (we skip it), then `copyShapeBinormals` for that
  part. Because `Tangent` is never serialized, this reduces to the shape-binormal copy — i.e. exactly
  what `copyShapeBinormals` already does per part. We therefore reuse `copyShapeBinormals`'s body at
  part granularity rather than duplicating it (see §3.2).

- **`calculateTangentsForMesh(group)`** — port of `CalculateTangentsForMesh` (`:2102-2138` +
  `:2140-2253`), `force=false` only:
  1. `VertexCount==0 || IndexCount==0` → return.
  2. `anyMissing` scan (`:2111-2124`): if every part already has both a non-zero tangent and non-zero
     binormal, return. (Our `Tangent` is always zero — unserialized — so `anyMissing` is effectively
     always true here; reproduced faithfully for control-flow fidelity, and it correctly still runs
     the fast path below when binormals are present.)
  3. Fast path (`:2127-2137`): if any vertex has a non-zero binormal, run
     `calculateTangentsFromBinormalsForPart` per part and return.
  4. Full recompute (`:2140-2253`): weld, accumulate `sdir/tdir` per triangle, then per welded vertex
     compute `binormal = cross(n, normalize(t)).normalized()`, `handedness = dot(normalize(binormal),
     b) >= 0`, `binormal *= sign`, and fan out onto **every** original vertex welded into it. Finally
     `copyShapeBinormals` per part.

### 3.2 `from-raw.ts` restructure

Replace the unconditional `copyShapeBinormals(model)` call with a per-group loop calling
`calculateTangentsForMesh(group)`. This keeps the C# control-flow shape: `CopyShapeTangentsForPart`
runs at the end of **both** branches, so the shape-binormal copy still happens on the fast path
exactly as today, and the recompute happens on the binormal-less path. Net behaviour for every
current corpus model except `gar_b0_m0112.mdl` mesh 0 is unchanged (they all take the fast path); byte
parity for those is re-proven by the existing `/resave` + `/upgrade` goldens.

### 3.3 Two deliberate parity decisions (documented at the site)

1. **Weld hash is not reproduced.** C# `TTVertex.GetWeldHash` (`TTModel.cs:112-122`) is an `int`
   hash of `Position/UV1/Normal` used **only** to bucket weld candidates; the actual weld gate is the
   explicit `==` on those same three fields (`:2011-2013`). The hash value therefore cannot change the
   outcome — it only affects which bucket a candidate lands in, and two vertices in different buckets
   are never equal under the `==` gate anyway. We bucket by a canonical string/number key of
   `(Position, UV1, Normal)` and apply the same `==` gate inside. Provably equivalent; documented.

2. **Float32 semantics via `Math.fround`, added empirically.** SharpDX `Vector3` math is
   single-precision; JS is double. Binormals serialize as `Ubyte4n` (8 bits/component,
   `round((v+1)*127.5)`), so a double-vs-float difference only moves a byte when a component sits on a
   `1/255` quantization boundary — rare. Following the established repo pattern (`computeRadius` in
   `bounding-box.ts` uses per-op `Math.fround`), we implement the vector math in float64 first, verify
   byte-for-byte against the `/resave` golden, and add `Math.fround` **only** where a byte actually
   moves. The oracle makes this empirical, not speculative. If full float32 fidelity proves necessary,
   the fallback is per-operation `Math.fround` throughout the accumulation and normalization, matching
   `computeRadius`.

## 4. Validation

Per the operator decision (2026-07-24): rely on the existing `/resave` oracle plus a synthetic unit
test. **No** committed synthetic `/upgrade` pack is authored — the `/upgrade` protection is proven
transitively (same load-fix code), and authoring raw binormal-less `.mdl` bytes in a builder is not
justified given the real oracle already exists.

- **Primary — real oracle (new corpus-gated test).** Normalize `gar_b0_m0112.mdl` from
  `SM-Cherry Blossom Upscale.ttmp2` and assert byte-equality with the cached `/resave` golden
  **except byte 0** (the documented v6 seam, §6). No-ops on a fresh clone like every corpus test
  (`assertCorpusPresent` guard). This is a genuine ConsoleTools AB-test of the recompute. It also lets
  us **remove** the `gar_b0_m0112.mdl` payload entry from the `/resave` baseline down to the byte-0
  seam residual (re-bless after the port).

- **Supplementary — synthetic unit test.** `gar_b0_m0112.mdl` mesh 0 has 48 vertices and (per the
  weld) likely no merges, so the weld/mirror logic is **not** exercised by the oracle. Add a
  hand-built `TTMeshGroup` unit test (duplicate-position vertices that must weld, plus a UV-seam mirror
  pair that must **not** weld) with expected binormal/handedness derived from the C# math, per
  AGENTS.md "cases too deep or edge-casey for a golden."

## 5. R2 disposition — decided by coverage, at the end

R2 (`test/mdl/model/binormals-present.test.ts`) exists to prove the unported branch is *unreachable*.
Once the branch is ported, that purpose dissolves. **The disposition is not chosen up front** (operator
decision, 2026-07-24): after the port lands and both new tests are green, run `npm run test:coverage`
and check whether R2's corpus scan is the *only* thing exercising any line the new oracle + unit test
do not reach.

- If removing R2 would drop coverage on a real path → **repurpose** it (flip its assertion from
  "unreachable" to "reached and handled"; drop `KNOWN_WITHOUT_BINORMALS`).
- If the new tests fully subsume its reach → **retire** it.

Either way, the `KNOWN_WITHOUT_BINORMALS` reference to the backlog item must go when the item is
deleted (grep `2026-07-21-unported-tangent-recompute` across `src/ test/ scripts/ docs/`).

## 6. Interaction with the v6-bump seam (out of scope)

Byte 0 of `gar_b0_m0112.mdl` differs (ours v6, golden v5) because our load fix bumps the version
unconditionally while TexTools bumps only in the upgrade caller — the separate, still-open item
[`docs/backlog/2026-07-13-resave-mdl-v6-bump-seam.md`](../../backlog/2026-07-13-resave-mdl-v6-bump-seam.md).
This spec does **not** touch that seam. The primary test excludes byte 0 explicitly and cites that
item; the `/resave` baseline retains a byte-0-only residual for the pack until the v6 item lands.

## 7. Fail-loud posture

Unchanged. The recompute either succeeds or throws (a genuine structural surprise, e.g. an index out
of range in the weld) — and a throw propagates to `makeTtmpLoadFix`'s `catch → return null`, dropping
the file. The backlog item's warning against a *gratuitous* throw at this seam (a "we don't support
this branch" throw would drop a model TexTools keeps) is honored by **porting** the branch, not by
throwing. Any throw that remains is a real error path, matching the C#'s own unguarded array accesses.

## 8. Out of scope

- The `weldMirrors=true` path of `GetWeldedMeshData` (never reached from the recompute).
- `Tangent` serialization (never serialized; correctly omitted throughout).
- The v6-bump seam (§6).
- Any synthetic `/upgrade` pack (§4).
