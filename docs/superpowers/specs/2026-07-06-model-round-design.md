# Model Round (v5→v6) — Design

**Date:** 2026-07-06
**Status:** Design approved (brainstorming); ready for implementation plan.
**Parent:** `2026-06-30-dawntrail-modpack-upgrader-design.md` (§8, round 3).
**Depends on:** the shipped `.mdl` codec (`src/mdl/*` — `parseMdl`/`serializeMdl`
byte-exact round-trip, `MdlModelData` struct), the sqpack codec
(`SqPackType.Model` encode/decode), the golden harness + baseline ratchet, and
the orchestration seam shipped with the material round (`src/upgrade/upgrade.ts`).

---

## 1. Where this sits

Sub-project #3 of the upgrade port (foundation §8). It fills the `modelRound`
no-op stub with the **model** half of round 1 — the port of C#
`EndwalkerUpgrade.FastMdlv6Upgrade` (`EndwalkerUpgrade.cs:282–476`), the
byte-level v5→v6 MDL patch that the modpack `/upgrade` path actually runs
(`UpdateEndwalkerModel`, `:250`). Scope is `chara/**.mdl` only, per option,
byte-exact against the ConsoleTools golden. Success = the corpus `.mdl` baseline
(453 diffs today) collapses to zero, every upgraded `.mdl` byte-matching the
golden (models carry **no** intended divergence — they are not on the allow-list).

Texture generation (round 2/4), metadata (round 5), and partials (round 6)
remain no-op passes after this round.

## 2. Key fact: the modpack path uses the *fast byte-patch*, not a re-import

C# has two model upgraders:

- `FixOldModel` (`:190`) — full `TTModel.FromRaw` → `MakeUncompressedMdlFile`
  re-import. Used on other routes, **not** the modpack path.
- `FastMdlv6Upgrade` (`:282`) — an **in-place byte patch** over the uncompressed
  MDL via `BinaryReader`/`BinaryWriter` at fixed offsets. This is what
  `UpdateEndwalkerModel` calls on the modpack path (`files != null`).

So the golden is produced by the fast byte-patch. To byte-match it we mirror the
**byte-patch semantics**, not a codec re-serialize-from-model. Crucially, our
`.mdl` codec parses the file into structured sections and `serializeMdl` replays
it **byte-for-byte**, so we can express the patch as edits to the parsed model
(clearer, testable) and still land identical bytes — *provided* the codec
round-trips v5 input exactly (§5, the precondition gate).

Every mutation `FastMdlv6Upgrade` makes is **size-preserving** (that is why C#
patches in place): no section grows or shrinks, so no offsets downstream of an
edit move. This is what makes the structured port safe.

## 3. The transform (`src/upgrade/model.ts`, new)

`upgradeModel(mdl: XivMdl): boolean` — mutates `mdl` in place to v6, returning
whether any change was made (mirroring `FastMdlv6Upgrade`'s `anyChanges`). The
caller re-serializes only when it returns `true`.

**Guards → no change** (return `false`, leave file byte-untouched):
- `header.version !== 5` (already v6, or not a versioned model).
- `header.meshCount === 0`.
- `modelData.boneSetCount === 0 || modelData.boneCount === 0` — C# refuses
  boneless meshes ("Not 100% sure how to update boneless meshes to v6 yet, so
  don't upgrade for safety", `:325`).

**Mutations** (all size-preserving):

1. **Header** (`header.bytes`, the serialize source of truth — `mdl/types.ts:13`):
   version `5→6` (u16 @0); `lodCount → 1` (u8 @64).
2. **modelData:** `lodCount → 1`; `boneSetSize → 64 × boneSetCount`. Re-serialized
   by `serializeMdlModelData` (fixed 56-byte struct; physical size unchanged).
3. **`sections.boneSets` v5→v6 reformat** (total length `132 × boneSetCount`,
   unchanged — C# zero-fills the tail to preserve span, `:424–430`):
   - Read each v5 entry: 128 bytes bone data (64 × u16) + a u32 count.
   - Write v6 in the same buffer: first a header block of
     `[u16 offset placeholder, u16 boneCount]` per set; then, per set,
     `boneCount × 2` bytes of bone data, plus a 2-byte pad when `boneCount` is
     odd, backfilling each set's offset field = `(dataPos − headerPos) / 4`.
   - Zero-fill the remainder of the section.
   - Note: `boneCount` here is the **per-set** count read from the v5 entry, not
     `modelData.boneCount`.
4. **`sections.boundingBoxes`:** keep the 4 leading standard boxes (128 bytes:
   base / model / water / shadow); overwrite the following `modelData.boneCount`
   per-bone boxes with a uniform radius-derived box —
   `min = (−r/20, −r/20, −r/20, 1)`, `max = (+r/20, +r/20, +r/20, 1)`,
   `r = modelData.radius`, `_Divisor = 20` (`:459–466`). Each box is 32 bytes
   (2 × `float32×4`).

The transform touches only `header`, `modelData`, `sections.boneSets`, and
`sections.boundingBoxes`; all other sections and `geometry` pass through
untouched.

## 4. Orchestration wiring (`src/upgrade/upgrade.ts`)

- **`modelRound(option)` becomes real:** map each `chara/**.mdl` file through
  `parseMdl → upgradeModel → serializeMdl`, same per-option shape as
  `materialRound`, but it records **no** `UpgradeInfo`. Wrap per-file in the same
  try/catch-skip discipline (an unparseable/odd model is left byte-untouched,
  mirroring C#'s per-file resilience). C# runs materials **before** models within
  a `UpdateEndwalkerFiles` pass (`:168` then `:172`); we keep that order.
- **Fix `restore()` to honour the source SqPack type.** Today it hardcodes
  `SqPackType.Standard`, and its own docstring flags that a `.mdl` round must pass
  the source's real type. `.mdl` ttmp entries are `SqPackType.Model` (type 3).
  Thread the decoded entry's type out of `uncompressedBytes` and into `restore`
  so each file re-encodes with its own type (Model for `.mdl`, Standard for
  `.mtrl`), removing the hardcoded constant. `decodeSqPackFile` already returns
  the type; a `.mdl`→`Model` path helper exists in `sqpack.ts` as a fallback for
  the pmp raw path.

## 5. Testing & workflow

1. **Precondition gate — v5 round-trip parity (do this first).** The corpus
   `.mdl` inputs are **v5**; the codec was primarily validated on v6 game models.
   Assert `parseMdl → serializeMdl` is **byte-identical** on every corpus v5
   `.mdl` before writing the transform. This isolates codec bugs from transform
   bugs and confirms the parser delimits the v5 `boneSets` section
   (`132 × count`) correctly. A failure here is a **codec fix**, not a transform
   task.
2. **Unit tests (TDD the pure pieces):** the boneset v5→v6 reformat and the
   radius-box fill against known vectors; the three guards (v6 input → unchanged;
   `meshCount === 0` → unchanged; boneless → unchanged).
3. **Corpus ratchet (primary gate):** run `npm test`; the `.mdl` diffs burn down.
   Re-bless the baseline
   (`$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE`)
   to record the smaller remainder (`.tex` 701, `.meta` 49). Any **new**
   divergence (a regressed `.mdl`, or an unexpected diff) fails.
4. **Coverage (corpus iteration):** after the round lands,
   `npm run test:coverage` over `model.ts`; flag any under-exercised branch
   (e.g. odd per-set bone counts, the boneless guard) and note real mods to add
   if a branch is unhit by the corpus.

## 6. Expected result & divergences

All 453 `.mdl` baseline diffs are expected to be **v5 models needing the
upgrade**; a v6 `.mdl` is a no-op on **both** sides and already byte-matches
(so it should not appear in the baseline). If any residual v6 `.mdl` still
differs after this round, that is a **separate investigation** (not expected here)
— models carry no intended divergence, so nothing about this round is added to
the allow-list. The round is done when the `.mdl` baseline is zero.

## 7. Out of scope

- Round 2/4 texture generation, round 5 metadata, round 6 partials, round 7 UI
  (foundation §8).
- The `FixOldModel` full re-import path (unused on the modpack route).
- Any `.mdl` change beyond the v5→v6 fast patch (e.g. bone/material repaths) —
  `/upgrade` does not perform them on this route.

## 8. File plan

- `src/upgrade/model.ts` (new) — `upgradeModel(mdl): boolean` + helpers
  (boneset reformat, radius-box fill).
- `src/upgrade/upgrade.ts` (modify) — real `modelRound`; `restore()` +
  `uncompressedBytes()` thread the source SqPack type.
- `test/upgrade/model.test.ts` (new) — unit tests (§5.2).
- `test/mdl/*` (modify, only if §5.1 surfaces a v5 round-trip gap) — codec fix.
