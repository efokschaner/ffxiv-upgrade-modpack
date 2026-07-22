# NPOT normalize for `createIndexFromNormal` / `upgradeMaskTex` — Design & handoff

**Date:** 2026-07-21
**Status:** **Implemented 2026-07-22.** The index half landed exactly as designed — `Club Cyberia
Motorbike.ttmp2` now has **zero `added` entries in its entire baseline**, so every file the golden
carries, we produce. Four findings changed the design during implementation:

1. **§5.1's mask pack became three packs, and the extra one changed a decision.** The original
   `-a8`/`-dxt5` pair measured the elision as exact for a lossless source and **95.65% of bytes
   divergent (max delta 116)** for DXT5. An operator question — could a ±1/±2 tolerance confirm it
   instead of a baseline? — prompted a third pack, `npot-mask-dxt5-smooth`, with realistic smooth
   content: **max delta 9**. So content, not format, sets the magnitude. See §3.3.
2. **The mask divergence is shipped and ratcheted, not rule-confirmed** (operator call, 2026-07-22).
   §6 offered "a `DIVERGENCE_RULES` entry with a measured tolerance versus a baselined mismatch";
   the measurement supports neither cleanly, and a fixture-calibrated threshold would be actively
   harmful. See §6 for the reasoning and
   [`2026-07-22-bc-encoder-merge-pixel-data.md`](../../backlog/2026-07-22-bc-encoder-merge-pixel-data.md).
3. **Both §3.4 guards were confirmed against the real oracle** by the §5.1 expected-failure packs —
   and meeting the harness's matched-*reason* bar forced their messages to become TexTools' text
   verbatim, which is a fidelity gain the design did not anticipate. See §3.4.
4. **§1's root cause corrected the backlog item's hypothesis**, which blamed a monster-specific
   material-round branch. The target was enqueued correctly all along.

**Goal:** stop silently dropping a generated `_id.tex` (and silently skipping a gear-mask upgrade)
when the source texture is non-power-of-two, by porting the Bicubic NPOT pre-step both call sites
already have in the C#.

**Closed:** `docs/backlog/2026-07-21-monster-index-tex-generation-gap.md` (then prioritized #1) —
deleted 2026-07-22 per `docs/BACKLOG.md`'s shipped-item convention, so this spec is now its durable
record; the name is left unlinked deliberately, the file is gone.
**Narrowed:** [`docs/backlog/2026-07-10-imagesharp-resampler.md`](../../backlog/2026-07-10-imagesharp-resampler.md)
(then #4, now #3) down to T2's load-time `ValidateTexFileData` resize.
**Filed:** [`docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md`](../../backlog/2026-07-22-bc-encoder-merge-pixel-data.md)
— the accepted mask-path divergence (§3.3, §6).

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

#### Outcome (2026-07-22): measured, and the answer was not binary

The packs were built and blessed. Three of them, in the end — the pair became a triple when an
operator question forced the realistic case to be measured separately from the adversarial one:

| pack | mask | vs golden | max delta |
|---|---|---|---|
| `npot-mask-a8` | 400×400 `A8R8G8B8` (→ lossless `BGRA`) | 0 / 1398176 — **byte-identical** | 0 |
| `npot-mask-dxt5-smooth` | 400×400 DXT5, smooth gradient | 680836 / 1398176 (48.7%) | **9** |
| `npot-mask-dxt5` | 400×400 DXT5, pseudo-random | 1337354 / 1398176 (95.65%) | **116** |

The generated `_id.tex` is byte-identical in **all three**, independently re-confirming §3.2.

Two things fall out, and both mattered more than the headline number:

1. **The resampler is exonerated.** `-a8` runs the identical Bicubic resize and is exact, so every
   byte of divergence in the DXT5 packs is the elided round-trip, not our resampler port.
2. **Content, not format, sets the magnitude.** The error tracks how well the *resampled* image fits
   BC's per-block endpoint model. 9 for smooth content (what a real gear mask looks like), 116 for
   noise (where every post-resample 4×4 block has huge internal variance). Real masks sit near the
   smooth end — but we cannot bound it, because computing the error for a given input *is* the
   nvtt-compatible encode we lack.

The pack set is only worth this much because each comparison moves exactly one variable: `-a8` vs
`-dxt5` isolates the round-trip, `-dxt5` vs `-dxt5-smooth` isolates content. Preserve that property.

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

**One sub-behaviour here has no oracle, unlike the two guards themselves.** The `<64` guard's
**BC7 exemption** rests on reading `Tex.cs:650-653` plus a hand-derived unit test; no pack proves it.
It is a guard *suppression*, so if it is wrong the failure mode is the branch's own bad class: we
succeed where TexTools aborts. Closing it costs one more pack — a 40×40 BC7 mask in the ordinary
`synthetic` root, expected to upgrade rather than error — with one caveat that argues for doing it
deliberately rather than casually: BC7 takes `DDS.TexConvRawPixels`, which shells out to `texconv.exe`,
so a failure there could be environmental rather than a real refusal, and the result would need
reading with that in mind. Recorded rather than silently assumed.

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

Four new packs from two new builders under `scripts/generate-synthetics/`, wired into `build-all.ts`, following the
material+texture-bearing precedents (`build-synthetic-eye-mask.ts`, `build-synthetic-index-fallback.ts`,
`build-synthetic-unclaimed-hair.ts`) and reusing `synthetic-mtrl.ts`.

1. **`npot-mask-a8.ttmp2` + `npot-mask-dxt5.ttmp2` — essential.** A colorset material with a
   **power-of-two normal** (64×64 `A8R8G8B8`, so it never touches the resize path) and an **NPOT
   mask** at 400×400. This is what converts the mask half from unverified to golden-backed.

   Built as a **pair, differing only in the mask's format**, so that a divergence is attributable
   rather than merely observed:
   - **`-a8`** — `A8R8G8B8` mask. `GetCompressionFormat` maps this to `CompressionFormat.BGRA`, so
     TexTools' `MergePixelData` is **lossless**. Isolates the Bicubic resize alone; should be exact
     or within the documented resampler tolerance.
   - **`-dxt5`** — DXT5 mask. Adds the lossy BC round-trip that §3.3 shows *nothing* in the corpus
     has ever tested, plus our BCn decoder's known ±1 divergence
     ([`2026-07-16-bcn-decoder-rounding-divergence.md`](../../backlog/2026-07-16-bcn-decoder-rounding-divergence.md)).

   If `-a8` is clean and `-dxt5` is not, the round-trip is the cause; if both diverge equally, the
   resampler is. One combined pack could not tell those apart.

   **A third pack, `-dxt5-smooth`, was added during implementation** (2026-07-22) after the
   `-dxt5` result came back at 95.65% / max delta 116 and the operator asked whether a ±1/±2
   tolerance could confirm it instead. `-dxt5` uses pseudo-random bytes — the pathological case for
   BC — so it measures the ceiling, not the realistic case. `-dxt5-smooth` carries hand-assembled
   DXT5 blocks encoding a smooth gradient (endpoints varying per block, indices interpolating) and
   measures **max delta 9**. Keep all three: `-dxt5` vs `-dxt5-smooth` is what isolates *content*
   as the variable that sets the magnitude, which is what makes the divergence explainable rather
   than merely large. See §3.3's outcome table and §6.

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

## 6. Risks, and how each resolved

- **The mask elision may not be byte-exact.** *Resolved: it is not, for BC-compressed sources.* This
  section originally framed the choice as "a `DIVERGENCE_RULES` entry with a measured tolerance versus
  a baselined mismatch". The measurement (§3.3) supports **neither** cleanly, and the operator
  adjudicated (2026-07-22) to **ship the elision and ratchet the divergence**, documented at the site
  and in [`2026-07-22-bc-encoder-merge-pixel-data.md`](../../backlog/2026-07-22-bc-encoder-merge-pixel-data.md).

  A tolerance rule was considered explicitly and rejected on the numbers. ±1/±2 does not survive
  contact with either DXT5 fixture — even smooth content reaches 9. And a larger threshold is wrong
  for a reason worth stating precisely, **because an earlier draft of this section got it wrong**: it
  is *not* that `DIVERGENCE_RULES` predicates are corpus-wide and would absolve real packs.
  `DivergenceRule.predicate` is `(gamePath: string) => boolean`, and all three fixtures sit at the
  fictional `chara/equipment/e9999/…`, so a path-scoped rule would match these packs and nothing else.
  The real objection is that **all three fixtures deliberately share one mask gamePath**, so a
  path-scoped predicate cannot separate the smooth case from the adversarial one; the only bound
  expressible over them is ≤116, roughly 45% of an 8-bit channel's range, which would confirm
  essentially any output. A *shape* rule fares no better: confirming "these bytes differ exactly as a
  BC round-trip would explain" requires performing the BC round-trip.

  Stated honestly, then, "no rule is constructible" is really **"no rule is constructible without a
  change we chose not to make"** — giving the three packs distinct mask gamePaths would make a
  smooth-content `confirm` expressible. That is deferred rather than impossible, and the reason to
  defer is §3.3's own caveat: the smooth fixture is near-flat *within* each 4×4 block, so its 9 is a
  **floor** rather than a realistic figure, and a rule calibrated to it would be tighter than real
  content warrants. See the backlog item.

  **Which AGENTS.md rule actually governs.** Not the three-part user-benefit bar (registered defect +
  corpus accounting + in-game verification) — that is for cases where we deliberately depart because
  TexTools is *wrong*. Here TexTools is right and we simply lack an nvtt-compatible encoder. The rule
  that binds is **"fail loud, never silently diverge"**, which read strictly says a BC-sourced NPOT
  mask should *throw*. We ship lossy output instead, so this is a **knowing departure from a stated
  principle**, not merely the absence of a registry entry — and it is recorded as such so it stays
  auditable. The justification is user impact: throwing aborts the entire pack, which for content
  anywhere near the smooth end trades a working mod for a ≤9/255 difference in one mask.

  This is the one divergence in the repo carried by a ratchet rather than a confirmation rule, and it
  is deliberate. Per AGENTS.md a baseline alone is *not* documentation — hence the site comment on
  `resizeToPow2ForMerge`, the `DIVERGENCE_RULES` header pointer, and the backlog item, which are.

- **The `<64` and unsupported-format guards may not match TexTools.** *Resolved: both match.* The
  §5.1 expected-failure packs confirm it against the real oracle, and at a stronger bar than
  anticipated: `assertMatchedUpgradeFailure` (`test/helpers/corpus-upgrade.ts:44-58`) requires our
  thrown message to be a literal substring of ConsoleTools' captured trace, so this pins a matched
  *reason*, not just "both threw". Meeting it required rewriting both guard messages to TexTools'
  text verbatim (`Tex.cs:659`, `Tex.cs:743`) — a fidelity gain, at the cost of the messages no longer
  naming which texture failed. That cost is itself TexTools-faithful (no upstream catch re-adds a
  gamePath) and is the province of prioritized item 6, the diagnostics channel.

- **Blast radius is narrow:** two source files (`src/upgrade/texture.ts`, plus `texFormatName` in
  `src/tex/types.ts`), the rest test/scaffolding. No writer, container, or manifest code changes.

## 7. Backlog outcome

All done 2026-07-22:

- `2026-07-21-monster-index-tex-generation-gap.md` — **deleted** (shipped), index entry removed, and
  the two references that cited it updated in the same change per `docs/BACKLOG.md`'s own rule.
- `2026-07-10-imagesharp-resampler.md` — narrowed to T2's `ValidateTexFileData` resize only, demoted
  #4 → #3, and its **falsified claim** ("no NPOT source exists anywhere in the ~940-pack scan")
  corrected in place, with a note on why the over-read matters more than the branch it mis-ranked.
- `2026-07-22-bc-encoder-merge-pixel-data.md` — **new**, filed under *Unprioritized → Textures* for
  the accepted mask-path divergence.
- `docs/BACKLOG.md` — prioritized list re-ranked 2–11 → 1–10, with a dated pass note. Item 5 (the
  diagnostics channel) updated twice over: `TextureResizeUnsupported` no longer exists, so
  `unclaimed-hair.ts:197` now swallows only genuine parse failures; and the guards' verbatim
  TexTools messages no longer name which texture failed, which is a second motivation for that
  channel.
