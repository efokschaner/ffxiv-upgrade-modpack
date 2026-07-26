# Synthetic `/upgrade` goldens for the `ValidateTexFileData` load-seam port

Filed: 2026-07-25 · Status: open · Deferred out of
[`docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md`](../superpowers/specs/2026-07-25-validate-tex-load-seam-design.md)
(§6)

That design ported `validateTexFileData` (`src/upgrade/validate-tex.ts`) — TexTools'
`EndwalkerUpgrade.ValidateTexFileData` (`EndwalkerUpgrade.cs:2100-2129`) load-time `.tex` fixup — with
its two branches guarded by unit tests and (for Branch B) 30+ real corpus packs, but **neither branch
has a dedicated synthetic `/upgrade` golden run through the real ConsoleTools oracle**, only real-pack
coverage (Branch B) or hand-computed unit-test expectations (Branch A). The design's §6.1/§6.2 called
for two synthetic modpacks; this item is that deferred work.

## What's needed

An **old-version** TTMP (`TTMPVersion` major < 2, or exactly `"2.0"` — `ttmpNeedsTexFix`/
`DoesModpackNeedFix`, `TTMP.cs:916-930`) carrying:

1. **Branch A — an A8R8G8B8 NPOT-with-mips `.tex`** (e.g. 400×400 or the design's 96×192, ≥2 mips).
   Expected: a byte-exact `/upgrade` golden, proving the resize wiring and the width-for-both-dims bug
   (`docs/TEXTOOLS_BUGS.md` #20) against the real oracle, not just the hand-computed unit test.
2. **Branch B — a POT `.tex` with deliberately broken mip offsets** (and/or trailing null padding).
   Expected: a byte-exact `/upgrade` golden pinning the offset-table repair
   (`docs/TEXTOOLS_BUGS.md` #21's struct-copy `MipCount` quirk included) independent of the two real
   packs that currently force it (`Bloodlust - Bibo+.ttmp2`, `chained_collars_v1_1_0.ttmp2` — see
   `docs/backlog/2026-07-10-fixoldtexdata-load-round.md`).

## Why deferred rather than built now

Both branches are already guarded, just not by a synthetic-pack golden specifically:

- **Branch A (A8R8G8B8 resize):** `test/upgrade/validate-tex.test.ts`'s unit tests pin the resize math
  and the width-for-both-dims bug directly; `resizeBicubic`'s own ImageSharp-derived goldens
  (`test/tex/imagesharp/*`) separately guard the resampler; and the byte-identical `npot-mask-a8`
  corpus pack (`test/corpus/synthetic/npot-mask-a8.ttmp2`, material-round path, not this load seam)
  proves the same `resizeForMerge` primitive is byte-exact on a lossless source. The load-seam call
  site is new wiring, not new math, so the marginal coverage a golden adds here is real but not urgent.
- **Branch B (mip-offset fixup):** already corpus-forced and byte-exact across 30+ real packs, plus
  `test/tex/tex-header.test.ts` unit-pins `fixUpBrokenMipOffsets` (including the struct-copy quirk)
  directly against hand-built headers derived from the C#.
- **The BC-source case (Branch A on a non-A8R8G8B8 source)** already has its own real-pack golden and
  `DIVERGENCE_RULES` confirmation — `KK_Sportcar_Final_Hotfix_V1.1.1.ttmp2`
  (`docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md`) — so it does not need a synthetic either.

## What building them needs

`scripts/generate-synthetics/ttmp2-builder.ts` hardcodes `TTMPVersion: "2.1w"` (both
`writeTtmp2Pack` and `writeTtmp2Files`) with no parameter to emit an old version, and the builder's
`.tex` payload path has no Type-4 (compressed-texture) writer — every existing synthetic ships `.tex`
content some other way. Building these two packs needs: (a) an old-`TTMPVersion` parameter threaded
through the builder (or a one-off variant), and (b) a Type-4 tex-payload encoder for the builder to
call, reusing `encodeUncompressedTex`/`buildCanonicalTexHeader` (`src/tex/header.ts`,
`src/tex/tex.ts`) for the fixture content and the existing SqPack Type-4 writer
(`src/sqpack/type4.ts`) for the compressed wrapper.

## Note for whoever picks this up

`test/helpers/upgrade-compare.ts`'s `confirmBcResizedAsA8` rule comment (the `KK_Sportcar`
`DIVERGENCE_RULES` entry) says "a dedicated NPOT-with-mips A8R8G8B8 synthetic golden is planned,
design spec §6.2" — **this item is that plan.** Closing this item should also update that comment to
point at the synthetic instead of describing it as planned.
