# T2 — full `FixOldTexData` load-time round (only the drop-malformed subset is ported)

Filed: 2026-07-10 · Status: open · Needs its own spec→plan

The texture round (round 4) surfaced that TexTools runs every `.tex` in an old pack (TTMP major < 2,
or exactly 2.0) through `FixOldTexData` at **load** time (`TTMP.cs:1413-1460`, called from
`MakeFileStorageInformationDictionary` `TTMP.cs:1367-1379`), gated by `DoesModpackNeedFix`
(`TTMP.cs:916-930`).

We ported **only the drop-on-decode-failure slice** (`src/upgrade/texfix.ts` `needsTexFix` +
`texFixRound`, mirroring the `try { FixOldTexData } catch { continue }` that drops malformed
placeholder textures — the fix for the 8 `hd_bunny_sluts` index regressions).

The **remaining** `FixOldTexData` behaviour is unported:

1. `ValidateTexFileData` (`EndwalkerUpgrade.cs:2100`) — resize a NPOT texture that has >1 mip up to
   power-of-two (needs the **ImageSharp Bicubic resampler**, still deferred — same dependency as the
   texture round's resize gap, `2026-07-10-imagesharp-resampler.md`), and fix up broken mip offsets;
2. the **unconditional recompress** of every kept `.tex` via `Tex.CompressTexFile` (`TTMP.cs:1436`).

The recompress is invisible to our golden harness (it compares decompressed content, and
recompression preserves it), so it is low-priority; the NPOT-resize *does* change decompressed
content and would show as a golden diff if any old-pack corpus texture is NPOT-with-mips. This is a
load-time round analogous to the model round's `FixOldModel`; scope it as its own spec→plan when the
resampler lands or a corpus pack demands the resize.

## Update (2026-07-13): the `/resave` write-side oracle now forces the *mip-offset-fixup* half

It is no longer coverage-free. The remaining `.tex` payload diffs in the `/resave` baselines are
exactly this — neither format nor dimension nor length changes:

- `Bloodlust - Bibo+.ttmp2` `v01_c0201e0256_top_m.tex` — ours and golden are both `fmt=0x3420
  2048x2048 mips=12`, both 2796296 bytes, and the **first differing byte is at offset 72**.
- `chained_collars_v1_1_0.ttmp2` `v01_c0101a0004_nek_d.tex` — both `16x16 mips=1`, both 208 bytes,
  first differing byte at **offset 20**.

Both offsets fall inside the 80-byte `.tex` header, in the **LoD/mipmap offset tables**. That is
precisely the `ValidateTexFileData` "fix up broken mip offsets" half.

The offset fixup needs no resampler, so it can be ported independently of the NPOT-resize half (and
of `2026-07-10-imagesharp-resampler.md`). It is shared with `FastValidateTexFile`'s
`FixUpBrokenMipOffsets` — port the two together, see `2026-07-13-pmp-load-time-tex-fixup.md`.
