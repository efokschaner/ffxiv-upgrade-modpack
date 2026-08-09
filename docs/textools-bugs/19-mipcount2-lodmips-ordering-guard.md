# 19. A canonical `MipCount==2` header's `LoDMips=[0,1,0]` trips `TexHeader.ToBytes`'s own ordering guard

**Status:** **Fixed upstream in `1993bf6` ("Be less strict about texture mip data, and fix
non-ascending lodmips", v3.1.1.4); our port reproduces the fixed behaviour as of `14e9194` (hunks 1
and 3) and `1c25308` (hunk 2).** The entry is kept, not deleted: it is the record of why the old
bytes looked as they did, which the golden cache and the re-pin spec both reference. Everything
below describes the **pre-fix** behaviour unless marked otherwise; see "Upstream fix, as landed" and
"What Part B owed" at the end.

**Where** (line numbers below are the **v3.1.1.4** pin unless marked *pre-fix*):
`Tex.cs:1124-1126` (`CreateTexFileHeader`) vs the ordering guard that `1993bf6` **deleted** from
`TexHeader.ToBytes` (`Tex.cs:138-139` *pre-fix*, inside the `:138-145` guard block) — see
`src/tex/header.ts`, `buildCanonicalTexHeader` (our port of the guard, `assertTexHeaderWritable`,
was deleted with it)

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
simply the first place *our port* ever reached this shared defect, because a broken-offset old
two-mip `.tex` is the case our load seam constructs; the crash itself is reachable anywhere TexTools
serializes a canonical `MipCount==2` header, broken offsets or not.

**Us — historical, then current.** We *did* port both symbols verbatim: `buildCanonicalTexHeader`
(`src/tex/header.ts`) reproduced the `[0,1,0]` construction for `MipCount==2`, and
`assertTexHeaderWritable` reproduced `ToBytes`'s ordering check, so `validateTexFileData`'s Branch B
(`src/upgrade/validate-tex.ts`) threw on this shape exactly where the old TexTools would — and the
enclosing load-fix `catch` then dropped the file. That reproduction was found while writing the
original synthetic Branch-B test (a naive 4×4 `mipCount==2` fixture with a corrupted mip0 offset
reproduces the crash reliably), and no corpus pack was ever known to reach it.

**None of that is live any more.** `assertTexHeaderWritable` is deleted, `buildCanonicalTexHeader`
emits `[0,1,1]`, and `fixUpBrokenMipOffsets` carries the ascending clamp, so a broken-offset
non-ascending-`LoDMips` `.tex` is now **repaired and kept** rather than dropped. What pins the fixed
behaviour today:

- **Unit** — `test/upgrade/validate-tex.test.ts` "Branch B: a legacy non-ascending LoDMips tex is
  repaired and KEPT (TEXTOOLS_BUGS #19)", plus `test/tex/tex-header.test.ts` "emits LoD2 =
  mipCount - 1 below three mips (Tex.cs:1126, as fixed by 1993bf6)" and "raises a non-ascending
  LoDMips entry to its predecessor (Tex.cs:213-218, added by 1993bf6)".
- **Real oracle** — `test/corpus/synthetic/load-seam-mipfix.ttmp2`
  (`scripts/generate-synthetics/build-synthetic-load-seam-mipfix.ts`), built for this purpose: an
  old-version (`TTMPVersion "2.0w"`) TTMP carrying both trigger shapes — a 4×4 two-mip header with
  the canonical `[0,1,0]` **and** a 16×16 four-mip header with a stored `[0,2,1]`, each with a
  clobbered mip0 offset. Against the v3.1.1.4 oracle both `.tex` payloads come back
  **byte-identical** to the golden, which is the direct proof that our repair matches the fixed
  upstream one. (Its baseline entries are all `ModsJsons[].{Name,Category,DatFile}` — the unrelated,
  pre-existing writer gap `docs/backlog/2026-07-13-resave-ttmp2-name-category.md`; none of them is a
  `.tex`.) The sibling `load-seam-npot.ttmp2` pins Branch A and is *not* clean — see that pack's own
  note in `docs/backlog/2026-07-22-bc-encoder-merge-pixel-data.md`.

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

**Reach re-measured (2026-08-09, pre-Part-B fact-check).** The entry above, and §10 row 1, both
understate what the deleted guard reached and overstate what the `CreateTexFileHeader` fix moves.
Three corrections, none of which changed the three edits Part B then owed:

1. **The guard fired on more than the canonical `[0,1,0]`.** Branch B's rewrite
   (`EndwalkerUpgrade.cs · ValidateTexFileData · 2116-2124`) threw for *any* header whose `LoDMips`
   are non-ascending after the `>= MipCount` clamp — a stored `[2,1,0]` (which the *pre-fix*
   `FixUpBrokenMipOffsets` leaves untouched, and which the new ascending clamp normalizes to
   `[2,2,2]`) as much as the two-mip `[0,1,0]` this entry is named for.
2. **There was a second, independent call site on the same load path — the recompress.**
   `TTMP.cs · FixOldTexData · 1430-1438` calls `ValidateTexFileData` and *then*, unconditionally,
   `Tex.CompressTexFile(data)`, whose `.tex` arm re-reads the header and calls `header.ToBytes()`
   (`Tex.cs · CompressTexFile · 1308,1324`). So at the old pin every compressed `.tex` of an
   old-version TTMP was validated a **second** time, after `ValidateTexFileData` had already had its
   say: a *healthy* canonical two-mip texture — offsets fine, `ValidateTexFileData` returns null —
   still threw there and was dropped by `WizardData.cs · FromWizardGroup · 709-718`'s catch. Every
   two-mip `.tex` in an old pack was dropped, broken or not. We never ported the recompress
   (`src/upgrade/load-fixes.ts`), so we **kept** those files: a pre-existing divergence from the OLD
   oracle in the *opposite* direction to the one this entry records, which `1993bf6` retroactively
   makes correct. Nothing to port — but it is why the deferred-recompress rationale needs a rewrite
   (see below).
3. **Hunk (b) moves almost nothing.** `mipCount == 2` out of our regenerator requires a minimum
   dimension of exactly 4 (`src/tex/encode.ts · generateMipmaps` emits `max(1, floor(log2(minDim)))`
   levels), and `resizeForMerge` refuses anything under 64 for non-BC7
   (`src/upgrade/texture.ts · resizeForMerge`), so Branch A cannot reach it at all; every
   `buildCanonicalTexHeader` call under `scripts/generate-synthetics/` and `test/` passes
   `mipCount = 1`, so no synthetic pack's bytes change and no cached golden is invalidated. Corpus
   byte movement, if any, therefore comes from hunk (c)'s ascending clamp — which newly sets
   `modified` on a Branch-B texture that previously returned `null` untouched, or threw — and not
   from (b).

   **Measured afterwards: neither hunk moved a byte.** Under the 2026-08-09 bless, all 166
   pre-existing baseline files were byte-identical before and after — so (c)'s clamp fires on no
   corpus texture either. The prediction above was right about (b) and merely conservative about
   (c). The change's value is the class-1 fix, not a diff reduction; that is why the two synthetics
   were built rather than relying on corpus movement as the evidence.

**What Part B owed — DISCHARGED 2026-08-09** (spec
`docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §10 row 1). Kept as the
itemisation of what "reproduces the fixed behaviour" concretely meant, each line marked with where it
landed:

1. Delete `assertTexHeaderWritable` and its Branch-B call site (`src/upgrade/validate-tex.ts`) — done,
   `14e9194`.
2. Change `buildCanonicalTexHeader`'s LoD2 to `mipCount > 2 ? 2 : mipCount - 1` — done, `1c25308`.
3. Add the ascending clamp to `fixUpBrokenMipOffsets` — done, `14e9194`.
4. Replace the `test/upgrade/validate-tex.test.ts` and `test/tex/tex-header.test.ts` cases that
   asserted the throw — done, inverted rather than deleted (the current names are listed under **Us**
   above).
5. Rewrite the deferred-recompress rationale in `src/upgrade/load-fixes.ts` (the `.tex` bullet of
   `makeTtmpLoadFix`'s header comment), which justified skipping `Tex.CompressTexFile` as "invisible
   to the golden" — true only *after* item 1 lands, because until then that call carried the guard
   described in point 2 of *Reach re-measured* — done, `14e9194`.

Beyond the itemisation, the fix was pinned against the real oracle by two purpose-built synthetic
packs (`d3b120d`, `8e77407`); see **Us** above. Measured corpus effect of the whole change: **zero
bytes moved** on all 166 pre-existing baseline files — expected, and recorded with its reasoning in
§10.1's totals table.
