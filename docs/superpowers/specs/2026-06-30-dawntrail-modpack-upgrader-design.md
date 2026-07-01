# Dawntrail Modpack Upgrader — Static Site Design

**Date:** 2026-06-30
**Status:** Brainstorming / design in progress (paused before final design sign-off)
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

**Open decision:** byte-identical vs. semantic/structural equivalence as the pass criterion (byte-identical
is easier to automate but brittle to incidental ordering / timestamps).

---

## 7. Environment notes

- Git repo, published on GitHub as `ffxiv-upgrade-modpack`.
- Reference repos were cloned into the **session scratchpad**, which is **ephemeral** — on resume,
  re-clone `xivModdingFramework` and `FFXIV_TexTools_UI` (URLs in §2) to a stable location (e.g.
  `./reference/`, git-ignored) for source reference.
- Windows + PowerShell. Respect package min-age (7 days) when adding npm deps.

---

## 8. Next steps (on resume)

1. Finish brainstorming sign-off on this design (and the §6 pass-criterion decision).
2. Re-clone reference repos to a stable, git-ignored location.
3. Build the test corpus: gather real pre-Dawntrail modpacks; generate goldens with `ConsoleTools /upgrade`.
4. Extract reference assets / build minimal JSON lookup tables (§5).
5. Move to **writing-plans** to produce the implementation plan (codecs first, then transforms,
   then container I/O, then UI), TDD against the golden/round-trip tests.
