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
| 6-1 | `mdl/model/model-modifiers.ts:489` | `fixUpSkinReferences` no-ops; C# rewrites serialized material strings (ModelModifiers.cs:2309/2347) | HIGH | latent |
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

| ID | Location | Issue |
|----|----------|-------|
| 6-4 | `mdl/model/tt-model.ts:5` | `(GPL-3.0)` license marker in a per-file header — banned (licensing lives in LICENSE/NOTICE); also inconsistent with `model-modifiers.ts`. Drop it, keep the provenance. |

No SPDX/copyright headers elsewhere; no evidence of edits into `reference/`.

---

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
`HAS_EXTRA_MESHES` uncaught (→ 4-1 fails loud downstream); `resizeToPowerOfTwo` is only
reachable from `encodeTex`, which `upgradeModpack` never calls (→ T1 latent). The 705 tex
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
