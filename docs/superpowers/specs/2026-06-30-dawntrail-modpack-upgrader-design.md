# Dawntrail Modpack Upgrader — Static Site Design

**Date:** 2026-06-30 (roadmap refreshed 2026-07-06)
**Status:** Design signed off; foundation shipped, upgrade transforms in progress.
Codecs, container I/O, the golden harness, and the material round are merged — see
§8 for the living roadmap of the full upgrade and what remains.
**Goal:** Build a static, client-side website (hostable on GitHub Pages) that performs the single
operation of **upgrading a pre-Dawntrail FFXIV modpack to Dawntrail format** — the equivalent of
TexTools' *Tools → Dawntrail Upgrades → Upgrade Modpack*.

---

## 1. Summary of decisions so far

| Topic | Decision |
|---|---|
| Approach | **Hand-port** the upgrade logic from C# to **TypeScript/JS** running fully client-side. (Not Blazor WASM, not a server.) |
| Hosting | Static site, GitHub Pages. No backend. All processing in-browser. |
| Scope | **Full parity** with the desktop op: both `.ttmp2` and `.pmp` (and unzipped PMP folders), core model/material/texture upgrade, eye mods, **and** the "partial texture-only hair/accessory" heuristics. |
| Game install needed at runtime? | **No.** Core upgrade is self-contained on the modpack's own files. A small, finite set of reference assets is **bundled** with the site (extracted once from the game via TexTools — see §5). |
| Confidence strategy | Differential "golden" testing against the **real `ConsoleTools.exe`** that ships with the user's installed TexTools (see §6). |

---

## 2. Where the real operation lives

The desktop app `FFXIV_TexTools_UI` is a thin WPF shell. The actual logic is in the
**`xivModdingFramework`** library.

- Repos (GitHub, org `TexTools`):
  - `https://github.com/TexTools/xivModdingFramework` (branches: `master`, `develop` — UI submodule tracks `develop`)
  - `https://github.com/TexTools/FFXIV_TexTools_UI`
- The originally-referenced `liinko/FFXIV_TexTools2` is an **old, pre-Dawntrail** version — ignore it.

### Key source files (paths relative to `xivModdingFramework/xivModdingFramework/`)

| File | ~Lines | Role |
|---|---|---|
| `Mods/ModpackUpgrader.cs` | 503 | **Entry point.** `UpgradeModpack(path, includePartials)` → orchestrates the whole upgrade. |
| `Mods/EndwalkerUpgrade.cs` | ~1,900 | **Core transforms** (Endwalker→Dawntrail) for materials, models, textures, hair, eyes. |
| `Mods/WizardData.cs` | ~1,515 | In-memory modpack model. `FromModpack` / `WriteModpack`. Both `.ttmp2` and `.pmp` map to this. |
| `Mods/FileTypes/TTMP.cs` | ~1,307 | `.ttmp2` container read/write (zip: `TTMPL.mpl` JSON + `TTMPD.mpd` binary blob). |
| `Mods/FileTypes/PMP.cs` | ~1,420 | `.pmp` container read/write (zip: `meta.json` + group JSON + individual files). |
| `Materials/FileTypes/Mtrl.cs` | ~1,635 | `.mtrl` material parse/serialize (`GetXivMtrl` / `XivMtrlToUncompressedMtrl`). |
| `Models/FileTypes/Mdl.cs` | ~4,472 | `.mdl` model parse/serialize + EW→DT model fixes. |
| `Textures/FileTypes/Tex.cs` | ~1,356 | `.tex` parse/serialize, DDS<->tex conversion, mipmaps. |
| `Materials/FileTypes/STM.cs` | — | Colorset/dye (STM) handling. |

Entry call chain (modpack-upgrade path, invoked with the modpack's own `files` dict and `tx = null`):
`ModpackUpgrader.UpgradeModpack` → `WizardData.FromModpack` → `ResolveHighlightOptionsAndMashupHair` →
`EndwalkerUpgrade.UpdateEndwalkerFiles(files)` (materials, then models, then partials) →
`EndwalkerUpgrade.UpgradeRemainingTextures` → (`includePartials`) unclaimed hair / eye passes →
`WizardData.WriteModpack`.

### Headless reference: `ConsoleTools`
`FFXIV_TexTools_UI/ConsoleTools/Program.cs` is a CLI that calls
`ModpackUpgrader.UpgradeModpack(src, dest)` directly. Commands: `/upgrade`, `/resave`, `/extract`,
`/wrap`, `/unwrap`, `/list`. **This is our golden oracle** (see §6).

---

## 3. The crucial finding: game-directory dependency is NOT a blocker

We traced every read of game-installation data reachable from the upgrade entry point. Files are
resolved via `EndwalkerUpgrade.ResolveFile(path, files, tx)`, which reads from the modpack's own
`files` dict first and only falls back to the game (`tx`) when `tx != null` — and the modpack path
passes `tx = null`.

**The core upgrade needs zero game assets.** Dawntrail "Index" map pixels are generated from the
modpack's own normal map + the colorset **embedded in its `.mtrl`** (`EndwalkerUpgrade.cs:1100-1112`).
The index texture path is derived by SE naming convention (`_n.tex`→`_id.tex`,
`EndwalkerUpgrade.cs:917-921`).

The reads an earlier analysis flagged as "essential" are all **degradable** or **fixed/bounded
reference data** — none require shipping the multi-GB game install:

| Read (EndwalkerUpgrade.cs) | What | Handling in port |
|---|---|---|
| `:926-936` (idPath refinement) | Fallback to canonical index path *only if* mtrl is a base-game file | **Degradable** — use convention path (`:917-921`); correct for ~all mods |
| `:1128`, `:1511` | `_SampleHair` — **one hardcoded** hair mtrl, source of DT hair shader constants | **Bundle** 1 extracted file |
| `:1928-1929` | `eye01_base.tex`, `eye01_mask.tex` — **two hardcoded** textures | **Bundle** 2 extracted files |
| `:2044-2056` | Iris material `mt_c{race}f{face}_iri_a.mtrl` → reads to get diffuse texture path | **Bundle** small `(race,face)→path` table (or derive by convention) |
| `:1428-1436`, `:~1615-1621` | Partial **texture-only** hair/accessory: read canonical hair/ear/tail mtrl to map loose textures to new paths | **Bundle** a precomputed canonical-material→sampler-path table (bounded set); only triggers for texture-only mods (`includePartials`) |
| `:65` `AssertIsDawntrail` | Pure guard | **Remove/stub** |

The framework itself already bundles reference data (not from the game) under
`xivModdingFramework/Resources/` — see §5.

### Hardcoded reference paths to remember
- `_SampleHair = "chara/human/c0801/obj/hair/h0115/material/v0001/mt_c0801h0115_hir_a.mtrl"`
- Eye: `"chara/common/texture/eye/eye01_base.tex"`, `"chara/common/texture/eye/eye01_mask.tex"`
- Iris format: `"chara/human/c{0}/obj/face/f{1}/material/mt_c{0}f{1}_iri_a.mtrl"` (race code, face)
- Partial hair canonical materials: from `hairset.MaterialFormat` (race, hair) — bounded set to enumerate.

---

## 4. Target architecture (TS/JS, static)

In-browser pipeline mirroring `ModpackUpgrader`:

```
Upload .ttmp2 / .pmp / folder
   │
   ▼
[Container reader]  ── zip (JSZip/fflate) → WizardData-equivalent model
   │
   ▼
[Pre-pass] resolve highlight/mashup hair
   │
   ▼
[Round 1] materials (.mtrl EW→DT) + models (.mdl EW→DT)   ← self-contained on modpack files
   │           └─ caches texture-upgrade targets
   ▼
[Round 2] textures: generate Index maps (normal+colorset → BC5), hair maps, gear masks
   │
   ▼
[Round 3, optional] partial texture-only hair / eye upgrades  ← uses bundled reference tables/assets
   │
   ▼
[Container writer] → new .ttmp2 / .pmp → browser download
```

Modules to port (each a focused unit with a clear interface):
- **zip container**: `.ttmp2` (TTMPL.mpl + TTMPD.mpd) and `.pmp` (meta/group JSON + files) readers/writers.
- **`.mtrl` codec**: parse/serialize, colorset + dye (STM) data, shader keys/constants.
- **`.tex` codec + DDS/BCn**: tex<->DDS, mipmaps, **BC5/BC7 encode/decode** (index maps use BC5;
  textures may be BC7). Needs a JS BCn implementation.
- **`.mdl` codec + EW→DT model fixes** (the largest piece).
- **transforms** (`EndwalkerUpgrade` equivalents): index-map generation, hair material migration,
  eye mask→diffuse, skin repaths, mashup-hair resolution.
- **bundled reference data** (see §5).

### Library-equivalents / porting notes
C# deps → JS analogs (or "avoid"):
- DotNetZip → `fflate` or `JSZip`
- SixLabors.ImageSharp → canvas/`ImageData` or a pure-JS image lib (resize, blur, channel ops)
- `JeremyAnsel.BcnSharp` (BC compression) → need a JS BCn encoder/decoder (BC5/BC7)
- `System.Data.SQLite` (XivCache) → **avoidable**; pre-convert any needed bundled `.db` rows to JSON,
  or use `sql.js` read-only for `uv_heuristics.db`/`shader_info.db` if genuinely required by the port.
- TeximpNet (FBX/Assimp), HelixToolkit (3D viewer) → **not needed** for the upgrade path.
- SharpDX.Mathematics → JS vector/half-float math (small).

---

## 5. Reference assets to bundle (extract once, ship with the site)

**Already in the framework** (`xivModdingFramework/xivModdingFramework/Resources/`):
- `DefaultTextures/`: `default_material.mtrl`, `default_material_dt.mtrl`, `Colorset.dat`, `Colorset.dds`,
  `Diffuse.dds`, `Multi.dds`, `Normal.dds`, `Other.dds`, `Specular.dds`
- `DB/`: `item_sets.db` (~2.5MB), `shader_info.db` (~118KB), `uv_heuristics.db` (~2.7MB)
- `ShaderConstants/`: `character.json`, `skin.json`; plus `ShaderKeys.json`

**Extract from game via `ConsoleTools /extract` (or `/unwrap`)** — exactly the files the upgrade reads:
- `_SampleHair` mtrl (hair shader constants)
- `eye01_base.tex`, `eye01_mask.tex`
- Iris materials for the bounded `(race, face)` set (only diffuse-sampler path needed → can reduce to a JSON table)
- Canonical hair/ear/tail materials for the partial path (only sampler paths needed → JSON table)

Goal: derive **minimal JSON lookup tables** (paths/metadata) rather than shipping raw assets where only
metadata is consumed. Keep the bundle small.

---

## 6. Confidence / testing strategy

No public tests exist (the `.sln` references `xivModdingFramework.xUnit` + `exChecker`, but neither is
committed to `master` or `develop`; no CI). We build our own, anchored on a **real golden oracle**:

**Oracle available:** the user has FFXIV (Dawntrail) **and** official TexTools installed.
- `ConsoleTools.exe`: `C:\Program Files\FFXIV TexTools\FFXIV_TexTools\ConsoleTools.exe`
- `console_config.json` already points `XivPath` at the Steam FFXIV install — `/upgrade` works out of the box (verified).

> ⚠️ **CORRECTION (2026-06-30, verified against a 32-pack real corpus).** The oracle (`/resave` and
> `/upgrade`) is a **transforming** operation, NOT byte-preserving. It decompresses each inner game file,
> re-compresses it (different block layout ⇒ different bytes), and normalizes/upgrades model `.mdl` files
> (uncompressed size changes). Therefore **any golden diff against ConsoleTools must compare DECOMPRESSED /
> semantic content, never raw compressed payloads** — which requires the SQPack codec. Until codecs exist,
> the container-only layer is validated by a **self round-trip** (our reader→writer→reader, byte-identical
> inner files), which passed 32/32 on the real corpus and needs no oracle. This resolves the open decision
> below: **byte-identical for our own round-trip; semantic/structural for oracle diffs.**
>
> *Refined 2026-07-20 — see §6.1.* "Semantic for oracle diffs" is right about the **compression layer**
> (compare decompressed content, never raw compressed payloads) but is not the whole criterion: once
> decompressed, a binary game file is compared **byte-identically**, and it is the **JSON manifests**
> that stay semantic all the way down. §6.1 states the criterion per data class.

Layers (strongest first):
1. **End-to-end golden diff.** Run `ConsoleTools /upgrade <pack> <golden>` over a corpus of real
   pre-Dawntrail modpacks. The TS port must reproduce each `<golden>` compared on **decompressed** content
   (the oracle recompresses/normalizes — see correction above), not raw bytes.
2. **Component goldens.** Per-transform input→output pairs (mtrl EW→DT, normal→index, eye-mask→diffuse),
   seeded from `/extract` outputs and the bundled `Resources` fixtures
   (`default_material.mtrl` ↔ `default_material_dt.mtrl`, `Colorset.*`).
3. **Binary round-trip parity.** parse→reserialize `.mtrl`/`.tex`/`.ttmp2`/`.pmp` → assert byte-identical,
   **before** testing any transform (isolates codec bugs from transform bugs).
4. **Structural validation.** Upgraded packs re-open/validate; where oracle exists, match the C# golden.

This pairs with TDD at implementation time: round-trip + component goldens become the failing tests
written first.

### 6.1 What "equal" means, by data class

**Resolved 2026-07-20** (operator's call), closing the open decision this section used to carry. The
answer is not one criterion but one **per data class**, and the dividing line is *which consumer can
observe the bytes*:

| Data class | Criterion | Why |
| --- | --- | --- |
| JSON manifests — `.mpl`, `default_mod.json`, `group_NNN*.json`, `meta.json` | **Semantic** (parse, then deep-compare) | Every consumer reads them through a JSON parser: TexTools' own `JsonConvert.DeserializeObject<ModPackJson>` (`TTMP.cs:143,395,600`), Penumbra likewise. Key order and other byte-level spelling are unobservable. |
| Proprietary binary — `.mdl`, `.tex`, `.mtrl`, `.meta`, SQPack blocks | **Byte-identical** (on decompressed content) | No parser-normalizing layer stands between our bytes and the game. Ordering, padding and layout are all load-bearing. |
| Our own reader→writer round-trip | **Byte-identical** | Self-consistency: `decode(encode(x)) != x` is our codec contradicting itself, with no TexTools output involved. |

For JSON manifests this means **key order is not a divergence and not a gap** — a reordered document
is the same document to every parser that reads it. The key *set* and the key *values* remain strictly
in scope: a missing, extra or wrong-valued key changes what every consumer sees, and that is what the
`.mpl` manifest-fidelity work pinned. Applies symmetrically to golden diffs and to unit tests: the
harness routes manifests to `jsonPointerDiff` via `isManifest`
(`test/helpers/upgrade-archive-diff.ts`), taking the strict complement for the payload byte-diff, and
no unit test asserts key order or byte equality on a JSON document.

The trap this closes: because manifests are compared semantically, a key-order difference is
invisible to every corpus check and ratchet — so it is tempting to read that invisibility as a blind
spot and re-add strictness at the unit level. It is not a blind spot; it is the criterion working as
designed. Do not "fix" it. (One such test existed and was loosened to a key-set assertion on
2026-07-20.)

The rule as applied day-to-day lives in `AGENTS.md` under the byte-parity principle; this section is
the decision record behind it. Note it does **not** widen the *divergence* machinery — a divergence is
a difference a consumer *can* see, which we then confirm with a rule; this is about differences no
consumer can see, which are not differences at all.

---

## 7. Environment notes

- Git repo, published on GitHub as `ffxiv-upgrade-modpack`.
- Reference repos were cloned into the **session scratchpad**, which is **ephemeral** — on resume,
  re-clone `xivModdingFramework` and `FFXIV_TexTools_UI` (URLs in §2) to a stable location (e.g.
  `./reference/`, git-ignored) for source reference.
- Windows + PowerShell. Respect package min-age (7 days) when adding npm deps.

---

## 8. Delivery status & remaining rounds (living roadmap)

The design is signed off and the build is well underway. The §6 open pass-criterion
resolved to **exact decompressed-byte equality by default, with an explicit
intentional-divergence allow-list** (see the harness spec §4.4). Reference repos, the
corpus, and the cached goldens are all in place. This section is the living map of
what the *full* upgrade comprises and what remains.

### 8.1 Sub-project decomposition

The C# port (`ModpackUpgrader` orchestration + ~2,200 lines of `EndwalkerUpgrade`
transforms) is too large for one spec; it is built as **sequential sub-projects**,
each its own spec→plan→implement cycle. Status as of 2026-07-10:

| # | Sub-project | Spec | Status |
|---|---|---|---|
| — | sqpack / mtrl / tex+BCn / mdl codecs + container I/O (ttmp2 / pmp / legacy) | their own specs (`*-codec-design.md`) | ✅ shipped |
| 1 | E2E golden harness + `/upgrade` cache + baseline ratchet | `2026-07-04-upgrade-golden-harness-design.md` | ✅ shipped |
| 2 | Orchestration + material/colorset round | `2026-07-04-material-colorset-round-design.md` | ✅ shipped (`.mtrl` 416 → 0) |
| 3 | **Model round** — full normalizer, re-scoped into **3a** MDL geometry codec + **3b** model normalizer | `2026-07-06-model-round-design.md` (+ `-model-normalizer-research.md`, `-model-normalizer-design.md`) | ✅ shipped — **3a** geometry codec (PR #12) + **3b** normalizer (`.mdl` 453 → 0; all 459 corpus models byte-exact vs golden) |
| 4 | **Texture round** (index maps, gear masks, hair maps) | `2026-07-09-texture-round-design.md` | ✅ shipped — index/gear/hair generated byte-exact; BC-source-decode ±1 confirmed via one programmatic `DIVERGENCE_RULES` entry; resize skips deferred (BACKLOG T3) |
| 4b | **TexFix round** (drop malformed `.tex` at load) — *newly surfaced by round 4* | (folded into round 4) | ✅ shipped (`src/upgrade/texfix.ts`; drop-malformed subset of `FixOldTexData`; rest is BACKLOG T2) |
| 5 | **Metadata round** (base-game metadata re-materialization) | `2026-07-10-metadata-round-design.md` | ✅ shipped (`.meta` byte-zero) |
| 6 | **Partials + reference-asset bundling** | `2026-07-15-partials-skin-paths-design.md`, `2026-07-16-eye-mask-partial-design.md`, `2026-07-16-eye-mask-pixel-pipeline-design.md`, `2026-07-16-unclaimed-hair-partials-design.md`, `2026-07-18-repath-hair-mashups-design.md` | ✅ shipped |
| 7 | **Site / UI** (static GitHub Pages) | *(none yet — unspecced)* | ⏳ **the only unstarted round** |

### 8.2 What each remaining round does

- **Round 3 — Model round (full normalizer).** *Re-scoped 2026-07-06 after the
  FixOldModel finding.* The golden does NOT use the size-preserving
  `FastMdlv6Upgrade` byte-patch; it **normalizes every model** at read time via
  `EndwalkerUpgrade.FixOldModel` (`GetXivMdl → TTModel.FromRaw →
  MakeUncompressedMdlFile`): LoD0-only collapse + v6 + a full **vertex-geometry
  re-encode** (Half→Float precision upgrade). Our structure-preserving `.mdl` codec
  cannot reproduce it, so this is the **largest sub-project** — effectively a new MDL
  geometry codec + a model rebuilder. Split into **3a** MDL geometry codec (vertex
  decl + geometry decode/encode, round-trip tested) and **3b** model normalizer
  (TTModel weld + serializer + gate + wiring). Byte-exact vs golden; no allow-list
  entry. 453 diffs. See `2026-07-06-model-round-design.md` (§0 correction) and
  `2026-07-06-model-normalizer-research.md`. **Update 2026-07-06:** 3a (the MDL
  geometry codec — vertex-declaration codec + geometry decode/encode, corpus
  round-trip verified) shipped via PR #12. **Update 2026-07-07:** 3b shipped — the
  TTModel weld + merges + `MakeUncompressedMdlFile` serializer (incl. v6 bone-set
  zero-extension, shape data, and the shape-vertex binormal copy) + the TTMP-version
  gate + wiring drive the `.mdl` ratchet **453 → 0**; **all 459 corpus models are
  byte-exact** vs the ConsoleTools golden (`src/mdl/model/`, spec
  `2026-07-06-model-normalizer-design.md`). Deferred-but-documented: `FixUpSkinReferences`
  (no-op stub, never fired on the corpus) and non-chara/extra-mesh/neck-morph/furniture
  models (serializer fails loud — none in the corpus).

- **Round 4 — Texture round.** Port of `UpgradeRemainingTextures`: consumes the
  `UpgradeInfo` targets the material round records (`IndexMaps`,
  `GearMaskLegacy`/`New`, `HairMaps`) and **generates** the new `.tex` files — the DT
  "index" map from the mod's own normal + colorset, upgraded gear masks, hair maps.
  **Target: byte-exact — no allow-list needed.** *(Corrected 2026-07-09.)* An earlier
  draft of this section assumed the generated textures were BC5/BC7 and that our block
  encoder could never match C#'s BcnSharp bit-for-bit, so every `.tex` would need an
  intentional-divergence allow-list entry. That premise is **wrong for our oracle**:
  headless ConsoleTools uses the framework default `DefaultTextureFormat =
  XivTexFormat.A8R8G8B8` (`XivCache.cs:68`), and every generation site in the round
  writes **uncompressed A8R8G8B8** — the `?:` at `EndwalkerUpgrade.cs:1105` collapses
  to `A8R8G8B8`, and the hair/gear/eye paths (`:1213`/`:1222`/`:2069`/`:2094`) pass
  `DefaultTextureFormat` directly. There is **no block compressor in the golden
  path**, so the pixel generation is deterministic per-texel integer math
  (`TextureHelpers.CreateIndexTexture`/`CreateHairMaps`/`UpgradeGearMask`) plus the
  already-ported A8R8G8B8 pack + nearest-neighbour decimation mipmaps
  (`src/tex/encode.ts`). We therefore **aim for byte-exact** and keep the allow-list as
  a *fallback* for whatever narrow cases prove to resist parity, confirmed empirically
  rather than assumed. Known parity traps to pin during the spec: (1) C# `Math.Round`
  is banker's rounding (round-half-to-even), unlike JS `Math.round`
  (`CreateIndexTexture:247`); (2) the NPOT Bicubic resize (`:1098`, ImageSharp) would
  be hard to match — but only fires for non-power-of-two source textures (`encode.ts`
  fails loud there today), so the first question is whether any corpus `.tex` diff is
  NPOT-sourced. tex codec built. 701 diffs.

  **Update 2026-07-10 — shipped.** All four usages generate; `.tex` ratchet burned down
  (corpus total 1203 → ~421). Banker's rounding ported (`bankersRound`). The
  "byte-exact, no allow-list" aim was *mostly* right but needed one correction, found
  only by adding real gear/hair coverage packs and a **built + debugged ConsoleTools**
  (see below): the output *encode* is exact (A8R8G8B8), but when a generation **source**
  texture is BC-compressed, our BC *decoder* has an implementation-defined ±1 value-
  rounding gap vs C# (same class already accepted for BC5 in `src/tex/decode.ts`), which
  propagates into the generated pixels. So the round ships with **one programmatic
  `DIVERGENCE_RULES` entry** (`test/helpers/upgrade-compare.ts`) that confirms exactly
  this: identical tex header/format/dims/mipCount/length, format A8R8G8B8 (so bytes are
  raw pixels), every post-header byte within ±1 — keyed to the phenomenon's intrinsic
  signature, not a path list. Resize (NPOT / hair size-mismatch) remains deferred behind
  the ImageSharp resampler (**BACKLOG T3**; real case: `Misty_Hairstyle_Female`). Two
  further findings became their own load-time work: a **TexFix round** (`texFixRound`,
  drop-malformed `.tex`) — needed because the golden drops malformed 4×4 placeholder
  normals at load (`FixOldTexData` → `ReadSqPackType4` throws, `Dat.cs:908-909`), which
  our lenient `decodeType4` didn't reproduce; the rest of `FixOldTexData` is **BACKLOG
  T2**. The `index-path-overrides` table was missing some base-game entries (**BACKLOG
  T4** — shipped 2026-07-20, see §8.4 below and
  `2026-07-20-index-path-resolution-design.md`). Spec: `2026-07-09-texture-round-design.md`.

- **Round 5 — Metadata round.** *Shipped 2026-07-10.* Not just a backfill transform —
  the golden's `.meta` files are **re-materialized from a base-game seed plus the
  mod's deltas** (`ManipulationsToMetadata`, `PMP.cs:1271` → `ItemMetadata.cs:253`),
  not a pass-through of the mod's own bytes. That required a new binary codec
  (`src/meta/deserialize.ts` + `serialize.ts`, proven by a corpus round-trip identity
  test over 71 real golden `.meta` files) plus a per-segment reconstruction
  (`src/meta/reconstruct.ts`) driven by two generated reference tables
  (`src/meta/reference/est-table.ts`, `imc-table.ts`, via
  `scripts/extract-meta-reference.ts`) and root/EstType parsing
  (`src/meta/root.ts`, `Est.GetEstType`, incl. weapon/monster and hair/face race
  handling) plus `src/meta/playable-races.ts`. Per segment: **EQDP** is data-free —
  canonical 18-race expansion with zero-backfill for missing races, no base table
  needed; **EQP/GMP** pass through unchanged (proven never-consulted base seed); **EST**
  seeds from the base est table (equipment = full 18-race; hair/face = single
  root-race, per `Est.cs:259-291`, with a SkelId-only override per
  `PmpManipulation.cs:275-279`); **IMC** grows to the base-game variant count from the
  IMC table. Wired via `metadataRound` in `src/upgrade/upgrade.ts`. Target byte-exact
  achieved — the `.meta` ratchet is byte-zero across the corpus, **no
  `DIVERGENCE_RULES` entry** needed. Four real packs added to the corpus
  (Purrfection, Paglth'an, Vixen, Cambria) to exercise EST/IMC growth paths. Spec:
  `2026-07-10-metadata-round-design.md`. ~~Remaining follow-up: the IMC table is
  corpus-scoped…~~ **Struck 2026-07-20 — stale.** That follow-up was closed by
  `2026-07-19-imc-reference-table-unification-design.md`: `imc-table.ts` is now
  **exhaustive** over every root in `item_sets.db` whose primary type `Imc.UsesImc`
  accepts (equipment, accessory, weapon, monster, demihuman; both `ImcType.Set` and
  `NonSet`) — 15,695 roots, enumerated by a SQL walk in
  `scripts/extract-meta-reference.ts:299-306`, with the corpus used only as a spot-check
  (`:452-537`). A miss now **throws** (`src/meta/reconstruct.ts:154-176`) rather than
  passing the mod's IMC through.

- **Round 6 — Partials + reference bundling.** *Shipped (specs dated 2026-07-15 →
  2026-07-18; status corrected here 2026-07-20 — this bullet previously read "no corpus
  pack exercises these today").* Port of the `includePartials` heuristics: skin repaths,
  unclaimed hair textures/accessories, eye mask→diffuse, plus `RepathHairMashups`. Runs
  from `partials()` (`src/upgrade/upgrade.ts:255-276`, called at `:358`) across
  `src/upgrade/{skin-repath-dict,unclaimed-hair,eye-mask,repath-hair-mashups}.ts`.

  The §5 reference assets **are** extracted and bundled: `eye-base-textures.ts` (the two
  hardcoded eye textures, decoded via ConsoleTools `/extract` so we don't rely on our own
  BC decoder), `eye-materials.ts` (339 iris materials), `hair-materials.ts` (1,513
  canonical hair/tail/ear materials), and `hair-texture-index.ts`/`hair-texture-exists.ts`
  (a bundled CRC32 `FileExists` oracle). Each is a *generated* table with a committed
  `scripts/extract-*` script, per AGENTS.md.

  **`includePartials` is deliberately not plumbed** — partials always run. No shipped
  TexTools caller ever passes `false`: ConsoleTools omits the argument
  (`ConsoleTools/Program.cs:179` → the `ModpackUpgrader.cs:212` overload, defaulting
  `true`), and the desktop UI hardcodes `var includePartials = true`
  (`MainWindow.xaml.cs:2107-2116`) with the checkbox-backed
  `FixPreDawntrailPartialOnImport` setting commented out. Adding the flag would create an
  untested mode with no oracle behind it.

  Open follow-up: `hair-texture-exists`' namespace scoping — see
  `docs/backlog/2026-07-20-hair-texture-exists-namespace-scope.md`.

- **Round 7 — Site / UI.** The actual product (§4): a static GitHub Pages page —
  upload `.ttmp2` / `.pmp` / folder → `upgradeModpack` in-browser → download. The
  transform seam (`upgradeModpack(data): ModpackData`, exported from `src/index.ts`)
  is stable, so the UI can be built in parallel against the current partial pipeline
  and gains correctness as each round lands.

### 8.3 Burndown

The gitignored ratchet baseline **is** the burndown chart (harness §4.5). Total
non-matching diffs: **1619** at material-round start → **1203** after the model round →
**~421** after the texture + TexFix rounds (the `.tex` bulk generated byte-exact;
malformed placeholders now dropped at load) → **316** after the metadata round
(the `.meta` segment is now byte-zero across all 56 baselined corpus packs — confirmed
zero `.meta` entries in any baseline; four real coverage packs — Purrfection, Paglth'an,
Vixen, Cambria — were added during round 5, and their remaining non-`.meta` diffs are
included in the 316).

**Recount 2026-07-20 — the "316" above is not comparable to today's number.** The live
`.upgrade-baseline` holds **5811 entries across 64/64 packs**. This is *not* a regression:
the earlier figures predate manifest diffing, so they counted payload + structure only.
Composition today:

| kind | count | what it is |
|---|---|---|
| manifest | 5431 (93%) | the three `writeTtmp2` items — `ModPackEntry`, `Name`, `FullPath` order, `IsChecked`, `Category`, `DatFile`, `Description` |
| payload | 333 | `.tex` 354 (T2/T3 resize) · `.mdl` 12 · `.mtrl` 5 |
| structure | 47 | PMP orphan-member retention |

So the payload burndown is roughly on the old trajectory, and the manifest bulk is one
tightly-scoped writer gap rather than diffuse breakage — now on the `docs/BACKLOG.md`
Prioritized list ("the three `writeTtmp2` manifest items"). Note the count is a **local,
corpus-dependent** measurement (both the
corpus and the baselines are gitignored), so it is a trend indicator, not a fixed number
a fresh clone can reproduce.

Separately, the **SQPack self round-trip ratchet is empty** — `decode(encode(x)) == x`
holds across the corpus, i.e. that ratchet is already at its goal state.

Remaining diffs are the deferred rounds and gaps: the `writeTtmp2` manifest fields,
source-`.tex` resize/trailing-trim (T2/T3), and container-manifest structure. (T4, the
index-path overrides gap, shipped 2026-07-20 — see §8.4.) The BC-source-decode ±1 is not
a baselined diff but a confirmed intended divergence via the single programmatic
`DIVERGENCE_RULES` entry. End
state: every baseline empty (byte-zero), with the committed allow-list holding only
whatever narrow paths prove empirically to resist parity (see §8.2 — the texture round is
now targeted byte-exact, not assumed divergent).

### 8.4 Path to a complete end-to-end tool & known gaps

**Remaining path.** *(Updated 2026-07-20.)* **All seven transform rounds are shipped** —
round 6 landed with the specs listed in §8.1. What remains is (a) the residual
correctness gaps that keep the ratchet off zero, (b) the **site (round 7)**, still
unspecced and now the only unstarted round, and (c) the robustness gaps below. The UI is
decoupled from everything else by the stable `upgradeModpack` seam
(`Uint8Array → Uint8Array`, synchronous) and should start in parallel rather than last.
"Feature-complete" = the ratchet is empty (byte-zero), with any allow-list entries
confined to narrow paths empirically shown to resist parity (see §8.2/§8.4 — none assumed
up front); "product-complete" = that, behind the static GitHub Pages page.

The prioritized ordering across all of this lives in `docs/BACKLOG.md`, ranked by
probability × severity that a user gets a wrong or failed modpack.

**Known gaps & open risks** (each is a place the system is not yet whole):

- **Thin corpus coverage on already-shipped branches** (material round §10):
  hair rides on **1** pack, CharacterGlass on **2**, and the
  colorset-with-no-normal abandon path is **unit-test-only**. These pass today but
  are under-exercised; widening the corpus with real mods hardens them. This
  concern **rides on every future round**, not just the material one.
- **Two bundled reference tables had an unfaithful *silent* miss; one is now fixed.**
  *(Added 2026-07-20, from a completeness audit of all eight tables; updated same day
  when the first was closed.)* AGENTS.md requires a bundled table to **be** the
  existence oracle, so that a lookup miss means the file is genuinely absent. Six
  tables always satisfied this — `imc-table` (15,695 roots) and `est-table` enumerate
  their full domain and **throw** on the unfaithful case; `hair-materials` (1,513) and
  `eye-materials` (339) enumerate the full race grid against the real 040000 index, so
  their silent skip *is* the C# `FileExists == false` branch; `eye-base-textures` has no
  lookup surface.
  - ~~`index-path-overrides` (11 entries) was **corpus-derived**~~ **Shipped
    2026-07-20.** The corpus-scoped 11-entry table and its unconditional application
    (skipping C#'s convention-existence gate) were replaced by a complete, item-seeded
    enumeration over every base-game material with an index sampler
    (`src/upgrade/reference/index-table.ts` / `index-path-resolver.ts`, generated by
    `scripts/extract-index-table.ts`), gated on the convention `_id.tex`'s existence
    like C# does. See `docs/superpowers/specs/2026-07-20-index-path-resolution-design.md`.
    Closes `docs/BACKLOG.md` T4 (item file deleted on shipping, per convention).
  - `hair-texture-exists` is still **namespace-scoped** (hair/zear/tail textures, id ≤
    500) but is asked about sampler paths that may point anywhere, answering a hard
    `false` and silently suppressing a rename.
    `docs/backlog/2026-07-20-hair-texture-exists-namespace-scope.md`, which now cites
    the item-seeded enumeration pattern above as its template.

  The remaining one is still not catchable by the ratchet, **by construction** — it can
  only ever see inputs the local corpus already contains. That is the general shape of
  the residual risk now: code coverage is high (92.98% lines / 84.6% branches), so what
  remains is unexercised **data and inputs**, not unexercised code paths.

- **Reproducing TexTools faithfully can still leave the user worse off — in one place.**
  `unclaimed-hair.ts:197-204` reproduces TexTools' bare `catch { continue }`
  (`TEXTOOLS_BUGS.md` #12), which is the correct port. But TexTools writes a `Trace` line
  and a webpage writes nothing, so the page would report success on a partial upgrade.
  The pipeline has no diagnostics channel out of `upgradeModpack` today; round 7 needs
  one — see "a diagnostics channel out of `upgradeModpack`" on the `docs/BACKLOG.md`
  Prioritized list. This is a *reporting* gap, not a divergence.
- **Texture (round 4) is now targeted as byte-exact, not a permanent divergence.**
  *(Corrected 2026-07-09 — see §8.2.)* The "our BCn encoder ≠ C#'s" premise does not
  apply: ConsoleTools writes the regenerated textures uncompressed (A8R8G8B8,
  `XivCache.cs:68`), so no block compressor is in the golden path and the `.tex`
  baseline can reach byte-zero. The allow-list (harness §4.4) is held in reserve only
  for narrow paths empirically shown to resist parity (candidate: NPOT Bicubic resize
  via ImageSharp, `EndwalkerUpgrade.cs:1098`; and the round-6 eye-mask Gaussian blur),
  not applied to the round wholesale.
- **No CI; the only gate is the local ratchet + ConsoleTools oracle.** A fresh
  clone cannot reproduce the ratchet without the local corpus and cached goldens
  (both gitignored). The gate lives on the maintainer's machine by design (§6),
  which is a resilience gap to be aware of.
- **The site/UI (round 7) is unstarted.** The seam exists and is stable, so this
  is greenfield work rather than a blocked dependency.
