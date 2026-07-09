# Skin-reference fixup — porting `FixUpSkinReferences` + `GetSkinRace` (audit 6-1)

**Date:** 2026-07-08
**Status:** Design — signed off for scope; ready for an implementation plan.
**Roadmap:** sub-project of the model round (Round 3) in the foundation design
`2026-06-30-dawntrail-modpack-upgrader-design.md` (§8). Closes the last deferred piece of
that round: `FixUpSkinReferences` (noted as a no-op stub in §8.2).
**Backlog item:** `BACKLOG.md` → Prioritized → "`fixUpSkinReferences` (audit 6-1)".
**Audit:** `docs/audits/2026-07-07-porting-guideline-audit.md` → 6-1.

> **Provenance note.** All C# citations are `file · symbol · lines` against the vendored,
> read-only `reference/FFXIV_TexTools_UI/lib/xivModdingFramework/xivModdingFramework/…`. Paths
> below are abbreviated to the trailing segment (e.g. `Models/Helpers/ModelModifiers.cs`).

---

## 1. Problem

`src/mdl/model/model-modifiers.ts` `fixUpSkinReferences` is a **reachable no-op**. It runs on
every model build (`src/mdl/model/from-raw.ts:51`, which mirrors `TTModel.FromRaw`
(`Models/DataContainers/TTModel.cs · FromRaw · 2722`)). The C# version rewrites a mesh's
skin-material race/body code (`c####`/`b####`) to the model path's resolved *skin* race
whenever they differ, and — for **hair** models — rewrites hair-material references to the
shared "hair material root". Both change the serialized `.mdl` bytes. Our no-op silently
diverges from the golden on any such case.

It is latent on the current corpus (the skin path needs a **cross-race** skin reference, which
a single-race corpus never produces; 0 `.mdl` mismatches today). We could not add a cheap
fail-loud guard because the precise divergent condition needs `XivRaceTree.GetSkinRace`
(`General/Enums/XivRace.cs · GetSkinRace · 353-381`), and a naive race-mismatch throw would
over-throw the common *correct* case (a child race referencing its parent's skin, which C#
leaves untouched). This spec ports the behaviour properly.

**Decision (operator, 2026-07-08): full faithful port** — reproduce the rewrite so the
divergence is *closed* (byte-parity), not merely guarded — **including the `hairFix` branch**.

---

## 2. The C# we are porting — dependency map

### 2.1 The two overloads on our path

`TTModel.FromRaw` calls **`FixUpSkinReferences(TTModel, string newInternalPath)`**
(`Models/Helpers/ModelModifiers.cs · FixUpSkinReferences · 2309-2336`) with
`newInternalPath = rawMdl.MdlPath`. In our port that is `rm.source` = `mdl.filePath`
(`src/mdl/model/read-model.ts:410`), the full internal path (e.g.
`chara/human/c1401/obj/body/b0001/model/c1401b0001_top.mdl`).

That overload:
1. Matches `(c[0-9]{4})` against `newInternalPath`. **No match → return** (non-racial model).
2. `baseRace = XivRaces.GetXivRace(code)` (`XivRace.cs · GetXivRace · 866-871`) — maps the
   `####` digits to an `XivRace`, or `All_Races` (0) if unknown.
3. Delegates to the second overload with `baseRace`.

**`FixUpSkinReferences(TTModel, XivRace baseRace, …, string bodyReplacement = "")`**
(`ModelModifiers.cs · FixUpSkinReferences · 2347-2399`) is the real work:
- `skinRace = XivRaceTree.GetSkinRace(baseRace)`; `skinRaceString = "c" + GetRaceCode(skinRace)`.
- `modelRoot = XivCache.GetFileNameRootInfo(model.Source)`; if `modelRoot.IsValid()` and
  `SecondaryType == hair`, set `hairFix = true` and `hairInfo = Mtrl.GetHairMaterialRoot(modelRoot)`.
- For each `MeshGroup m` (`:2370-2397`):
  - **Skin block** (`:2374-2390`), gated on `SkinMaterialRegex.IsMatch(m.Material)`:
    - `SkinMaterialRegex` = `^/mt_c([0-9]{4})b([0-9]{4})_.+\.mtrl$` (`ModelModifiers.cs:2298`).
    - If the material's `(c[0-9]{4})` ≠ `skinRaceString`: replace the race code with
      `skinRaceString`, **then** reset body to `b0001` via `(b[0-9]{4})` → `bodyReplacement`
      (which is `"" → "b0001"` on our path). (`:2378-2385`)
    - Else if `bodyReplacement != ""`: reset body only. **Dead on our path** —
      `bodyReplacement` is always `""` (the FromRaw overload never sets it). Documented, not
      ported as live logic. (`:2386-2389`)
  - **Hair block** (`:2392-2395`), gated on `hairFix`: `m.Material = m.Material.Replace(
    modelRoot.GetBaseFileName(false), hairInfo.GetBaseFileName(false))` — runs on **every**
    material of a hair model, redirecting the hair root code to the shared hair root.

> The third overload `FixUpSkinReferences(string, List<string>)` (`:2400-2444`) is **not** on
> our path (it is the material-list variant). Not ported.

### 2.2 `GetSkinRace` and its data source

`XivRaceTree.GetSkinRace(this XivRace race)` (`XivRace.cs · GetSkinRace · 353-381`):
```
node = GetNode(race)                       // _Dict[race]  (see note on throw, below)
if node == null: return Hyur_Midlander_Male // effectively dead — see §4.3
if race == Roegadyn_Female: return Hyur_Highlander_Female   // SE hard-coded special case
if node.HasSkin: return node.Race
while node.Parent != null: node = node.Parent; if node.HasSkin: return node.Race
return Hyur_Midlander_Male                  // fallback (unreached: root has skin)
```
It needs exactly two things per race:
- **`HasSkin`** — the static `SkinRaces` HashSet (`XivRace.cs · SkinRaces · 165-183`), 16 races.
  Fully specified in source.
- **`Parent` chain** — **not in the C# source.** Built at runtime by `XivRaceTree.BuildRaceTree`
  → `AddChildren`/`MakeNode` (`XivRace.cs:136-203`) from `PDB.GetBoneDeformSets`
  (`Models/FileTypes/PDB.cs · GetBoneDeformSets · 68-192`), which `Dat.ReadFile`s the base-game
  archive file `chara/xls/bonedeformer/human.pbd` (`PDB.cs:56`). Parent edges come from each
  set's `TreeEntry.ParentIndex` (`PDB.cs:105-133`).

`GetRaceCode` (`XivRace.cs · GetRaceCode · 515-519`) reads the `[Description("0101")]` attribute
off the enum → the 4-digit code. `GetXivRace(string)` (`:866-871`) is its inverse.

### 2.3 `hairFix` sub-tree

`hairFix` pulls in a small, self-contained projection of three subsystems:
- `XivCache.GetFileNameRootInfo(fileName)` (`Cache/XivCache.cs · GetFileNameRootInfo · 1791-1795`)
  = `Path.GetFileNameWithoutExtension` then
  `XivDependencyGraph.ExtractRootInfoFilenameOnly(name, validate:true)`
  (`Cache/XivDependencyGraph.cs · ExtractRootInfoFilenameOnly · 607-645`): regex
  `([a-z])([0-9]{4})([a-z])([0-9]{4})_?([a-z]{3})?` → `{primaryType, primaryId, secondaryType,
  secondaryId, slot}`, prefixes mapped via `XivItemTypes.FromSystemPrefix`
  (`Items/Enums/XivItemType.cs · FromSystemPrefix · 340-345`; `'c'→human`, `'h'→hair`), then
  `.Validate()`.
- `XivDependencyRootInfo` (`Cache/XivDependencyRoot.cs`): the 5-field struct plus
  `IsValid()` (`:101-114`), `Validate()` (`:482-521`), `GetBaseFileName(bool includeSlot)`
  (`:138-158`, uses `XivItemTypes.GetSystemPrefix` (`XivItemType.cs:318-333`)).
- `Mtrl.GetHairMaterialRoot(root)` (`Materials/FileTypes/Mtrl.cs · GetHairMaterialRoot ·
  1429-1485`): throws for non-`human`/`hair` roots; returns `root` unchanged for Hrothgar
  (`PrimaryId 1601/1501`), racial-unique hairs (`SecondaryId < 101`), the Miqo/Hroth exceptions
  in the 101-115 band, and `SecondaryId >= 201`; otherwise collapses `PrimaryId` to `201`
  (female, `(PrimaryId/100)%2==0`) or `101` (male) for the shared-hair bands (101-115 and
  116-200).

Only the members above are needed; the rest of `XivDependencyRoot`/`XivDependencyGraph`/
`XivItemType` is **not** ported (per "split, don't blend", we take the minimal faithful
projection, each in its C#-owner-named module — see §3).

---

## 3. Design — module layout (split, don't blend)

New modules, each mapping to one C# owner and citing it in a header comment. Placement mirrors
the C# namespace tree (these `src/` roots are new; the repo has no prior race/cache/items code —
verified 2026-07-08):

| New TS module | C# owner | Contents |
|---|---|---|
| `src/general/xiv-race.ts` | `General/Enums/XivRace.cs` | `XivRace` enum values (code ↔ race), `getRaceCode`, `getXivRace(code)`. |
| `src/general/race-tree.ts` | `General/Enums/XivRace.cs · XivRaceTree` | `SKIN_RACES` set, `getSkinRace()`, and the imported static `RACE_TO_SKIN_RACE` table. |
| `src/general/reference/race-skin-table.ts` | extracted from `human.pbd` | **Generated** `RACE_TO_SKIN_RACE` map + regeneration banner (see §4). |
| `src/items/item-type.ts` | `Items/Enums/XivItemType.cs` | Minimal `XivItemType` + `systemPrefix`↔type maps needed by the filename parser. |
| `src/cache/dependency-root.ts` | `Cache/XivDependencyRoot.cs` | `XivDependencyRootInfo` shape + `isValid`, `validate`, `getBaseFileName`. |
| `src/cache/dependency-graph.ts` | `Cache/XivDependencyGraph.cs` | `extractRootInfoFilenameOnly`. |
| `src/mtrl/hair-material-root.ts` | `Materials/FileTypes/Mtrl.cs · GetHairMaterialRoot` | `getHairMaterialRoot`. |

`fixUpSkinReferences` in `src/mdl/model/model-modifiers.ts` becomes a real port of both
overloads (§2.1), wiring the above together. Its current deferred-stub doc comment is replaced.

> **Open (minor, non-blocking):** the exact `src/` directory names (`general` / `cache` /
> `items` vs. folding into existing dirs). Recommended above to mirror the C# namespaces for
> traceability; the operator may prefer a flatter layout. Does not affect behaviour.

### 3.1 Ordering / blast radius (audit Q7)

`fixUpSkinReferences` runs at `from-raw.ts:51`, **before** `computeModelLists` (`:57`), which
is correct: `computeModelLists` derives `model.materials = sortedUnique(meshGroups.map(g =>
g.material))` (`src/mdl/model/tt-model.ts:427-430`), so it must observe the *rewritten*
material strings. This matches C# ordering (`TTModel.FromRaw`: `FixUpSkinReferences` at 2722,
material-list computation later). Two mesh groups whose distinct source skin materials collapse
to the same skin-race string will dedup in the material list — faithful, because C# dedups at
the same point. **No other downstream interaction**: the rewrite only mutates `g.material`
strings; geometry, attributes, bones, and shapes are untouched.

The rewrite operates on `g.material` **verbatim** — the raw `.mdl` string-block value
(`read-model.ts` `materialList` = `r.value`). Skin materials are stored in the game-native
short form `/mt_c####b####_x.mtrl` (leading slash, no folder), which is exactly what the
`^/mt_…` anchored `SkinMaterialRegex` expects; **no path normalization is needed or wanted**
(adding one would diverge).

---

## 4. Race-tree data source — committed static table via an offline extractor

**Decision (operator, 2026-07-08): Approach A — extractor script.** `getSkinRace` needs no
dynamic game data at *runtime*: the parent edges live in `human.pbd`, a **per-patch base-game
constant**, so the ~50-entry `race → skin-race` map is a pure function of the game version and
is extracted **offline** and committed — the repo's established pattern (`INDEX_PATH_OVERRIDES`,
`src/upgrade/reference/index-path-overrides.ts`, generated by
`scripts/extract-index-overrides.ts`).

**No runtime PDB reader.** Porting `PDB.GetBoneDeformSets` would breach the port's boundary
(operate on the modpack's own bytes + committed static tables; never read base-game archives at
runtime) for no benefit — `GetSkinRace` only borrows the tree's parent edges as a side effect of
a subsystem whose real job is bone-deformation matrices (`PDB.GetDeformationMatrices`,
`PDB.cs:225`).

**Roadmap check (the one case that would flip this).** If the roadmap independently needed the
PDB (racial deformation / model-scaling using the deform matrices), porting the reader would
become shared infrastructure. It does **not**: foundation §8 rounds 4-7 are texture, metadata,
partials, and UI; none need `human.pbd`. So "just for this" holds → static table.

### 4.1 The extractor

`scripts/extract-race-tree.ts` (new), following `extract-index-overrides.ts`:
1. `extractGameFile("chara/xls/bonedeformer/human.pbd", tmp)` (`test/helpers/oracle.ts:157`,
   ConsoleTools `/extract`, yields the decompressed file).
2. Parse **only the header + tree entries** (faithful to `PDB.GetBoneDeformSets · 82-133`):
   `numSets` (int32); per set `RaceId` u16, `TreeIndex` u16, `DataOffset` u32, `Scale` f32
   (skip `RaceId == 0xFFFF`); per tree entry the 4×u16 (`ParentIndex` is all we use); bind
   `parent = set whose TreeIndex == this.TreeEntry.ParentIndex`. **We do not parse the bone
   name/matrix payload at `DataOffset`** — `GetSkinRace` never touches it. (~50 lines.)
3. Reproduce `BuildRaceTree`/`MakeNode` membership: the tree is the set of races reachable from
   `Hyur_Midlander_Male` via parent edges, `HasSkin = SkinRaces.Contains(race)` (`XivRace.cs:
   165-183`), `All_Races` excluded (`MakeNode` returns null for it, `:191-194`).
4. For every member race, compute `getSkinRace` per §2.2 and emit
   `RACE_TO_SKIN_RACE: Record<number, number>` (race code → skin-race code) to
   `src/general/reference/race-skin-table.ts` with a "GENERATED — regenerate via …" banner and
   the game-version pin.

Regeneration needs the operator's game install present — identical to the constraint
`INDEX_PATH_OVERRIDES` already lives under; the committed output is what the runtime and tests
use.

### 4.2 Why this is byte-faithful (certainty)

The extractor reproduces `getSkinRace` **by construction** from the same bytes TexTools reads —
including the exact set of races that are tree keys. Residual risk is only a parser bug, checked
two ways: (a) hand-reasoning against the known hierarchy (§4.4), and (b) the synthetic goldens
(§6) that AB-test outcomes for the races they touch against ConsoleTools. The alternative
(hand-authoring the table) was rejected: the parent edges are **not in the C# spec**, so
hand-authoring imports uncertain external knowledge, and the golden harness can only spot-check
the few race codes that appear in model paths — most of the table would stay unproven, violating
"enumerate and prove every outcome."

### 4.3 Fail-loud on off-table races (a real behavioral detail)

`GetNode` is `_Dict[race]` (`XivRace.cs:314-317`) — a C# dictionary indexer that **throws
`KeyNotFoundException`** on a race not in the tree. The `if (node == null)` guard in
`GetSkinRace` (`:356-359`) is therefore effectively dead (a missing key throws; it never returns
null, and `_Dict` never stores null). So a race code that is not a tree member makes C#
**throw**, not fall back. Our port reproduces this: `getSkinRace(code)` throws (fail loud) when
`code` is absent from `RACE_TO_SKIN_RACE`. This also covers `baseRace == All_Races` (0) from an
unresolvable path code (`GetXivRace` returns `All_Races`, which is never a tree key → throw).
Knowing the exact membership set is another reason the extractor (not hand-authoring) is
required.

### 4.4 Expected outcomes (playable races) — extractor is authoritative

For self-checking the extractor. The 16 `SkinRaces` return themselves except the Roe-F special
case. Playable derivations (high confidence from the known hierarchy; NPC codes are
extractor-confirmed and omitted here):

| Race (code) | `getSkinRace` → code | Why |
|---|---|---|
| Midlander M/F (0101/0201) | 0101 / 0201 | HasSkin |
| Highlander M/F (0301/0401) | 0301 / 0401 | HasSkin |
| Elezen M/F (0501/0601) | 0101 / 0201 | no skin → Midlander |
| Miqote M/F (0701/0801) | 0101 / 0201 | no skin → Midlander |
| Roegadyn M (0901) | 0901 | HasSkin |
| **Roegadyn F (1001)** | **0401** | **special case → Highlander F** (`XivRace.cs:363-366`) |
| Lalafell M (1101) | 1101 | HasSkin |
| Lalafell F (1201) | 1101 | no skin → Lalafell M |
| AuRa M/F (1301/1401) | 1301 / 1401 | HasSkin |
| Hrothgar M/F (1501/1601) | 1501 / 1601 | HasSkin |
| Viera M/F (1701/1801) | 1701 / 1801 | HasSkin |

---

## 5. Corpus reality — hair *is* exercised; skin is not (audit Q6, operator follow-up)

A scan of the local corpus manifests (2026-07-08) found:

- **Hair models flow through the fixup path today.** Both hair packs are legacy TTMP
  (`major < 2` → `needsMdlFix` true, `src/upgrade/model.ts:19-27`), so their hair models are
  rebuilt through `fromRaw` → `fixUpSkinReferences`:
  - `Misty_Hairstyle_Female.ttmp2` (`TTMPVersion 1.3w`): hairstyle **h0170 across 9 races**
    (c0201/0401/0601/0801/1001/1101/1201/1401 + c1801 h0001) — an ideal `getHairMaterialRoot`
    share-collapse exerciser (e.g. c0401h0170 → c0201h0170).
  - `Eliza.ttmp2` (`TTMPVersion 1.0s`): c0201 h0132, c1801 h0003.
- **But there are currently zero hair `.mdl` diffs in any ratchet baseline**, and the roadmap
  reports all rebuilt corpus models byte-exact — *with the fixup no-op'd*. So on today's corpus
  C#'s `hairFix` is itself producing byte-identical output (these mods' hair models already
  reference the canonical/shared material path, so the `Replace` finds nothing to change).
- **Consequences:** (a) porting `hairFix` will **not regress** these packs, and they positively
  AB-test the "hairFix runs but is a no-op" branch against the golden; (b) the corpus does **not**
  prove a `hairFix` rewrite that *changes* bytes, and (single-race) never proves the cross-race
  **skin** rewrite. Those two branches need synthetics (§6).

> **Implementation-time verification (do first, not inferred):** decode one Misty hair model's
> material references and confirm C#'s `hairFix` is genuinely a no-op there — i.e. the material
> already points at the shared root. If instead it *would* rewrite, that is a live latent
> divergence and the golden/baseline should already reflect it; reconcile before proceeding.

### 5.1 Wider mod-collection scan (938 packs, `C:\Users\user\Documents\XIVModOriginals`, 2026-07-09)

A manifest scan of a 938-pack personal collection (480 `.pmp`, 458 `.ttmp2`) sharpens both branches:

- **Cross-race skin — no actionable exerciser exists.** Only **2** packs ship a *body model at a
  non-self-skin race* (`Slime Skin.pmp`, `Yet Another Body+.pmp`, both Elezen-F/Miqote-F/Roe-F
  `b0002` skins) and **both are PMP** → never rebuilt by `/upgrade` (`needsMdlFix` false for PMP,
  `src/upgrade/model.ts:19-27`). **Zero legacy-`.ttmp2` cross-race skin models** in 938 packs.
  → the **synthetic cross-race skin pack is mandatory**; those two PMPs are the only real
  cross-race skin *content* and could seed it (repacked legacy) or serve as a shape reference.
- **Hair — abundant candidates, but redundant and not small; add none.** **95 legacy-`.ttmp2`
  packs** ship hair models at races `getHairMaterialRoot` would collapse. But (a) **not one** of the
  938 ships an *own-race* hair material alongside the collapsing model, strongly implying they
  already reference the shared/collapsed material → `hairFix` no-op like Misty (manifests can't see
  the model's internal material ref, so this is strong evidence, not proof); (b) the existing corpus
  (Misty) **already covers both collapse directions**; and (c) every candidate is 10-600+ MB of
  texture bulk. So they add no coverage the corpus lacks, at real weight → **we add none** (§6,
  fixture 1). The hairFix **rewrite** branch still needs a synthetic (§6, fixture 3).

---

## 6. Test plan

Per AGENTS.md, prefer real/synthetic goldens (AB-test TexTools, pin exact bytes) over unit tests;
use unit tests for paths no golden reaches.

**Goldens (byte-parity via the `/upgrade` harness):**
1. **Real corpus (hair "runs" branch) — no new fixtures.** `Misty_Hairstyle_Female` + `Eliza`
   already exercise the `hairFix` path and, between them, **both `getHairMaterialRoot` collapse
   directions** (Misty's `c1101h0170 → c0101` male + `c0401h0170 → c0201` female). After porting,
   their `.mdl` output must stay byte-exact vs the golden (no regression; positive coverage of the
   hairFix-runs / no-op branch). **We deliberately add no real hair packs** — the §5.1 candidates
   are redundant with this coverage *and* not small (every legacy hair-collapse pack is 10-600+ MB
   of texture bulk; the smallest covering both directions is ~79 MB). `getHairMaterialRoot`'s other
   branch ranges are covered by unit tests (fixture 5), not the golden.
2. **Synthetic cross-race skin pack** — *spec now, build during implementation* (operator,
   2026-07-08). A committed builder under `scripts/generate-synthetics/` produces a **legacy
   TTMP (`major < 2`)** pack containing a model whose path race resolves to a *different* skin
   race than the skin material it references — e.g. an Elezen model
   (`chara/human/c0601/.../c0601…mdl`) with a skin material `/mt_c0601b####_a.mtrl`. Expected
   golden: race rewritten to `c0201` and body reset to `b0001` (`getSkinRace(Elezen_F)=201`).
   This exercises the skin rewrite branch the single-race corpus never reaches.
3. **Synthetic hair-rewrite pack** — *spec now, build during implementation*. A legacy-TTMP hair
   model that references its **own-race** hair material (e.g. c0401h0170 model → material
   `/mt_c0401h0170_hir_a.mtrl`) so `hairFix` actually rewrites it (→ `c0201h0170`), exercising
   the hairFix rewrite branch (the corpus only covers the no-op branch).

Both synthetic builders are committed; the built `.pmp`/`.ttmp2` is gitignored like the rest of
the corpus (a fresh clone regenerates via the builder). Fixture shapes are defined here; the
exact bytes are pinned by the golden on first run.

**Unit tests (paths a golden can't fully enumerate):**
4. `getSkinRace` — **every** tree-member race → skin-race outcome (the full §4.4 table incl. NPC
   codes), the Roegadyn_Female special case, and the **off-table throw** (§4.3). Fixtures derive
   from the committed extracted table (the extractor is the oracle).
5. `getHairMaterialRoot` — every branch (`Mtrl.cs:1429-1485`): non-hair-root throw, Hrothgar
   pass-through, `<101` unique, the 101-115 band incl. the Miqo/Hroth exceptions, the 116-200
   Midlander collapse (both `isFemale` parities), `>=201` unique.
6. `extractRootInfoFilenameOnly` / `getBaseFileName` — the hair-root path parse and its inverse
   for representative hair filenames (e.g. `c1401h0170_hir` → `{human,1401,hair,170,"hir"}` →
   base `c1401h0170`).

**A found divergence is a coverage gap too:** if the §5 verification shows the corpus hair
models *would* rewrite, add the reproducing case as a real or synthetic golden before the fix.

---

## 7. Scope boundaries / non-goals

- **Not ported:** the `FixUpSkinReferences(string, List<string>)` overload (`:2400`); the
  `bodyReplacement != ""` live branch (`:2386-2389`) — dead on our path, documented only; the
  PDB bone-name/matrix payload and `GetDeformationMatrices`; anything in
  `XivDependencyRoot`/`XivDependencyGraph`/`XivItemType`/`Mtrl` beyond the minimal members §2.3
  names.
- **HairMaterialRegex** (`ModelModifiers.cs:2299`) is defined in C# but **unused** by the
  overloads on our path (the hair block keys off `hairFix`, not that regex). Not ported.
- **Runtime game-data access** remains out of bounds — the only game-data touch is the *offline*
  extractor (§4.1).

---

## 8. Open decisions for the operator

1. **Module directory names** (§3) — mirror C# namespaces (`src/general`, `src/cache`,
   `src/items`) as recommended, or a flatter layout? Behaviour-neutral.
2. **Implementation-time verification** (§5) — confirm the corpus hair models are genuinely a
   `hairFix` no-op *before* wiring, so we know whether we are closing a latent divergence or
   preserving byte-exactness. Flagged as the first implementation step, not a design blocker.

Everything else (full port incl. hairFix; static table via extractor; synthetics spec'd-now
built-later) is decided per operator sign-off 2026-07-08.
