# Orchestration + Material/Colorset Round — Design

**Date:** 2026-07-04
**Status:** Design approved (brainstorming); ready for implementation plan.
**Parent:** `2026-06-30-dawntrail-modpack-upgrader-design.md` (overall port),
`2026-07-04-upgrade-golden-harness-design.md` (the ratchet this round burns down).
**Depends on:** shipped mtrl codec (`src/mtrl/*`), the golden harness + baseline
ratchet, the ConsoleTools oracle plumbing in `test/helpers/oracle.ts`
(`extractGameFile`, `/list`).

---

## 1. Where this sits

This is **sub-project #2** of the upgrade port (harness spec §1): *orchestration +
material/colorset round*. It turns `upgradeModpack`'s identity skeleton into the
real four-round structure and implements the **material** half of round 1 — the
port of C# `EndwalkerUpgrade.UpdateEndwalkerMaterial` (+ its colorset/hair
helpers) on the **modpack path** (`files != null`).

Models (round 1's other half), texture generation (round 2), and partials
(round 3) remain typed no-op passes after this round; the plumbing they plug into
(per-option iteration, the round-1→round-2 `UpgradeInfo` texture-target map) is
built here. Success = the corpus `.mtrl` baseline (416 mismatches today)
collapses toward zero, with any residual either byte-matching ConsoleTools or
captured as an explicit, verified divergence rule.

## 2. Key fact: the material round rewrites `.mtrl` bytes only

On the modpack path (`files != null`) the entire texture-generation block of
`UpdateEndwalkerMaterial` is gated behind `if (files == null)`
(`EndwalkerUpgrade.cs:627-714`). So for us the material round:

- **transforms and rewrites each `chara/**.mtrl`** that needs updating, and
- **records** `UpgradeInfo` entries (index maps, gear masks, hair maps) into the
  round's return dict — consumed later by round 2.

It creates **no textures**. That makes this round self-contained except for a
small, bounded set of derived reference data (§5), and cleanly testable: every
upgraded `.mtrl` is expected to **byte-match** the ConsoleTools golden (our mtrl
serializer already reproduces C#'s normalization — harness spec §3).

## 3. Orchestration (`src/upgrade/upgrade.ts`)

Restructure the skeleton into named rounds mirroring `ModpackUpgrader.UpgradeModpack`:

```
upgradeModpack(data):
  pre-pass:  resolveHighlightOptionsAndMashupHair(data)   // see §3.1 — scoped
  round 1:   for each option: materialRound(option.files) -> collect UpgradeInfo
             for each option: modelRound(option.files)     // NO-OP this round
  round 2:   for each option: textureRound(option.files, upgradeTargets)  // NO-OP
  round 3:   partials(...)                                  // NO-OP
  return new ModpackData
```

Iteration is **per option** on that option's own `files` map, exactly as C#
(`o.StandardData.Files`) — the harness compares per-`gamePath` across options, so
we must not flatten. `materialRound` returns a `Map<string, UpgradeInfo>` that we
merge across options into `upgradeTargets` and thread into the (currently no-op)
`textureRound`, so round 2 lands without re-plumbing.

`ModpackData` stays immutable-in/immutable-out: rounds build new option `files`
maps rather than mutating input (keeps the harness "ours" side independent, as
today's skeleton does).

### 3.1 Pre-pass scope (`ResolveHighlightOptionsAndMashupHair`)

The C# pre-pass has two behaviours:

1. **Highlight/visibility option resolution** — staples a missing normal/mask
   into an option when exactly one other option supplies it. Changes which files
   an option *contains*, not `.mtrl` bytes.
2. **`RepathHairMashups`** — for material-only mashup hair, rewrites hair/ear/tail
   `.mtrl` **texture path references** from dangling EW names to the real DT names
   (`_n→_norm`, `_m→_mask|_mult`, `_s→_mask|_mult`, `_d→_base`), gated on game-file
   existence.

`RepathHairMashups` **changes `.mtrl` bytes**, so it is in scope for this round;
it runs against the derived hair/ear/tail path set (§5.2) instead of live game
reads. Behaviour (1) is texture-presence plumbing; port it **only if the corpus
shows a pack that needs it** (a mashup pack whose diff traces to a missing
stapled texture). Default: implement (2), stub (1), let the ratchet decide.

## 4. The per-material transform (`src/upgrade/material.ts`)

Port of `UpdateEndwalkerMaterial` → `UpdateEndwalkerColorset` /
`UpdateEndwalkerHairMaterial`, operating on our `XivMtrl`. Gate with
`doesMtrlNeedDawntrailUpdate` (`EndwalkerUpgrade.cs:550`): colorset of length 256
→ needs update; or Hair shpk carrying both legacy shader constants
`0x36080AD0` and `0x992869AB`.

**Colorset branch** (`ColorSetDataSize > 0`):
- If shpk is `character.shpk` → switch to `characterlegacy.shpk`.
- Strip the DX9 flag (`0x8000`) from every texture; set
  `AdditionalData = 34 05 00 00`.
- **CharacterGlass** only: overwrite `shaderKeys` / `shaderConstants` /
  `additionalData` from the derived glass params (§5.1), clear material-flags
  `Unknown0004`/`Unknown0008`.
- **Colorset 256→1024 remap** (`EndwalkerUpgrade.cs:797-873`): 16 rows → 32 rows
  (defaults from `getDefaultColorsetRow`, §4.1), copying diffuse/specular/emissive
  /subsurface pixels, with the Legacy spec-power↔gloss swaps
  (`row[offset+3]` from the flipped source index) and the Glass fixed
  specular/`0.8100586` rows.
- **Dye remap 2→4 bytes** (`:877-907`): 5-bit template + bits → 32-bit block,
  `template += 1000` for non-Legacy.
- **Add index-texture sampler**: `idPath` = normal path with `_n.tex→_id.tex`
  (else `.tex→_id.tex`); new `MtrlTexture` with sampler
  `samplerIdRaw=1449103320 (g_SamplerIndex)`, `samplerSettingsRaw=0x000F8340`,
  U/V tiling copied from the normal sampler. Record an `IndexMaps` `UpgradeInfo`
  `{normal, index}`. (idPath game-refinement: see §6 audit.)
- **Gear-mask UpgradeInfo**: Legacy → `GearMaskLegacy`, Glass → `GearMaskNew`
  (only when not `usesMaskAsSpec`), keyed by the mask sampler's path (old==new).
- **Spec→mask compat** (`:1028-1066`): if both specular and diffuse samplers
  exist, retype the specular sampler to `g_SamplerMask` and set shader keys
  `0xC8BD1DEF=0x198D11CD`, `0xB616DC5A=0x600EF9DF` (add if absent).
- Reserialize and write to `mtrl.MTRLPath`.

**Hair branch** (`ShaderPack == Hair`, no colorset — `:1115`):
- Require normal + mask samplers (else skip — unresolvable).
- Overwrite `shaderConstants` + `additionalData` from the derived hair params
  (§5.1); **preserve** the original alpha-threshold constant `0x29AC0223`.
- Record a `HairMaps` `UpgradeInfo` `{normal, mask}`; reserialize and write.

### 4.1 Shader + sampler infrastructure (`src/mtrl/shader.ts`)

Our model stores `shaderPackRaw` (string) and raw sampler CRCs; the transform
branches on shader pack and resolved texture usage, so port from `ShaderHelpers.cs`:
- `EShaderPack` ⇄ shpk-name mapping (`:535-609`).
- `ESamplerId` CRC constants (`:480-524`) — extend the few already in
  `mtrl/types.ts` to the full set the transform touches (Normal/Mask/Specular/
  Diffuse/Index + map variants).
- `samplerIdToTexUsage(samplerId, mtrl)` (`:432-478`) — the `ResolveFullUsage`
  logic, incl. the CharacterLegacy mask-as-spec special case (`:435`).
- `getDefaultColorsetRow(pack)` (`EndwalkerUpgrade.cs:1229`).

These are pure, table-driven, and independently unit-testable.

## 5. Derived reference data (no game assets shipped)

Every game read the C# material path performs is over **bounded reference data**.
We extract the specific values we consume once, at dev time, from the local game
install, and check them in as **plain constants / path sets** — the same as any
other derived table in the codebase. Each generated file carries a one-line
pointer to the script that regenerates it (operational, not a provenance
statement); raw game files are never committed.

### 5.1 Shader params — `src/upgrade/reference/{hair,glass}-shader-params.ts`

- **Hair** (`_SampleHair` = `mt_c0801h0115_hir_a.mtrl`): the DT hair
  `shaderConstants` (`{id, values[]}`) + `additionalData` bytes.
- **Glass** (`mt_c0101e5001_met_b.mtrl`): `shaderKeys` (`{id, value}`) +
  `shaderConstants` + `additionalData`.

Generated by a committed script (`scripts/extract-shader-params.ts`): drive
`extractGameFile` → parse with **our** mtrl parser → emit the numeric TS tables.
Correctness is proven by the corpus ratchet (right numbers ⇒ hair/glass mtrls
byte-match the golden).

### 5.2 Hair/ear/tail DT path set — `src/upgrade/reference/hair-dt-paths.ts`

The `RepathHairMashups` existence checks need "does this DT hair/ear/tail texture
path exist." This set is **closed**: it can only ever be referenced by mods built
against pre-switchover paths, so once enumerated it never grows.

Generated by a committed script (`scripts/extract-hair-dt-paths.ts`) that
enumerates the pre-DT hair/ear/tail root space via ConsoleTools `/list [rootId]`
(returns authoritative DT path strings — confirmed: `/list c0101h0010` →
`..._hir_norm.tex`, `..._hir_mask.tex`), collects the `.tex` paths into a
membership set, and emits it. (If per-root `/list` over the full root space proves
too slow, fall back to querying TexTools' built game cache DB for the same
`chara/human/%/obj/{hair,zear,tail}/%/texture/%.tex` set — same output.) The
ported `repathHairMashups` runs the C# rename-and-check logic against this set.

## 6. idPath game-refinement — resolve by audit, not assumption

C# `:923-936` may replace the convention `idPath` with a base-game material's own
index-sampler path, gated on two game reads. We resolve whether this ever changes
the answer **by auditing the real game**, not by assuming:

- For every base-game material path the corpus references (mtrl paths that are
  canonical game paths), `extractGameFile` the real DT material, parse its
  index-sampler path with our parser, and compare to our `_n→_id` convention.
- Broadly spot-audit gear/hair/skin materials via `/list` roots to gauge how
  universal the convention is.

Outcomes: if convention always agrees → the refinement provably cannot change
output for our inputs; document it and move on (no bundle). If any material
disagrees → extract exactly those into a minimal `material→indexPath` derived
table for exact parity. Either way the corpus ratchet is the backstop; no
divergence is silently accepted.

## 7. Testing & workflow

1. **Unit tests (TDD the pure pieces):** colorset 256→1024 remap and dye 2→4
   remap against known vectors (seed from `default_material.mtrl` ↔
   `default_material_dt.mtrl` in `Resources/DefaultTextures/` where possible);
   `samplerIdToTexUsage`, shpk mapping, `getDefaultColorsetRow`, idPath derivation.
2. **Corpus ratchet (primary gate):** run `npm test`; the material `.mtrl` diffs
   burn down. Re-bless the baseline
   (`$env:UPDATE_UPGRADE_BASELINE="1"; npm test`) to record the smaller
   remainder (still-unimplemented model/texture diffs). Any **new** divergence
   (a regressed `.mtrl`, or an unexpected diff) fails — that is the signal to fix
   or to add a reasoned divergence rule.
3. **Coverage (corpus iteration):** after the round lands, `npm run test:coverage`
   over the new material code; flag under-exercised branches (glass? stockings?
   tattoo? dyed colorsets?) and note real mods to add to the corpus so every
   transform branch is hit by a real pack. (Adding mods is a follow-on step.)

## 8. Out of scope (later sub-projects)

- Model round (v5→v6), round-2 texture generation (index maps, mask/hair
  textures), partials (unclaimed hair, eye mask→diffuse, skin repaths).
- Highlight/visibility option stapling (§3.1 behaviour 1) unless the corpus
  requires it.
- Reference data beyond §5 (eye textures, iris tables) — used only by later
  rounds.

## 9. File plan

- `src/mtrl/shader.ts` (new) — EShaderPack map, ESamplerId set,
  `samplerIdToTexUsage`, `getDefaultColorsetRow`.
- `src/upgrade/material.ts` (new) — the per-mtrl transform + `UpgradeInfo` types.
- `src/upgrade/reference/hair-shader-params.ts`,
  `glass-shader-params.ts`, `hair-dt-paths.ts` (new, generated) — derived data.
- `src/upgrade/upgrade.ts` (modify) — real round structure + pre-pass.
- `scripts/extract-shader-params.ts`, `scripts/extract-hair-dt-paths.ts` (new) —
  one-time derived-data generators.
- `test/upgrade/material.test.ts` (new) — unit tests (§7.1).

## 10. Implementation outcome (2026-07-04)

The round shipped and reached **full byte-parity with ConsoleTools `/upgrade` on
every `.mtrl` across all 46 corpus packs** (baseline `.mtrl` diffs 416 → 0; total
baseline 1619 → 1203, the remainder being the deferred `.tex` 701 / `.mdl` 453 /
`.meta` 49 rounds). Notes where reality differed from the plan:

- **idPath refinement (§6): the audit found real divergences.** 27 residual `.mtrl`
  differed from the golden **only** in the index-sampler path: for a mod
  overwriting a base-game equipment material, TexTools uses that material's own
  canonical index path (a `v{NN}_` version prefix, material-variant letter
  dropped — e.g. mod normal `c0201e0194_top_n.tex` ⇒ golden index
  `v01_c0201e0194_top_id.tex`), not derivable from the mod's bytes. Resolved with
  a minimal 11-entry `INDEX_PATH_OVERRIDES` table
  (`src/upgrade/reference/index-path-overrides.ts`) extracted from the game by
  `scripts/extract-index-overrides.ts` (base-game material → index path,
  cross-checked against the golden). Applied unconditionally per `materialPath`
  (coarser than C#'s convention-existence gate, but exact for the corpus and
  ratchet-guarded).

- **§3.1 / §5.2 `RepathHairMashups` + hair-DT-path set: NOT NEEDED, not built.**
  All 27 residuals were `chara/equipment` (idPath) materials; **zero** were
  hair/ear/tail. No corpus pack exercises the mashup-hair repath, so
  `scripts/extract-hair-dt-paths.ts` / `hair-dt-paths.ts` / `mashup.ts` were not
  created. If a future mashup-hair pack is added and its hair `.mtrl` diverges,
  build them then (the `/list`-based mechanism in §5.2 is ready).

- **Coverage / corpus gaps (§7.3).** Corpus-composition analysis of the 416
  materials that need updating shows which branches real packs exercise:

  | Branch | materials | packs | status |
  |---|---|---|---|
  | colorset (character→legacy) | 411 | 34 | well covered |
  | dye 2→4 remap | 378 | 32 | well covered |
  | spec→mask compat | 49 | 12 | well covered |
  | idPath override | 29 | 5 | covered |
  | `usesMaskAsSpec` | 16 | 2 | thin |
  | **hair branch** | 5 | **1** (Misty_Hairstyle_Female) | **thin** |
  | **CharacterGlass branch** | 4 | **2** | **thin** |
  | colorset-with-no-normal (abandon path) | 0 | 0 | unit-test only |

  Recommended corpus additions (real packs, run through the oracle) to harden the
  thin branches: **more hair mods** (the hair shader-constant swap rides on a
  single pack today), a **glass-material gear mod** (e.g. a visor/glass
  accessory), and ideally a mod that trips the **colorset-with-no-normal** abandon
  path (currently only unit-tested). `skin.shpk` colorset is not a real case (skin
  materials carry no 256-entry colorset), so its absence is expected, not a gap.
