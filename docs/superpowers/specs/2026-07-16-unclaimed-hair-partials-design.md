# Round 6 partials — unclaimed hair/tail/ear/accessory textures

**Date:** 2026-07-16
**Status:** Design signed off; implementation in progress.
**Foundation:** extends the roadmap design
(`docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md`, §5 bundled reference
assets, §8 burndown). This shipped the work formerly tracked as the Round-6 unclaimed-hair backlog
item (now retired).

**Goal:** Port the round-6 "partial texture-only" heuristics that rescue an **incomplete mod** — one
that ships pre-Dawntrail hair/tail/ear/accessory *textures* without the *material* that references
them — by copying those loose textures to Dawntrail's new pathing (and, for hair/tail/ear, running
the hair pixel transform). This ports `EndwalkerUpgrade.UpdateUnclaimedHairTextures` /
`UpdateUnclaimedHairAccessory` (`EndwalkerUpgrade.cs:1324-1716`) plus the orchestration glue that
feeds them (`ModpackUpgrader.cs:148-183`).

`UpdateEyeMask` (backlog item `2026-07-15-partials-eye-mask.md`) is called from the *same* glue block
but stays **deferred** — this landing wires the shared `unusedTextures`/`contained` filter and calls
only the hair pass; the eye call remains an unported, already-baselined gap.

---

## 1. Why this pass needs game data we don't have at runtime

The feature exists to fix a mod that is **missing its material**. The material is exactly the piece
that says *where* a texture now lives in Dawntrail, so to rescue the loose textures TexTools reads
the **game's own current canonical material** for that `(race, id)` and learns:

1. **The copy destinations** — the material's `g_SamplerNormal`/`g_SamplerMask`/`g_SamplerDiffuse`
   Dx11 texture paths. SE re-pathed hair textures in Dawntrail and the rename is **not** a clean
   formula, so the material is the only ground truth. *This is the irreducible dependency.*
2. **Existence** — whether SE even shipped this `(race, id)` (`FileExists(matPath)`,
   `EndwalkerUpgrade.cs:1430/1615`), so it doesn't fabricate files for a combo that doesn't exist.
3. **Shader gate** — that it is genuinely a `Hair` material (or `Character`/`CharacterLegacy` for
   accessory); otherwise the transform would be wrong and it bails.
4. **Tail only** — the material's render flags (`HideBackfaces`) and shader constants, which the
   upgraded output must match.

The port has **no game install at runtime** (it is a client-side library). ConsoleTools *does*,
which is why its `/upgrade` golden "just knows" the answers. We reproduce them offline by
**pre-extracting the minimum data into a bundled, generated table** — per the porting-fidelity stance
now recorded in `AGENTS.md` ("Bundle the minimum data surface, but enough to port any input
faithfully").

---

## 2. Decomposition

Three coupled pieces land together (untestable in isolation — the logic needs the table, the table
proof needs the coverage):

| Piece | Deliverable |
|---|---|
| **A. Logic** | `src/upgrade/unclaimed-hair.ts` — ports the two C# functions; `partials()` in `src/upgrade/upgrade.ts` wires the `unusedTextures`/`contained` glue and calls it. |
| **B. Constants** | `scripts/extract-hair-materials.ts` → generated `src/upgrade/reference/hair-materials.ts`. |
| **C. Coverage** | a synthetic pack under `scripts/generate-synthetics/` (loose hair normal+mask, no material) driven through the `/upgrade` golden harness. |

Per "split, don't blend": A is its own module citing its own C# symbol; it does **not** merge into
`upgrade.ts` beyond the thin `partials()` call site, and it does not merge into `texture.ts` (it
*calls* the already-ported `updateEndwalkerHairTextures` there, reusing, not duplicating).

---

## 3. The bundled constants (piece B)

### 3.1 Shape — minimum surface, full existence coverage

One generated table, one entry **per canonical DT material that exists**, keyed by material game
path (or `(part, race, id)`). Per entry, only the fields the ported logic reads:

- `shaderPack` — the gate (`Hair`; `Character`/`CharacterLegacy` for accessory).
- `normalDx11Path`, `maskDx11Path`, `diffuseDx11Path` — the copy destinations, whichever samplers
  the material carries (resolved Dx11 path strings; the `--`-insertion derivation runs in the
  extraction script, so the shipped port reads a final string).
- `hideBackfaces: boolean` — the tail rewrite gate.

For the **tail constant-swap rewrite** (§4.4) — the one path that emits a *material*, not just
textures — the entry additionally carries the **canonical tail material's raw bytes**, but *only*
for tail materials that lack `HideBackfaces` (the only ones ever rewritten). `_SampleHair`'s shader
constants (`chara/human/c0801/obj/hair/h0115/.../mt_c0801h0115_hir_a.mtrl`,
`EndwalkerUpgrade.cs:56`) are bundled once.

**Table-as-existence-oracle (the key invariant).** Because the table enumerates *exactly* the DT
materials that exist, a lookup **miss** faithfully means "SE never shipped this → skip" — i.e. it
*is* the `FileExists == false` branch — and a **hit** carries the fields. No throw, no silent
divergence: absence-in-table equals absence-in-game **by construction**. This only holds if
enumeration is complete (§3.3); a partial table would silently mis-skip.

### 3.2 Extraction — enumerate in-process, extract the hits

Two phases in `scripts/extract-hair-materials.ts`, following the `extract-index-overrides.ts` pattern
(committed script → generated `.ts`, regenerable on a machine with the game):

1. **Enumerate (in-process, ~zero cost).** TexTools never blind-probes: existence is a CRC32 hash of
   the path tested against the game's `040000` `.index`/`.index2`, read once and cached
   (`SqPack/FileTypes/HashGenerator.cs:154-205`; `SqPack/DataContainers/IndexFile.cs · GetRawDataOffset · 516-621`;
   the real upgrade uses `rtx.FileExists(matPath, true)`, `EndwalkerUpgrade.cs:1430`). Port
   `HashGenerator` CRC32 + a minimal `040000` index reader into the script and test each grid
   candidate's **specific material-file** hash (matching the upgrade's `FileExists(matPath)`, not the
   UI picker's coarser folder check). Two file reads, no subprocess spawns.
2. **Extract content (authoritative, bounded to the hits).** For each *existing* material, read its
   bytes via the `ConsoleTools /extract` oracle (`test/helpers/oracle.ts · extractGameFile`), parse
   with our `parseMtrl`, and emit the §3.1 fields. Extracting only the hits (not the whole grid)
   keeps this to a bounded, cached, one-time run.

**New dependency:** the game's sqpack `040000` index path (from TexTools config or a CLI arg) — the
same "run on a machine with the game" contract the other `extract-*` scripts already carry. The
script fails loud if the index or a hit's `/extract` is unavailable, and refuses to emit an
incomplete table.

### 3.3 The candidate grid

TexTools' own picker grid (`Items/Categories/Character.cs`): races from `IDRaceDictionary`
(`0101…1804` playable, plus NPC `9104`/`9204`) × ids `1..500` (`_SCAN_LIMIT`), formatted through the
four material templates verbatim from `EndwalkerUpgrade.cs:1293-1321`:

- Hair `mt_c{race}h{id}_hir_a.mtrl`, Tail `mt_c{race}t{id}_a.mtrl`,
  Ear `mt_c{race}z{id}_a.mtrl`, Accessory `mt_c{race}h{id}_acc_b.mtrl`.

The exact grid bounds are documented in the extraction script; correctness of the existence-oracle
invariant (§3.1) rests on the grid being a superset of every combo SE shipped, so the bounds are
chosen generously (id upper bound ≥ any shipped id) and the script asserts it probed the full grid.

---

## 4. The logic port (piece A)

`src/upgrade/unclaimed-hair.ts`, header-cited to `EndwalkerUpgrade.cs:1342-1716`. Two functions
mirroring the C# structure; both operate on one option's `files: Map<string, ModpackFile>`.

### 4.1 Orchestration glue (`partials()`, `ModpackUpgrader.cs:148-183`)

- `allTextures` — the set of all `.tex` file *keys* across every option, collected during pass 1
  (`ModpackUpgrader.cs:108-109`). Add this collection to `upgradeModpack`'s pass 1.
- `unusedTextures` = `allTextures` minus any path that is a *value* of some
  `textureUpgradeTargets[*].files` (`:151-155`) — i.e. textures that are **not** a round-2
  destination.
- Per option, `contained` = `unusedTextures ∩ option.files.keys` (`:171`), passed as the `files`
  arg; the option's whole file map is the `fileInfos` arg. `updateSkinPaths` still runs first
  (`ForAllOptions`, `:158`), unchanged.

### 4.2 Match + group (`UpdateUnclaimedHairTextures`, `:1342-1394`)

- **Hair/tail/ear** scan the **whole option** (`fileInfos.Keys`, `:1347`) for `MaterialRegex`
  matches → set of present `(race, id)` materials; textures are matched only from `contained`
  (`if (!files.Contains(file)) continue;`, `:1360`).
- **Accessory** (`:1527`) scans **only `contained`** for both materials and textures — a real
  asymmetry to reproduce, not smooth over.
- Group matched textures by `(race, id)` → list of `(path, texType)` (`n`→Normal, `s`→Specular;
  accessory also `d`→Diffuse). **Dx11 wins:** if a texType already has an entry whose path contains
  `--`, keep it; otherwise replace (`:1380-1393`). Mirror the C# nested
  `Dictionary<int,Dictionary<int,List>>` with the equivalent keyed structure (per "mirror the C#
  data structure").

### 4.3 Winnow + act (`:1396-1519`)

- **Hair/tail/ear** keep only `(race, id)` with **both** texTypes present *and* no material present
  (`Count < 2` or a present material → drop, `:1403-1409`). Accessory keeps only those with no
  material present (`:1590-1596`).
- For each surviving `(race, id)`: look up the bundled table.
  - **Miss** → skip (the `FileExists`-false branch, §3.1).
  - **Hit** → apply the shader-pack gate (`:1438`/`:1623`) and resolve `norm`/`mask`/`diffuse`
    destinations (`:1444-1451`/`:1629-1637`). A missing required sampler → skip (`:1447`/`:1633`).
- **Already-converted guard** (`:1460-1476`/`:1646-1683`): if any destination path already exists in
  the option, skip the whole `(race, id)`. Reproduce the accessory variant's early-`break` on a
  missing spec/diffuse sampler exactly (`:1656-1668`).
- **Copy** each old texture to its destination (`:1478-1492`/`:1685-1713`): resolve the loose
  texture's bytes and write them at the destination path, in the option's storage form (reuse
  `texture.ts`'s `writeGeneratedTex` storage-mirroring). **Hair/tail/ear then run the pixel
  transform**; **accessory does not** (pure repath copy — no `UpdateEndwalkerHairTextures` call).

### 4.4 Hair pixel transform + tail rewrite (`:1495-1516`)

- After the raw copies land, hair/tail/ear call `updateEndwalkerHairTextures(normDest, maskDest)`
  (`src/upgrade/texture.ts`, already ported) and overwrite the two destinations with the transformed
  result. **Ordering is load-bearing:** the raw copies are written *first* and the transform runs
  *after* inside a try/catch that `continue`s on failure (`:1495-1502`) — so a transform failure
  leaves the **raw copies** in place, added to the option. Our `updateEndwalkerHairTextures` throws
  `TextureResizeUnsupported` for the unported resampler cases; here that is caught like C#'s
  catch-all → **raw copies remain** (a localized, ratchet-baselined content diff, consistent with the
  existing T3 resampler gap — not a hard failure).
- **Tail special-case** (`:1504-1516`): only for `TailRegexes` when the canonical material lacks
  `HideBackfaces`. Port: parse the bundled canonical tail bytes, set the `HideBackfaces` flag, replace
  `shaderConstants` with `_SampleHair`'s, re-serialize with `serializeMtrl` (byte-parity tested), and
  write the result into the option at the canonical material path.

### 4.5 No-transaction adaptation

C# copies via `Dat.CopyFile`/`WriteFile` into a `ModTransaction`/`fileInfos` dict; we mutate
`option.files` directly, exactly as the already-ported `updateSkinPaths`/`upgradeRemainingTextures`
do. `ResolveFile` maps to our `resolveFile` (same absent/undecodable-tolerance seam). This is a
mechanical, parity-neutral adaptation, not a behaviour change.

---

## 5. Coverage (piece C)

No real corpus mod exercises this today, so a **synthetic pack** proves it: an authored modpack
containing a pre-DT hair normal+mask (pow2, matching sizes so the resampler gap is not tripped) for a
real DT `(race, id)`, **without** its material, built by a committed
`scripts/generate-synthetics/build-synthetic-unclaimed-hair.ts` (byte-reproducible via
`pmp-builder.ts`) and run through the `/upgrade` golden harness — AB-testing TexTools on a constructed
input and locking the result. A second synthetic covers the **tail rewrite** path (loose tail
normal+mask for a tail `(race, id)` whose canonical material lacks `HideBackfaces`), so the
constant-swap material write is golden-verified, not just unit-asserted.

Where a path is too deep for a golden to reach (e.g. the Dx11-wins tie-break, the accessory
early-`break`), pin it with a **synthetic unit test** in `test/upgrade/unclaimed-hair.test.ts`,
fixtures hand-derived from the C# and cited.

Coverage confirmation: `npm run test:coverage` should show `unclaimed-hair.ts` reached by the
synthetics/units; any line reachable by neither must be a fail-loud guard.

---

## 6. Fidelity notes / known gaps

- **Eye mask stays deferred** (backlog `2026-07-15-partials-eye-mask.md`): the glue computes
  `contained` and calls the hair pass only; the eye call is not added, preserving the existing
  baselined gap rather than half-porting it.
- **Resampler gap** (backlog `2026-07-10-imagesharp-resampler.md`): NPOT / size-mismatch hair inputs
  degrade to the raw-copy diff described in §4.4 (baselined), matching how `texture.ts` already
  handles the resampler gap.
- **Extraction completeness** is the load-bearing assumption behind the existence-oracle invariant
  (§3.1/§3.3); the script fails loud on any unavailable probe/extract rather than emitting a partial
  table that would silently mis-skip.

---

## 7. Work order

1. **B first** — extraction script + generated table (needs a game machine; unblocks A's real data).
2. **A** — `unclaimed-hair.ts` + `partials()` glue, over the table.
3. **C** — synthetic packs + unit tests; bless baselines; `npm run test:coverage` sweep.
4. End-of-task gate: `npm run check`, `npm run typecheck`, `npm test` all green.
5. Close the backlog item; open the PR (delete this plan's checklist first, per `AGENTS.md`).
