# 19. A canonical `MipCount==2` header's `LoDMips=[0,1,0]` trips `TexHeader.ToBytes`'s own ordering guard

**Status:** reproduced · **FIXED UPSTREAM in `1993bf6` ("Be less strict about texture mip data, and
fix non-ascending lodmips", v3.1.1.4). Our port has NOT yet been changed, so our faithful
reproduction is now a *divergence from the new oracle*, to be closed in Part B.** See the "Upstream
fix, as landed" section at the end of this entry.

**Where** (line numbers below are the **v3.1.1.4** pin unless marked *pre-fix*):
`Tex.cs:1124-1126` (`CreateTexFileHeader`) vs the ordering guard that `1993bf6` **deleted** from
`TexHeader.ToBytes` (`Tex.cs:138-139` *pre-fix*, inside the `:138-145` guard block) — see
`src/tex/header.ts`, `buildCanonicalTexHeader` / `assertTexHeaderWritable`

`CreateTexFileHeader` set `LoD1Mip = newMipCount > 1 ? 1 : 0` and `LoD2Mip = newMipCount > 2 ? 2 : 0`
(`:1126-1127` *pre-fix*; the second of those is the line the fix changed, now `:1126`). For a texture
with **exactly two** generated mips this yields `LoDMips = [0, 1, 0]` —
LoD2 stays at its zero default because the `>2` guard doesn't fire, leaving it *below* LoD1. Every
other mip count is self-consistent (`MipCount==1` gives `[0,0,0]`; `MipCount>=3` gives `[0,1,2]`), so
this is confined to the boundary the two independent `>1`/`>2` comparisons don't agree on — a plain
off-by-one in the second guard, not a format rule (nothing requires LoD2 to stay 0 specifically when
`MipCount==2`; the natural completion is `min(2, newMipCount-1)`, matching what the `>1` guard already
does for LoD1).

`ToBytes()`'s ordering guard (`:138` *pre-fix*, ported as `assertTexHeaderWritable`) was a **pure
function of the stored `LoDMips`** — it didn't care how the header got that way. So this was not a
"corrupted header only" crash: any canonical `MipCount==2` header hit it, corrupted or not.
`CompressTexFile` (`Tex.cs:1299-1329`), TexTools' ordinary DDS-import path, reads back a header built
moments earlier by this same `CreateTexFileHeader` (via `DDSHeaderToTexHeader`, `:1202`, called from
`DDSToUncompressedTex` at the top-level import entry point `:502`) and immediately calls
`header.ToBytes()` on it (`:1324`) — with no `FixUpBrokenMipOffsets` anywhere in that path. A
**freshly imported, never-corrupted** two-mip texture crashed there exactly as a broken-offset one
does in `ValidateTexFileData`'s Branch B; the two call sites just differ in *when* they reach
`ToBytes()`. `TexHeader.FixUpBrokenMipOffsets`' LoDMips loop (`Tex.cs:203-219`, ported as the
`fixUpBrokenMipOffsets` loop) is a separate, unrelated reader — *pre-fix* it never rewrote `LoDMips`
unless an entry was `>= MipCount`, so it passed a `MipCount==2` header's `[0,1,0]` through untouched —
but its absence isn't what caused the crash; `ToBytes()` would throw on that header whether or not a
fixup pass ever ran. (`1993bf6` also added an ascending-order clamp to that same loop, `:213-218`, so
at the new pin it *would* normalize `[0,1,0]` to `[0,1,1]` — a second, independent leg of the fix.)
`ValidateTexFileData`'s Branch B (`EndwalkerUpgrade.cs:2116-2124`) is
simply the first place *our port* currently reaches this shared defect, because a broken-offset old
two-mip `.tex` is the case our load seam constructs; the crash itself is reachable anywhere TexTools
serializes a canonical `MipCount==2` header, broken offsets or not.

**Us:** ported both symbols verbatim — `buildCanonicalTexHeader` (`src/tex/header.ts`) reproduces the
`[0,1,0]` construction for `MipCount==2`, and `assertTexHeaderWritable` reproduces `ToBytes`'s ordering
check, so `validateTexFileData`'s Branch B (`src/upgrade/validate-tex.ts`) throws on this shape exactly
where TexTools would. Found while writing this task's synthetic Branch-B test: a naive 4x4
(`mipCount==2`) fixture with a corrupted mip0 offset reliably reproduces the crash — pinned directly by
`test/upgrade/validate-tex.test.ts` ("Branch B: a mipCount==2 tex with a broken offset throws the ToBytes
ordering guard"); the *rewrite-path* test uses 16x16 (`mipCount==4`, `LoDMips=[0,1,2]`) instead, to
exercise the intended repair without tripping this defect. No corpus pack is known to reach it yet.

**Upstream fix, as landed** (`1993bf6`, 2025-11-02 — verified against `git show`, three hunks, all in
`Tex.cs`):

1. **`TexHeader.ToBytes` loses its entire validation block** (`Tex.cs:138-145` *pre-fix*, +0/−9) — not
   just the ordering guard this entry is about, but all four: the `LoDMips` non-descending check, the
   `LoDMips[2] >= MipCount` check, `MipFlag > 15`, and `MipCount > 13`. `ToBytes` is now a pure
   serializer. This is the commit's "be less strict about texture mip data" half.
2. **`CreateTexFileHeader`'s LoD2 line** becomes
   `BitConverter.GetBytes(newMipCount > 2 ? 2 : (newMipCount - 1))` (`Tex.cs:1126`). Behaviourally
   identical to the completion proposed above for every reachable `newMipCount >= 1`; it differs only
   at `newMipCount == 0`, where it would emit `-1` (unreachable — `CreateTexFileHeader` is only
   called with a real mip chain).
3. **`FixUpBrokenMipOffsets` gains an ascending-order clamp** in its LoDMips loop (`Tex.cs:203-219`):
   a running `maxLodMip` raises any entry that falls below its predecessor, setting `modified`. This
   is the commit's "fix non-ascending lodmips" half.

**What Part B owes** (spec `docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §10
row 1): delete `assertTexHeaderWritable` and its Branch-B call site (`src/upgrade/validate-tex.ts`),
change `buildCanonicalTexHeader`'s LoD2 to `mipCount > 2 ? 2 : mipCount - 1`, and add the ascending
clamp to `fixUpBrokenMipOffsets` — with tests, including replacing the two `test/upgrade/validate-tex.test.ts`
and `test/tex/tex-header.test.ts` cases that currently assert the throw.
