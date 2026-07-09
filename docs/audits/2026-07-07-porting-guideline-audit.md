# Porting-guideline adherence audit — 2026-07-07

Audit of `src/` against the AGENTS.md porting guidelines: **P**rovenance (`file · symbol ·
lines` citations), **B** split-don't-blend, **L** fail-loud, **I** no invented behaviour /
reproduce quirks, **C** conventions.

**Method.** Seven parallel domain auditors over disjoint file sets (no file audited twice),
each applying one shared rubric and confirming provenance against the vendored C# in
`reference/`; then two central follow-ups — a reachability/ratchet-masking sweep and a
resolution pass for the SUSPECTED findings — so a suspicion was chased once, not per-domain.
Read-only; all C# claims verified against `reference/`. 59 `src` files, all covered.

## Executive summary

The port is in good shape: the large majority of files were verified byte-faithful to a
cited C# symbol, most fail-loud guards and reproduced quirks are correct and annotated, and
there are **no un-cited invented features** — every divergence traces to a deliberate,
documented choice. Findings cluster into one headline process gap plus five code themes.

- **29 actionable findings** (of 31 raised; 1 refuted, 1 downgraded-benign).
- **Only one is wrong output today** — F1 — and it is an instance of the process gap below.
  Every other HIGH is a CONFIRMED divergence on a code path the current 47-pack corpus does
  not reach (LATENT): a fragile fail-loud gap, not a live corruption.

## ★ Headline (process) — the modpack-serialization layer is unverified against the oracle

The golden harness proves **game-file content parity** but never checks **archive structure
or the manifest**, and never runs our writers on the oracle path.

**What the golden check actually does.** `registerUpgradeCheck` computes
`ours = upgradeModpack(loadModpack(...))` — an in-memory `ModpackData` **model**, never
re-serialized to an archive (`test/helpers/corpus-upgrade.ts:26`). `diffUpgrade` then compares
`ours` against the parsed golden via `byGamePath(allFiles(d))` — the game-file payloads
grouped by in-game `gamePath` (`test/helpers/upgrade-diff.ts:29-52`), where
`allFiles(d) = groups.flatMap(g => g.options.flatMap(o => o.files))`
(`src/model/modpack.ts:86-88`). It is deliberate: "Comparison is decompressed-by-gamePath, so
the container format is not load-bearing anyway" (`test/helpers/upgrade-golden.ts:36`).

**Consequences — all pass silently today:**

1. **Wrong top-level file *names*** — e.g. F1's `group_002_WEAREABLE_EARS_OPTIONS.json` vs the
   golden's `group_002_weareable ears options.json`. Same payloads → passes.
2. **Wrong top-level file *count / inventory*** — a dropped, added, renamed, merged, or split
   `group_*.json` is invisible as long as the *union* of game files is unchanged.
3. **Wrong manifest *bytes*** — `meta.json` fields, group/option metadata (names, `page`,
   `priority`, `selectionType`, `defaultSettings`, descriptions), `TTMPVersion` — none compared.
4. **Wrong group/option *assignment*** — the `flatMap` collapses groups/options before keying
   by `gamePath`, so a file placed in the *wrong option* of a wizard pack still matches, even
   though it changes which files apply when a user selects that option.
5. **The writers never execute on the golden path** — `writePmp`, `writeTtmp2`, `safeName`,
   manifest emission. They are covered only by separate write round-trip / fixture tests
   (self-consistency), never against the ConsoleTools oracle.

**The correct invariant.** Un-archive **both** outputs into `{ archive-relative-path →
decompressed bytes }` and diff the full maps — game files *and* `meta.json` /
`default_mod.json` / `group_*.json` / `TTMPL.mpl` — byte-identical modulo named divergence
rules. "Bytes" is measured at the **decompressed, per-member** level: the container layer
(zip framing/timestamps/member order; `.mpd` blob concatenation offsets; the deflate/SqPack
*compressed* stream, which depends on fflate vs .NET `DeflateStream`) differs for genuinely
semantic-equivalent reasons and is the legitimate documented-divergence carve-out — today it
is merely *sidestepped* by decompressing, not *confirmed equivalent*.

**Cost this surfaces (be honest about it).** Byte-identical manifest JSON means reproducing
TexTools/Penumbra's JSON serializer exactly (property order, indentation, escaping, number
formatting, trailing newline). The `raw` opaque carry-through (`src/model/modpack.ts:36,49,62`)
is necessary but **not sufficient**: the golden is TexTools' *output*, which re-serialized
every field through its own writer — so parity requires matching *its* formatting, not
preserving the input's bytes. This is a sub-project-sized task the harness has deferred by
never comparing the layer, and it likely warrants its own spec in `docs/superpowers/specs/`.

**Recommendation.** (a) Serialize `ours` through the real writers and extend `diffUpgrade` to
un-archive both sides and diff the full per-member byte maps, reusing the ratchet +
`DIVERGENCE_RULES` (add container-layer rules for compressed-blob equivalence). (b) Until that
parity exists, keep the writers fail-loud where they know they diverge, and document that the
manifest layer is unverified rather than implying parity the harness does not test.
**F1 below is the first concrete instance.**

---

## Theme A — Fail-loud gaps (throw, don't best-effort)  [L / I]

Not-yet-ported / edge paths emit best-effort output on an unreproduced path instead of
throwing. **All latent today** per the reachability sweep — but each is a live trap that can
silently corrupt a future mod and slip past the ratchet.

| ID | Location | Silent behaviour vs C# | Sev | Reachability |
|----|----------|------------------------|-----|--------------|
| 5-2 | `mdl/model/serialize.ts:64-115` | mesh-type order ≠ `EMeshType` ordinal for mixed models (Fog<Shadow) | HIGH | latent (all-Standard corpus) |
| T1 | `tex/encode.ts:16` | NPOT resize point-samples vs C# Bicubic (`TextureHelpers.cs:394`) | HIGH | latent (only unit tests; `textureRound` is a stub) |
| U1 | `upgrade/material.ts:212` | `?.` tolerates null sampler where C# NREs→abandons material untouched (EndwalkerUpgrade.cs:1028) | HIGH | latent — CONFIRMED structurally producible |
| 4-1 | `mdl/geometry/offsets.ts:49` | LoD meshCount omits extra meshes → mispartition | HIGH→**MED** | latent + already guarded downstream by `serialize.ts:98` throw |
| U4 | `upgrade/upgrade.ts:164` | `textureRound`/partials consume targets, emit nothing | LOW | live but documented WIP — source of the 705 baselined tex diffs |
| F6 | `sqpack/blocks.ts:48` | `readBlock` drops C#'s "real data in padding" throw (Dat.cs:2400) | LOW | latent (malformed input only) |
| M3 | `mtrl/shader.ts:39` | returns `Other` for Bg/Reflection/Decal | — | **DOWNGRADED**: unreachable in pipeline; C# also returns `Other` (faithful). Scope comment only. |

**Recommendation.** Convert each latent best-effort to a `throw "<case> not yet ported"`
(U1 = drop the `?.`; 5-2 / 4-1 = throw on the unhandled model shape; T1 = throw on NPOT until
Bicubic ported; F6 = thread block position and reproduce the throw). For U4, throw when
`upgradeTargets.length > 0` while the round is stubbed, so the missing-texture surface fails
loud instead of silently shrinking the pack (currently absorbed by 705 ratchet entries).

## Theme B — "Split, don't blend" drift in `mdl/model/`  [B]

Behaviour is faithful and (mostly) cited; the issue is **placement** — TTModel/ShapeData
members implemented outside their C# owner. All five are one subsystem, one refactor.

| ID | Location | Belongs to |
|----|----------|-----------|
| 5-1 | `serialize.ts:73` `meshTypeCounts` | `TTModel.GetMeshTypeOffset/Count` (TTModel.cs:903-947) |
| 5-3 | `serialize.ts:390` attribute bitmask | `TTModel.GetAttributeBitmask` (TTModel.cs:1437-1462) |
| 5-4 | `serialize.ts:325` material index | `TTModel.GetMaterialIndex` (TTModel.cs:1419-1430) — also uncited |
| 6-3 | `model-modifiers.ts:506` `computeModelLists` | `TTModel` Materials/Attributes/Bones (TTModel.cs:845-900) |
| 6-2 | `model-modifiers.ts:356` `resolveShapeLod0Parts` | `ShapeData.AssignMeshAndLodNumbers` (ShapeData.cs:52-91) |

**Recommendation.** Hoist these to `tt-model.ts` (and a ShapeData-owned module for 6-2),
leaving glue at the call sites. AGENTS.md names this exact anti-pattern.

## Theme C — Missing / vague provenance citations  [P]

Business logic without a resolvable `file · symbol · lines`. Traceability drift, low
byte-risk — a documentation sweep.

| ID | Location | Gap |
|----|----------|-----|
| F4a | `container/pmp.ts:49,139` | readPmp/writePmp/optionFromJson/optionToJson uncited (→ PMP.cs) |
| F4b | `container/ttmp2.ts:33,148` | readTtmp2/writeTtmp2/buildBlob uncited (→ TTMP.cs) |
| F4c | `container/ttmp-legacy.ts:12` | readLegacyTtmp uncited (→ TTMP.cs `GetLegacyModpackMpl`) |
| U2 | `upgrade/reference/{glass,hair}-shader-params.ts:1` | cite generator script, not C# symbol / sample material (→ EndwalkerUpgrade.cs:774-788 / :1127-1131) |
| 4-2 | `mdl/header.ts:3` | bare "(Mdl.cs)"; fields @4/@8/@64/@65 not read by `GetXivMdl` — need real source |
| F2 | `sqpack/type4.ts:56` | cites DDS.cs:1079-1080 (nonexistent); correct is `CompressDDSBody` DDS.cs:412-419 |
| T2 | `tex/types.ts:60` | helpers cite file only, not `GetBitsPerPixel`/`GetMipMinDimension` (XivTexFormat.cs:94/99) |
| 4-4 | `mdl/serialize.ts:8` | cites design spec only; add "inverse of parseMdl, order per GetXivMdl" |

## Theme D — Deliberately "fixing" C# quirks  [I]

The sharpest guideline conflict: the port *corrects* C# bugs, which by definition diverges
from the golden ("reproduce quirks faithfully; a fix diverges").

| ID | Location | The "fix" | Sev |
|----|----------|-----------|-----|
| M1 | `mtrl/types.ts:5` + `serialize.ts` | lowercase `EMPTY_SAMPLER_PREFIX` makes TS *exclude* empty-sampler placeholders on write; C# (uppercase const vs already-lowercased path) fails to exclude → TS diverges | HIGH latent |
| M2 | `mtrl/types.ts:92` | `getRealSamplerCount` skips placeholders C# (XivMtrl.cs:271) counts — self-admitted "guard" | MED latent |
| 6-5 | `mdl/model/tt-model.ts:92` | `hasWeights` uses per-vertex `weights>0`; C# `HasWeights` (TTModel.cs:1251-1264) uses `Bones.Count>0` — different predicate, plus missing citation | MED |

**Recommendation.** Reproduce the C# behaviour faithfully (accept the quirk, annotated) or
`throw` until pinned by a synthetic modpack; correct M1's misleading "internal-only" comment.
For 6-5, match the bones-count predicate (or document equivalence) and add the citation.

## Theme E — Conventions  [C]

Per-file `(GPL-3.0)` license markers — banned (licensing lives only in top-level
LICENSE/NOTICE). **11 files** carry one, all in the `mdl` subsystem, each appended as a
parenthetical to a provenance comment rather than as a standalone SPDX header:

- `mdl/types.ts:3`
- `mdl/geometry/`: `declaration.ts:2`, `decode.ts:1`, `encode.ts:2`, `format.ts:1`,
  `vertex-data.ts:3`, `offsets.ts:3`
- `mdl/model/`: `tt-model.ts:5` (the original finding 6-4), `serialize.ts:1`,
  `bone-sets.ts:2`, `bounding-box.ts:3`

Fix: strip the `(GPL-3.0)` token, keep the provenance. **Not** a violation:
`tex/bc7.ts:2`'s `Copyright (c) 2020-2021 Richard Geldreich, Jr. (MIT / Unlicense) —
see NOTICE` — the conventions explicitly allow a brief upstream-origin attribution for
ported third-party code.

No SPDX headers; no `Copyright` lines beyond bc7.ts's allowed attribution; no evidence
of edits into `reference/`.

> **Audit correction (2026-07-08).** The original run recorded this as a single finding
> (6-4, `tt-model.ts` only); the mdl-core and mdl-model-a domains explicitly reported
> "no convention violations." That was an under-count — 10 further files carry the same
> marker. How it slipped, honestly: **(1)** the rubric primed auditors to look for a
> *standalone SPDX/license header*, so an inline `(GPL-3.0)` tacked onto the end of a
> provenance line didn't read as one; **(2)** within mdl-core / mdl-model-a the marker is
> *uniform*, so nothing looked anomalous — mdl-model-b caught it only because its two
> files disagree (`tt-model.ts` has it, `model-modifiers.ts` doesn't) and that contrast
> made it pop; **(3)** file-scoped partitioning (the dedup mechanism) means no single
> auditor saw the repo-wide spread, and consolidation trusted each domain's "clean"
> verdict instead of running one repo-wide `grep`. Lesson: back low-severity *mechanical*
> checks (license markers, SPDX, banned tokens) with a grep in consolidation rather than
> relying on per-domain reading — folded into `docs/audits/README.md`.

---

## Resolution log (post-audit remediation)

> **Status 2026-07-08.** All actionable code themes are resolved or explicitly deferred to
> `BACKLOG.md`. Full gate green (`npm run check`, `npm run typecheck`, `npm test` = 776 passing).
> Remaining open items are the two `BACKLOG.md` reproductions that need a synthetic modpack to pin
> golden bytes (U4 texture round; M1/M2 empty-sampler placeholder) plus the prioritized unported
> `/upgrade` rounds. Themes below in order: Headline, F1, C, E, A, D, B.

- **Headline** (serialization/manifest parity) — **RESOLVED** (PR #15): harness now serializes
  `ours` through the real writers and diffs archive structure + manifest via `diffArchives`.
- **F1** (`safeName`/`MakePMPPathSafe`) — **RESOLVED** (PR #15): PMP group filenames lowercased
  to match TexTools; ported + cited at `container/pmp.ts`.
- **Theme C** (provenance citations) — **RESOLVED 2026-07-08**: F4a/b/c (container-file headers
  cite PMP.cs LoadPMP/WritePmp/CreateSimplePmp + TTMP.cs GetModpackList/UnzipTtmp/CreateWizard-
  /CreateSimpleModPack/GetLegacyModpackMpl), U2 (shader-param generator + emitted files cite
  EndwalkerUpgrade.cs:774-788 / :1127-1131 + sample materials), 4-2 (`header.ts` cites the real
  read/write header sources, GetXivMdl:355/363 + MakeUncompressedMdlFile:3914-3961), F2
  (`type4.ts` corrected to DDS.cs:412-419 = `CompressDDSBody`), T2 (`tex/types.ts` cites
  XivTexFormat.cs IsCompressedFormat:78 / GetBitsPerPixel:99 / GetMipMinDimension:94), 4-4
  (`mdl/serialize.ts` notes inverse-of-parseMdl / GetXivMdl order).
- **Theme E** (banned `(GPL-3.0)` markers) — **RESOLVED 2026-07-08**: token stripped from all 11
  files (provenance retained); `grep GPL-3.0 src/` now empty.
- **Theme A** (fail-loud gaps) — **RESOLVED / DEFERRED 2026-07-08**:
  - **5-2** RESOLVED: `makeUncompressedMdl` now throws on models mixing Shadow+Fog meshes (the
    only present-type combination where our 4-bucket order flips vs EMeshType). Synthetic unit
    test in `test/mdl/model/serialize.test.ts`.
  - **T1** RESOLVED: `resizeToPowerOfTwo` throws on a genuine NPOT resize (Bicubic not ported)
    instead of point-sampling. Test updated in `test/tex/tex-encode.test.ts`.
  - **U1** RESOLVED: spec/diffuse scan (`upgrade/material.ts`) now dereferences the sampler
    unguarded, reproducing C#'s NRE→material-abandoned (the mask lookups stay guarded, matching
    C#'s `x.Sampler != null` asymmetry at :975/:1011 vs :1028-1029). Test in `material.test.ts`.
  - **F6** RESOLVED as a **documented gap** (`sqpack/blocks.ts` comment + BACKLOG.md): C#'s
    padding throw is gated on whole-`.dat` context our single-file reader lacks; a partial port
    would risk over-throwing (a new divergence), so it is documented rather than ported.
  - **4-1** NO ACTION: already guarded downstream (`serialize.ts` `HAS_EXTRA_MESHES` throw);
    audit itself downgraded HIGH→MED.
  - **U4** DEFERRED to `BACKLOG.md` (unprioritized): throwing today converts the 705 baselined
    `.tex` diffs into hard crashes; revisit when the texture round lands.
  - **6-1** WITHDRAWN as a **non-issue** (2026-07-09). The finding assumed C#'s
    `FixUpSkinReferences` rewrites material strings in `/upgrade`; it does not. `FixOldModel`
    (`EndwalkerUpgrade.cs:194`) builds the model via `Mdl.GetXivMdl(uncomp)` with no path, and
    `GetXivMdl(byte[], string mdlPath = "")` (`Mdl.cs:349`) defaults `MdlPath` to `""`, so
    `FromRaw` calls `FixUpSkinReferences(ttModel, "")` whose path regex never matches — the fixup
    is inert throughout `/upgrade`. Our no-op therefore matches the golden byte-for-byte; there is
    no divergence. A full faithful port (GetSkinRace + rewrite + hairFix) was built and reverted
    once this was confirmed (git history, branch `feat/skin-reference-fixup`). The `model-modifiers.ts`
    stub carries the explanation.
- **Theme D** (quirk "fixes") — **RESOLVED 2026-07-08**:
  - **6-5** RESOLVED: `hasWeights` (`tt-model.ts`) now ports `TTModel.HasWeights` (TTModel.cs:
    1251-1264) as `MeshGroups.Any(Bones.Count > 0)` with citation, replacing the per-vertex weight
    scan. `build-declarations.test.ts` fixture updated to carry a mesh-group bone list.
  - **M1 / M2** RESOLVED (throw-until-pinned): `serializeMtrl` now fails loud on any empty-sampler
    placeholder (C#'s `ToLower()` at Mtrl.cs:560 defeats its uppercase `StartsWith(EmptySamplerPrefix)`
    checks, so C# *writes* placeholders as ordinary textures — our old exclude+index-255 path was the
    opposite). `getRealSamplerCount` de-special-cased to match C# (M2). Misleading M1 comment
    corrected. The two tests that pinned the divergent output now assert the throw / the C#-faithful
    count; byte-exact reproduction filed in `BACKLOG.md` (needs a synthetic modpack — C#'s placeholder
    path is the lowercased ESamplerId name, not our numeric raw id).
- **Theme B** (split-don't-blend placement) — **RESOLVED 2026-07-08**: five TTModel/ShapeData members
  hoisted to their C# owners, behaviour-preserving. `meshTypeCounts` (5-1), `getMaterialIndex` (5-4),
  and `getAttributeBitmask` (5-3, guard folded inside per TTModel.cs:1440-1443) moved from
  `serialize.ts` to `tt-model.ts`; `computeModelLists` (6-3) moved from `model-modifiers.ts` to
  `tt-model.ts` (with its private `sortedUnique`; `compareStrings` centralized in `tt-model.ts`);
  `resolveShapeLod0Parts` (6-2) moved to a new ShapeData-owned module `src/mdl/model/shape-data.ts`
  (ShapeData.cs:52-91). Each carries its `file · symbol · lines` citation. Glue left at call sites.

## Resolved during follow-up (no action / recategorized)

- **F5** (`ttmp2.ts:163` TTMPVersion) — **REFUTED.** Hardcoded `"2.1s"/"2.1w"` is exactly what
  TexTools stamps (`TTMPWriter.cs:59-65` = `"2.1"` + typeCode); ignoring `sourceTtmpVersion`
  is correct.
- **M3** — **DOWNGRADED** to a scope comment (unreachable + C# also returns `Other`).
- **4-3** (`parse.ts:20` trusts header sizes) — LOW/SUSPECTED, mitigated by the overrun gate
  and absolute-offset decode; assert-and-throw the invariant if tightening.

## Verified clean (not merely "not looked at")

Confirmed byte-faithful to cited C#, by domain: **tex** (bc7 full-table port, decode
unpackers, header, mip walk — the BC5/BC7 divergences are the documented golden-corroborated
ones); **mtrl** (parse/serialize/colorset/dye, all 15 `ESamplerId` CRCs,
`getDefaultColorsetRow`); **mdl-core** (model-data, geometry decode/encode incl. the
reproduced+annotated Mdl.cs:4147 typo, declaration, format); **mdl-model** (read-model,
from-raw, build-declarations, bone-sets, bounding-box, and all TTModel/ModelModifiers
citations resolve); **upgrade** (colorset-upgrade half-for-half, material shader-key rewrites
with verified CRCs, model normalizer); **io** (sqpack type2/3/4 + blocks, `ReadSqPackFile`).
Scaffolding correctly left uncited: barrels (`mtrl.ts`, `tex.ts`, `mdl.ts`, `index.ts`),
type-only modules, `float16`/`binary` primitives, thin glue.

## Reachability (why the HIGHs are latent, not live)

The 47-pack corpus (43 TTMP, 4 PMP) with cached goldens and ratchet baselines was swept:
no baseline contains any `.mtrl` mismatch (→ M1/M2 placeholder path unreached) or any TTMP
`.mdl` mismatch (→ 5-2 mixed-mesh path unreached); `makeUncompressedMdl` **throws** on
`HAS_EXTRA_MESHES` uncaught (→ 4-1 fails loud downstream); `resizeToPowerOfTwo` has no
production caller at all (only re-exported + unit-tested), and `upgradeModpack` never resizes
(→ T1 latent). The 705 tex
baseline entries are the unimplemented texture round (U4), not T1. **None are LIVE-MASKED.**
F1 is the sole live divergence, and it is invisible because of the headline process gap.

## Coverage map (domain → files; all 59 covered)

1. **io** — `container/{detect,manifest-types,pmp,ttmp-legacy,ttmp2}`, `sqpack/{blocks,sqpack,type2,type3,type4}`, `zip/zip`, `util/{binary,float16}`
2. **tex** — `tex/{bc7,decode,encode,header,parse,serialize,tex,types}`
3. **mtrl** — `mtrl/{colorset,dye,mtrl,parse,serialize,shader,types}`
4. **mdl-core** — `mdl/{header,mdl,model-data,parse,serialize,types}`, `mdl/geometry/{declaration,decode,encode,format,offsets,vertex-data}`
5. **mdl-model-a** — `mdl/model/{read-model,serialize,from-raw,build-declarations,bone-sets,bounding-box}`
6. **mdl-model-b** — `mdl/model/{tt-model,model-modifiers}`
7. **upgrade** — `upgrade/**`, `upgrade/reference/**`, `model/modpack.ts`, `index.ts`

## Suggested priority order

1. **Headline serialization/manifest parity** — serialize `ours` and compare full un-archived
   byte maps; likely its own spec. Closes the blind spot that hides F1 and a whole class of
   manifest/structure regressions.
2. **F1** — fix `safeName` to mirror `MakePMPPathSafe` (the first concrete instance of #1).
3. **Theme A throws** — cheap, high-value fail-loud hardening; U1 is a one-line `?.` removal.
4. **6-5 predicate** — real fidelity gap, small fix.
5. **Theme B refactor** — one focused "hoist TTModel members to `tt-model.ts`" pass.
6. **Themes C / D / E** — citation / quirk / convention sweep; mechanical.
