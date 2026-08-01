# T2 — full `FixOldTexData` load-time round (only the unconditional recompress remains unported)

Filed: 2026-07-10 · Status: open, narrowed 2026-07-25 · Needs its own spec→plan

The texture round (round 4) surfaced that TexTools runs every `.tex` in an old pack (TTMP major < 2,
or exactly 2.0) through `FixOldTexData` at **load** time (`TTMP.cs:1413-1460`, called from
`MakeFileStorageInformationDictionary` `TTMP.cs:1367-1379`), gated by `DoesModpackNeedFix`
(`TTMP.cs:916-930`).

We ported **only the drop-on-decode-failure slice** (the `.tex` branch of `makeTtmpLoadFix`,
`src/upgrade/load-fixes.ts`, gated by `ttmpNeedsTexFix`/`needsTexFix` in `src/upgrade/texfix.ts`),
mirroring the `try { FixOldTexData } catch { continue }` that drops malformed placeholder textures —
the fix for the 8 `hd_bunny_sluts` index regressions. It runs at the read seam, fused with the
duplicate-collapse (WizardData.FromWizardGroup, `WizardData.cs:700-737`).

**2026-07-25: the `ValidateTexFileData` resize + mip-offset-fixup halves SHIPPED** — see
[`docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md`](../superpowers/specs/2026-07-25-validate-tex-load-seam-design.md).
`validateTexFileData` (`src/upgrade/validate-tex.ts`) now ports both branches: the NPOT-with-mips
resize (Branch A, including its width-for-both-dims bug, `docs/TEXTOOLS_BUGS.md` #20) and the broken
mip-offset-table repair (Branch B, `fixUpBrokenMipOffsets` in `src/tex/header.ts`, including the
struct-copy `MipCount` quirk, `docs/TEXTOOLS_BUGS.md` #21). Branch B alone shrank or removed diffs
across 30+ real corpus packs. Branch A on a BC-compressed source is a confirmed divergence (we emit
A8R8G8B8 instead of TexTools' re-encoded BC format — no BC encoder; see
`docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md`), reached for real by
`KK_Sportcar_Final_Hotfix_V1.1.1.ttmp2`.

**Remaining:** the **unconditional recompress** of every kept `.tex` via `Tex.CompressTexFile`
(`TTMP.cs:1436`). It is invisible to our golden harness (which compares decompressed content, and
recompression preserves it), so it stays low-priority and unscheduled.

## Update (2026-07-13): the `/resave` write-side oracle now forces the *mip-offset-fixup* half

It is no longer coverage-free. The remaining `.tex` payload diffs in the `/resave` baselines are
exactly this — neither format nor dimension nor length changes:

- `Bloodlust - Bibo+.ttmp2` `v01_c0201e0256_top_m.tex` — ours and golden are both `fmt=0x3420
  2048x2048 mips=12`, both 2796296 bytes, and the **first differing byte is at offset 72**.
- `chained_collars_v1_1_0.ttmp2` `v01_c0101a0004_nek_d.tex` — both `16x16 mips=1`, both 208 bytes,
  first differing byte at **offset 20**.

Both offsets fall inside the 80-byte `.tex` header, in the **LoD/mipmap offset tables**. That is
precisely the `ValidateTexFileData` "fix up broken mip offsets" half.

The offset fixup needed no resampler, so it was portable independently of the NPOT-resize half — and
was: both shipped together 2026-07-25 (see the update above). It is shared with `FastValidateTexFile`'s
`FixUpBrokenMipOffsets`, which is now ready to wire — see `2026-07-13-pmp-load-time-tex-fixup.md`.
