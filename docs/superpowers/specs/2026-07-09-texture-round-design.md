# Texture round (round 4) — design

**Date:** 2026-07-09
**Status:** Design signed off; implementation pending.
**Sub-project:** #4 in the roadmap decomposition
(`2026-06-30-dawntrail-modpack-upgrader-design.md` §8.1).
**Goal:** Port `EndwalkerUpgrade.UpgradeRemainingTextures` — generate the Dawntrail
index maps, hair maps, and gear masks from the `UpgradeInfo` targets the material
round records — **byte-exact** against the ConsoleTools `/upgrade` golden, burning the
701 baselined `.tex` diffs toward zero.

---

## 0. Correction that motivates this round

The foundation design originally assumed the regenerated textures were BC5/BC7 and
that our block encoder could never match C#'s BcnSharp bit-for-bit, so every `.tex`
would need an intentional-divergence allow-list entry. **That premise is wrong for our
oracle.** Headless ConsoleTools uses the framework default
`DefaultTextureFormat = XivTexFormat.A8R8G8B8` (`XivCache.cs:68`), and every generation
site in the round writes **uncompressed A8R8G8B8**:

- index maps — the `?:` at `EndwalkerUpgrade.cs:1105` collapses to `A8R8G8B8`;
- hair normal/mask — `DefaultTextureFormat` passed directly (`:1213`/`:1222`);
- gear masks — `:2069`; eye diffuse (round 6, out of scope) — `:2094`.

There is **no block compressor in the golden path**. The pixel generation is
deterministic per-texel integer math plus the already-ported A8R8G8B8 pack +
nearest-neighbour decimation mipmaps (`src/tex/encode.ts`). We therefore **target
byte-exact**, keeping the allow-list only as a narrowly-scoped fallback for the one
non-deterministic step (§4). Foundation design §8.2/§8.3/§8.4 already carry this
correction.

---

## 1. Scope

Exactly the four `EUpgradeTextureUsage` values that `UpgradeRemainingTextures`
(`EndwalkerUpgrade.cs:1832`) handles, all in this round:

- `IndexMaps` — DT index map from the mod's own normal.
- `GearMaskLegacy` / `GearMaskNew` — upgraded gear masks.
- `HairMaps` — upgraded hair normal + mask.

**Out of scope:** the eye mask→diffuse pass (`UpdateEyeMask` /
`ConvertEyeMaskToDiffuse`) and skin/unclaimed-hair repaths — those are the
`includePartials` round (roadmap round 6) and lean heavily on ImageSharp
(BoxBlur/DrawImage/Bicubic) whose byte-parity is a separate, harder question.

The material round already records all four usages (`src/upgrade/material.ts`), so no
material-round change is needed beyond the dedup noted in §2.

---

## 2. Pipeline structure & data flow

C# runs **two full passes over every option** (`ModpackUpgrader.cs:88–144`); the port
mirrors it.

**Pass 1 (already built, one addition).** Per option, model + material rounds run;
the material round returns `UpgradeInfo[]`. C# accumulates these into a **single global
target map, deduplicated first-wins by key** (`ModpackUpgrader.cs:100–106`). The keys:

| Usage | Dedup key (C#) | Source |
|---|---|---|
| `IndexMaps` | `idPath` | `EndwalkerUpgrade.cs:970` `ret.Add(idPath, idInfo)` |
| `HairMaps` | normal `Dx11Path` | `EndwalkerUpgrade.cs:1141` |
| `GearMaskLegacy`/`New` | mask path | confirm at spec/plan time (see §7) |

Our current `upgradeModpack` pushes all infos into an array with **no dedup** — this
round adds the first-wins keyed collection so duplicated targets across options/materials
collapse exactly as C# does.

**Pass 2 (this round).** Re-iterate **every option** and apply the global target map to
each: `UpgradeRemainingTextures(o.Files, globalTargets)` (`ModpackUpgrader.cs:135`).
Inside, each usage is guarded on the option locally containing its source
(`files.ContainsKey(...)`), so a generated texture lands only in options that hold its
source normal/mask — never orphaned, and generated into several options if several hold
the source. This changes `textureRound`'s signature from `(targets)` to iterating
`out.groups`' options with the global target map.

Ordering is preserved: pass 1 completes for all options before pass 2 begins (two
separate `foreach` passes in C#), which our existing `for … materialRound; then
textureRound` loop already matches once `textureRound` iterates options.

---

## 3. Module decomposition (split, don't blend)

Two distinct C# sources map to two TS homes; neither blends the other's logic.

- **`src/tex/helpers.ts`** — port of `TextureHelpers.cs`. Pure pixel math:
  `createIndexTexture`, `createHairMaps`, `upgradeGearMask(legacy)`, `remapByte`,
  `modifyPixels`, and the resamplers `resizeImage` / `resizeImages`
  (bicubic + nearest-neighbour). Header cites `TextureHelpers.cs`.
- **`src/upgrade/texture.ts`** — port of `EndwalkerUpgrade.UpgradeRemainingTextures`
  plus its helpers `CreateIndexFromNormal` and `UpdateEndwalkerHairTextures`: per-usage
  dispatch, source decode, A8R8G8B8 re-encode, write-back into the option. Replaces the
  `textureRound` stub in `src/upgrade/upgrade.ts`. Header cites `EndwalkerUpgrade.cs`.

**Reuse (no new codec):**

- `src/tex/decode.ts` (+ `bc7.ts`) decodes the source normal/mask to raw RGBA. Source
  may be BC5/BC7/A8R8G8B8; BCn *decode* is defined losslessly per format spec, so
  decode-parity against C#'s runtime decode holds (this is decode, not the
  encoder-heuristic problem the old design feared).
- `src/tex/encode.ts` supplies the A8R8G8B8 pack + the `CreateFast8888DDS`
  nearest-neighbour decimation mipmaps, already ported byte-for-byte.

---

## 4. Per-usage generation & parity traps

### 4.1 Index maps — `CreateIndexFromNormal` (`EndwalkerUpgrade.cs:1083`)

Decode normal → (NPOT? resize to pow2, §4.4) → `CreateIndexTexture`
(`TextureHelpers.cs:222`): a **per-texel transform on the normal's alpha channel only**
(integer division/modulo + one `Math.Round`) → A8R8G8B8 + mips.

> Correction to the foundation design: index generation reads **only the normal's
> alpha**, not the embedded colorset. The "normal + colorset → index" phrasing in the
> older design was inaccurate.

If the normal is absent in the option, `CreateIndexFromNormal` returns null and the
target is **skipped**, not thrown (`:1843–1847`) — the mtrl was already rewritten in
pass 1.

### 4.2 Gear masks — `UpgradeGearMask` (`TextureHelpers.cs:288`)

Decode mask → per-texel channel remap (invert gloss→roughness unless `legacy`; floor
roughness at 1) → A8R8G8B8 + mips. Pure integer math, no resize expected (confirm
`UpgradeMaskTex` wrapper does no resize — §7).

### 4.3 Hair maps — `UpdateEndwalkerHairTextures` (`EndwalkerUpgrade.cs:1175`)

Decode normal + mask → (each NPOT? resize to pow2) → `ResizeImages` brings both to
`max(w,h)` (**early-returns when sizes already equal**, `TextureHelpers.cs:368`) →
`CreateHairMaps` (`:261`, per-texel channel shuffle + `remapByte`) → write **both**
normal and mask paths as A8R8G8B8.

Pass 2 requires **both** normal and mask present in the option, else C# throws
(`:1862`); reproduce the throw.

### 4.4 Parity traps

- **Banker's rounding.** C# `Math.Round` is round-half-to-**even**
  (`CreateIndexTexture:247`, `RemapByte:219`), unlike JS `Math.round` (half-up). Port a
  `bankersRound` helper; it is a prime synthetic-unit-test target.
- **Resize — the only non-deterministic step.** Bicubic/NN resize fires **only** for
  NPOT source textures (`:1098`, `:1195–1202`) or hair normal/mask of differing sizes
  (`:1205`). Strategy (§5) per the sign-off: port a best-effort resampler aiming
  byte-exact, but back only the resize-triggering textures with a tight per-pixel
  threshold; every non-resized texture stays byte-identical.

---

## 5. The divergence rule (scoped, not blanket)

Non-divergent textures **must be byte-identical** to the golden — they carry no
`DIVERGENCE_RULES` entry and any diff fails.

Add a **narrowly-scoped** `DIVERGENCE_RULES` entry (`test/helpers/upgrade-compare.ts`)
only for a genuine, confirmed divergence, that:

1. is scoped as tightly as the phenomenon allows — **by path** where the eligible files
   are identifiable at compare time, or **programmatically, by the divergence's own
   intrinsic signature**, where they are not (see the update below);
2. confirms identical tex **shape** — format (`A8R8G8B8`), dimensions, mip count, length;
3. asserts **every pixel within a tight threshold** (±1 for the decode-precision case
   below; an empirically-set threshold for the machine-dependent resize case) — never a
   licence for large deviation.

The rule cites this section as its reason.

**Update 2026-07-10 — what shipped, and a note on scoping.** The design originally
assumed the only divergence would be resize-triggered, and therefore path-scoped (keyed
to the specific resize-expected gamePaths). In practice the one divergence that
materialised is different: generated output *encodes* exactly (A8R8G8B8), but a
**BC-compressed generation source** decodes ±1 differently in our BC decoder vs C#
(implementation-defined S3TC/RGTC rounding — the class already accepted for BC5 in
`src/tex/decode.ts`), and that ±1 propagates into the generated pixels. "Was this file's
source BC-compressed?" is **not knowable at compare time** — the rule sees only the two
output byte-buffers — so a path predicate cannot express the eligible set. **A narrow,
justified _programmatic_ exception keyed to the phenomenon's intrinsic signature is
therefore acceptable in addition to path-scoping.** The shipped rule matches any `.tex`
whose two buffers are byte-identical in header/format/dims/mipCount/length, are A8R8G8B8
(so post-header bytes are raw pixels, not compressed block data), and differ by ≤1 per
byte. That signature can *only* be produced by the decode→transform→re-encode path —
resize (dims differ), trailing-trim (length differs), BC pass-through (format ≠
A8R8G8B8), and material/meta/manifest all fail it. The one residual risk — a *systematic*
±1 transform bug also matching the signature — is closed by the byte-exact transform unit
tests (`test/tex/tex-helpers.test.ts`), which fail long before the golden harness runs.
The still-deferred **resize** divergence (ImageSharp float drift, BACKLOG T3) will, when
built, use the path/threshold form of (1)–(3) above.

---

## 6. Testing & corpus coverage

**Golden-first, corpus-driven.** The 701 baselined `.tex` diffs are the oracle; the
ratchet burns down (bless step) as each usage lands.

**Coverage assessment — an explicit plan step.** Before/while implementing, enumerate:

- which of the four usages the 701 `.tex` diffs actually exercise;
- which (if any) source textures trigger a resize (NPOT, or hair size mismatch).

Fill gaps with real packs where available, else **authored synthetic modpacks** (builder
under `scripts/generate-synthetics/`, built pack gitignored, regenerated from the
committed script) flowed through the same `/upgrade` golden harness. Known thin spots to
target: hair (1 corpus pack today), gear masks (coverage unknown), and a deliberate
**NPOT / mismatched-size** case to exercise the resampler and validate the §5 rule.

**Synthetic unit tests** (hand-derived from the C#, cited): `bankersRound`, and each
per-texel transform (`createIndexTexture`, `upgradeGearMask` legacy+new, `createHairMaps`)
on small fixtures — fast regressions that fail close to the cause.

---

## 7. Fail-loud boundaries & spec-time investigations

**Fail loud (throw rather than emit non-parity bytes):**

- Hair with only one of normal/mask present in an option (`:1862`).
- Any structure the resamplers/codecs do not yet reproduce faithfully.

**Skip (not throw):** `CreateIndexFromNormal` null (normal absent) — the mtrl was
already rewritten in pass 1 (`:1843–1847`).

**Resolves backlog U4** ("fail loud on pending texture upgrades"): `textureRound` stops
being a silent no-op, so the deferred throw-on-pending is obsolete.

**Spec-time investigations (bounded, not blockers):**

- exact `GearMaskLegacy`/`New` dedup key (§2 table);
- whether `UpgradeMaskTex` (the gear-mask wrapper around `UpgradeGearMask`) performs any
  resize of its own.

---

## 8. Success criteria

- All four usages generated; `textureRound` no longer a no-op.
- `.tex` ratchet at **byte-zero** except any narrowly-scoped resize-threshold entries,
  each justified by §5 and confirmed by a real or synthetic golden.
- Coverage assessment done; under-covered usages backed by a real or synthetic pack.
- `npm run check`, `npm run typecheck`, `npm test` all green.
