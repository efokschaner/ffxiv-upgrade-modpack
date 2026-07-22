# NPOT normalize for `createIndexFromNormal` / `upgradeMaskTex` — Design & handoff

**Date:** 2026-07-21
**Status:** Design approved, not yet implemented.
**Goal:** stop silently dropping a generated `_id.tex` (and silently skipping a gear-mask upgrade)
when the source texture is non-power-of-two, by porting the Bicubic NPOT pre-step both call sites
already have in the C#.

**Closes:** [`docs/backlog/2026-07-21-monster-index-tex-generation-gap.md`](../../backlog/2026-07-21-monster-index-tex-generation-gap.md)
(prioritized #1). **Narrows:** [`docs/backlog/2026-07-10-imagesharp-resampler.md`](../../backlog/2026-07-10-imagesharp-resampler.md)
(prioritized #4) down to T2's load-time `ValidateTexFileData` resize.

**Builds on:** the texture round design
([`2026-07-09-texture-round-design.md`](2026-07-09-texture-round-design.md)) and the eye-mask pixel
pipeline design ([`2026-07-16-eye-mask-pixel-pipeline-design.md`](2026-07-16-eye-mask-pixel-pipeline-design.md)),
whose §7 already scoped this work as "replace **the two** `TextureResizeUnsupported` throws with
`resizeBicubic` calls". That change shipped only the hair half; this design finishes it.

---

## 1. The problem

`Club Cyberia Motorbike.ttmp2` (mount, monster root `m0242`) upgrades with no error, but its output
is missing `chara/monster/m0242/obj/body/b0001/texture/v01_m0242b0001_n_c_id.tex` in **all 12
options** — an `added` (golden-only) entry in `test/corpus/.upgrade-baseline`, plus its 12
`ModsJsons/19` manifest entries. Rubric class 1: silent wrong output.

**Root cause (traced, not inferred).** The backlog item's hypothesis — "a monster-specific branch in
the material round never enqueues the index-map generation" — is **wrong**. The target *is* enqueued
correctly. `upgradeMaterial` returns, for the `_c` colour-variant material:

```
IndexMaps { normal: …/v01_m0242b0001_n_c.tex, index: …/v01_m0242b0001_n_c_id.tex }
```

and the pack's two *power-of-two* normals (`_n.tex` 1024×512, `_n_b.tex` 256×256) already generate
`_id.tex` files that byte-match the golden — neither appears in the baseline.

The `_c` normal is **400×400 — non-power-of-two** (DXT5). `createIndexFromNormal`
(`src/upgrade/texture.ts:58-64`) throws `TextureResizeUnsupported` on NPOT, and
`upgradeRemainingTextures`' dispatch catch (`:279`) swallows it. The file is simply never generated.

This is not a new failure class: it is the `createIndexFromNormal` half of prioritized item 4.

**A load-bearing claim in item 4 is falsified.** That item states "**No NPOT source exists anywhere
in the ~940-pack scan**", which is why this branch was ranked as latent. The 400×400 `_n_c.tex`
disproves it. Correct the item when updating it.

## 2. Scope: both call sites, not just the index one

`upgradeMaskTex` (`src/upgrade/texture.ts:75-88`, porting `EndwalkerUpgrade.cs:2082-2098`) has the
identical NPOT throw at `:2086-2089`. It is in scope, for three reasons:

1. **Same failure class.** A skipped `upgradeMaskTex` leaves an un-upgraded Endwalker mask sitting
   under a Dawntrail material — silent wrong output, same rubric class 1. Declining to fix it does
   not buy byte-parity; the skip diverges from the golden *and* breaks the mod.
2. **The eye-mask spec already scoped both** (§7, cited above), and item 4 treats the two as one unit
   of remaining work.
3. **An initial scoping argument against it did not survive the data** — see §3.3.

Out of scope: T2's `ValidateTexFileData` NPOT resize (`EndwalkerUpgrade.cs:2100-2113`), a *load-time*
call site tracked by [`2026-07-10-fixoldtexdata-load-round.md`](../../backlog/2026-07-10-fixoldtexdata-load-round.md).

## 3. What TexTools actually does, and what we reproduce

### 3.1 The C# chain

Both sites call the same thing when NPOT (`EndwalkerUpgrade.cs:1096-1099` and `:2086-2089`):

```csharp
await Tex.ResizeXivTx(tex, IOUtil.RoundToPowerOfTwo(tex.Width), IOUtil.RoundToPowerOfTwo(tex.Height));
```

`Tex.ResizeXivTx` (`Tex.cs:413-420`) is three steps:

1. `TextureHelpers.ResizeImage` (`TextureHelpers.cs:365-401`) — ImageSharp **Bicubic**
   (`nearestNeighbor` defaults to `false`), `PremultiplyAlpha = false`, `ResizeMode.Stretch`, with an
   early return when the target dims already equal the source (`:368`).
2. `tex.Width`/`tex.Height` are overwritten with the **new** dims.
3. `Tex.MergePixelData` (`Tex.cs:637-706`) — re-encodes the resized RGBA back into the tex's
   **original compression format** via TexImpNet/nvtt.

The caller then immediately calls `GetRawPixels()` again, decoding whatever step 3 produced.

`RoundToPowerOfTwo` (`IOUtil.cs:905-930`) picks whichever of floor/ceil pow2 is numerically closer,
**ties going to the floor**. Already ported as `roundToPowerOfTwo` (`src/upgrade/texture.ts:49-53`).

### 3.2 We elide step 3's compress/decompress round-trip

We have no nvtt-compatible BC encoder, so we go decode → resize → use the RGBA directly. This is the
same elision `updateEndwalkerHairTextures` (`src/upgrade/texture.ts:98-138`) already ships.

**Evidence it is safe on the index path (a real golden).** Measured our
decode→`resizeBicubic`→`createIndexTexture`→`encodeUncompressedTex` output against the cached
ConsoleTools `/upgrade` golden for all 12 options of `Club Cyberia Motorbike.ttmp2`:

```
opt0..opt11  src=400x400->512x512  ours=1398176  golden=1398176  diffBytes=0  maxDelta=0
```

**Byte-identical, 12/12**, despite the golden having gone through a lossy DXT5 → BC3 → DXT5
round-trip we skipped. `CreateIndexTexture` (`TextureHelpers.cs:222-260`) reads only the normal's
**alpha** and quantizes it into rows of 17, which absorbs the round-trip error entirely.

### 3.3 What we do *not* have evidence for, stated plainly

The mask path ships with **no oracle**. An initial scoping argument held that the hair path already
proved the elision safe on a mask. **It does not.** `Misty_Hairstyle_Female` and `Eliza` are
essentially all `A8R8G8B8` (fmt 5200) — which `GetCompressionFormat` maps to `CompressionFormat.BGRA`,
making `MergePixelData` **lossless** — and Misty has no NPOT texture at all:

| pack | tex formats | NPOT? | residual vs golden |
|---|---|---|---|
| `Misty_Hairstyle_Female` | 8× `A8R8G8B8`, 1× DXT1, 1× DXT5 (the BC pair is 2048² and unresized) | none | 0 `.tex` baseline entries |
| `Eliza` | `A8R8G8B8` | none (512²→1024² common-size upscale only) | 2 bytes in 4 MB, max delta 2 — the documented float64-vs-float32 resampler tolerance |

So **nothing in the corpus has ever exercised a lossy `MergePixelData` round-trip**, on any path. The
one place we have proven the elision exact is the index path, where quantization does the absorbing —
and `upgradeGearMask` (`TextureHelpers.cs`) has no comparable quantization, so error there would pass
through into output bytes.

This is why §5.1 adds a synthetic pack whose whole job is to turn that unknown into a golden. Until
it is built and blessed, the mask half of this change is **unverified against TexTools**, and the code
comment at the site must say so. Do not let the index side's 12/12 result read as covering both.

### 3.4 Two hard failures the elided step 3 still owns

Eliding the round-trip must not silently swallow the cases where it makes TexTools **fail**. Both are
reproduced as plain `Error`s that propagate and fail the pack:

- **Unsupported format.** `GetCompressionFormat` (`Tex.cs:718-747`) accepts only
  `{DXT1, DXT5, BC4, BC5, BC7, A8R8G8B8}` and throws `InvalidDataException` on anything else. This is
  genuinely reachable, not theoretical: our `decodeToRgba` (`src/tex/decode.ts:58-108`) additionally
  accepts **DXT3, A4R4G4B4, A1R5G5B5, L8, A8, A16B16G16R16F**, so we would decode and resize happily
  where TexTools aborts.
- **Too small.** `Tex.cs:656-660` throws `InvalidDataException("Image is too small for DDS
  Compressor. (64x64 Minimum Size)")` when `tex.Width < 64 || tex.Height < 64`. Note these are the
  **post-resize (rounded)** dims — `ResizeXivTx` overwrites them at step 2 before calling
  `MergePixelData`. Applies to the non-BC7 branch only; BC7 takes the `DDS.TexConvRawPixels` path
  (`:650-653`), which has no size guard.

Both guards fire **only when a resize actually happened** — `MergePixelData` is reached only from
inside `ResizeXivTx`, so a texture that was already power-of-two never touches either.

### 3.5 Why a plain `Error` (pack abort) is the faithful outcome

The reachable call site is `EndwalkerUpgrade.cs:1842` (inside `UpgradeRemainingTextures`), which has
**no** try/catch around `CreateIndexFromNormal`. The exception propagates to
`ModpackUpgrader.cs:133-141`, which rethrows it wrapped — aborting the whole upgrade.

There *is* a swallow-and-`Trace` catch around a `CreateIndexFromNormal` call at
`EndwalkerUpgrade.cs:637-645` — but it sits behind `if (files == null)` (`:627`), and the modpack
upgrade path always passes a non-null file dictionary. It is unreachable here; do not port it.

## 4. The change

`src/upgrade/texture.ts` only.

1. **`createIndexFromNormal`** — replace the NPOT throw with: compute
   `roundToPowerOfTwo(width/height)`; if different from source, run the §3.4 guards, then
   `resizeBicubic` and carry the new dims through `createIndexTexture` + `encodeUncompressedTex`.
2. **`upgradeMaskTex`** — the identical shape, feeding `upgradeGearMask`.
3. **Factor the shared pre-step.** Both sites run the same guard-then-resize; extract one helper
   (e.g. `resizeToPow2ForMerge(rgba, width, height, format)` returning `{rgba, width, height}`) citing
   `Tex.ResizeXivTx` · `Tex.cs:413-420` + `MergePixelData` · `Tex.cs:637-706`. This is a *split*, not
   a blend: one TS helper for one C# symbol pair on one call path.
4. **`TextureResizeUnsupported` and its catch die.** With both throw sites gone the sentinel is
   unreachable, so delete the class **and** the `try`/`catch` in `upgradeRemainingTextures`
   (`:213`, `:278-281`). Removing it is a *fidelity gain*: `EndwalkerUpgrade.cs:1842` has no catch
   either, so the ported control flow ends up structurally identical.
5. **Update the references that name it** — `src/upgrade/unclaimed-hair.ts:201`'s comment and
   `docs/TEXTOOLS_BUGS.md:334`, both of which cite `TextureResizeUnsupported` as a live modeled gap.

## 5. Tests

### 5.1 Synthetic corpus additions

Three new builders under `scripts/generate-synthetics/`, wired into `build-all.ts`, following the
material+texture-bearing precedents (`build-synthetic-eye-mask.ts`, `build-synthetic-index-fallback.ts`,
`build-synthetic-unclaimed-hair.ts`) and reusing `synthetic-mtrl.ts`.

1. **`npot-mask.ttmp2` — essential.** A colorset material with a **power-of-two normal** and an
   **NPOT, BC-compressed mask** (e.g. 400×400 DXT5). Isolates the mask variable, and the BC format is
   the point: it exercises the lossy `MergePixelData` round-trip that §3.3 shows *nothing* in the
   corpus has ever tested. This pack is what converts the mask half from unverified to golden-backed.

   `.ttmp2` rather than `.pmp` deliberately: `Club Cyberia` empirically proves the TTMP load path
   carries NPOT intact into the texture round, whereas whether PMP's unported `FastValidateTexFile`
   ([`2026-07-13-pmp-load-time-tex-fixup.md`](../../backlog/2026-07-13-pmp-load-time-tex-fixup.md))
   would normalize it away first is an open question. Do not put that unknown under the one pack that
   has to be trustworthy.

2. **`npot-tiny-mask` → `test/corpus/upgrade-error/`** — a mask whose *rounded* dimension lands under
   64 (e.g. 40×40 → 32×32, since `RoundToPowerOfTwo(40)` picks floor 32), pinning `Tex.cs:656-660`.

3. **`npot-dxt3-mask` → `test/corpus/upgrade-error/`** — an NPOT DXT3 mask, pinning
   `GetCompressionFormat`'s `default:` throw.

Separate packs for 2 and 3 because either aborts the whole upgrade; one pack cannot demonstrate both.

**Why 2 and 3 earn their keep.** Those guards are behaviour this change *adds*, inferred from reading
the C#. If the trace is wrong anywhere — a catch not found, texconv quietly coping — we would be
introducing pack failures where TexTools succeeds, which is strictly worse than today. An
expected-failure golden settles it empirically. **If the expected-failure harness fights these two,
downgrade them to hand-derived unit tests and say so in the PR — do not sink time.**

No synthetic for the NPOT *index* path: `Club Cyberia Motorbike` already gives it a real golden at
12/12 byte-identical.

### 5.2 Unit tests (`test/upgrade/texture.test.ts`)

- NPOT normal / NPOT mask resize to nearest pow2 and match a hand-computed
  `resizeBicubic` + `createIndexTexture` / `upgradeGearMask` reference (mirroring the existing
  `updateEndwalkerHairTextures` NPOT test at `:134`).
- Each guard, at each site: rounded dim < 64 throws; unsupported format (DXT3) throws; BC7 is
  **exempt** from the <64 guard.
- Already-pow2 inputs stay byte-identical (no resize, no guard).
- **Two existing tests must be rewritten**, not deleted: `"throws TextureResizeUnsupported for a
  non-power-of-two normal"` (`:55`) and `"throws TextureResizeUnsupported for a NPOT mask"` (`:76`),
  plus `"skips (no throw) a target whose normal is NPOT"` (`:251`). Their 3×2 / 6×4 fixtures now round
  *below 64*, so they land on the new size guard — assert that explicitly rather than letting them
  pass for the wrong reason.

### 5.3 Golden expectations

- `Club Cyberia Motorbike.ttmp2`: the 12 `payload/added` `_n_c_id.tex` entries → **zero**.
- **Expected residual, stated up front:** the 12 `manifest/added` `ModsJsons/19` entries will *not*
  vanish. A 20th file per option shifts our `ModsJsons` ordering against the golden's, so they convert
  into `FullPath`/`Name` mismatches of the already-known **prioritized item 10** class (option file
  order + `Name`/`Category` re-derivation, which `writeGeneratedTex` does not carry). The class-1
  silent-loss gap closes; that cosmetic class absorbs the remainder.
- A re-bless is required. Report exact before/after entry counts for every pack whose baseline moves.
- Watch for collateral: any *other* pack whose baseline changes means an NPOT source we did not know
  about. Investigate rather than bless.

## 6. Risks

- **The mask elision may not be byte-exact.** §5.1's pack 1 is what tells us. If it diverges, the
  decision is a `DIVERGENCE_RULES` entry with a measured tolerance (as the `.tex` ±1 rule does) versus
  a baselined mismatch — decide from the measured histogram shape, and do not widen the global `.tex`
  tolerance to absorb it.
- **The `<64` and unsupported-format guards may not match TexTools.** Mitigated by §5.1 packs 2–3.
- **Blast radius is narrow:** one source file, plus test/scaffolding. No writer, container, or
  manifest code changes.

## 7. Backlog outcome

- `2026-07-21-monster-index-tex-generation-gap.md` — **delete** (shipped); remove its index entry.
  Grep for references first, per `docs/BACKLOG.md`'s own rule.
- `2026-07-10-imagesharp-resampler.md` — narrow to T2's `ValidateTexFileData` resize only, and
  **correct the falsified claim** that no NPOT source exists in the corpus scan (§1).
- `docs/BACKLOG.md` — re-rank: item 1 closes, item 4 shrinks. Note that
  `TextureResizeUnsupported` no longer exists, which affects item 6's description (the diagnostics
  channel) — it cites the sentinel as one of the two things `unclaimed-hair.ts:197` swallows.
