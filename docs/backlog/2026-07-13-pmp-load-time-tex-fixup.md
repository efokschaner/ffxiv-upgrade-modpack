# PMP load-time `.tex` fixup (`EndwalkerUpgrade.FastValidateTexFile`) is unported

Filed: 2026-07-13 · Status: open · **A DIFFERENT gap from T2**, misattributed to it in an earlier
pass of the backlog

`ResolvePMPBasePath` (`PMP.cs:78-90`) runs every unzipped `.tex` through
`EndwalkerUpgrade.FastValidateTexFile` immediately after unzip (`PMP.cs:86`, inside a `try { }
catch { }`), and `UnpackPmpOption` runs it again per-file when not already unzipped
(`PMP.cs:1084-1091`) — i.e. this is a **PMP load-time** fix, unlike T2's `FixOldTexData`
(TTMP-load-gated only, `DoesModpackNeedFix` / `TTMP.cs:916`; see
`2026-07-10-fixoldtexdata-load-round.md`).

`FastValidateTexFile` (`EndwalkerUpgrade.cs:2132-2165`) does two things:

1. `FixUpBrokenMipOffsets` — the SAME mip-offset-table repair T2 already tracks (shared with
   `ValidateTexFileData`);
2. **truncates trailing null padding** — "Textools would repeatedly add 80 null bytes to the end of
   textures" (`EndwalkerUpgrade.cs:2149-2165`) — which T2 does NOT cover (T2's own recorded evidence
   is *same-length, differing header bytes*; a null-padding truncation is a *length* difference).

**Evidence:** `[Jaque] Romeo & Juliet [feb 2023] - DT update.pmp`'s sole remaining `/resave`
residual after the writer-regeneration fix is `common/24/…id.tex`, a payload **byte-length** mismatch
(~80/160 bytes, a multiple of the 80-byte padding chunk) — exactly this fixup's signature, not T2's.

## Its blast radius is bigger than a byte diff: it changes MEMBER NAMES, via the dedup

`ResolveDuplicates` (`PmpExtensions.cs:476-566`) keys its dedup on a SHA1 of the file's *loaded*
content, so a fixup applied at load decides the content-equality classes — and therefore which files
collapse into `common/{idx}/`. Two textures that differ ONLY by trailing null padding are identical
to TexTools (post-truncation) and distinct to us.

Confirmed on `Westlaketea's Constellation Crown (Dawntrail Edition).pmp`: the golden resolves
`chara/equipment/e6041/texture/v01_c0101e6041_met_d_m.tex` (option *Black Veil*) to
`common\1\mt_c0101e6041_met_c_id.tex` — deduped against a *different game path's* content, whose
basename it therefore carries — while we, not having truncated, keep it as its own member at
`options\black veil\…\v01_c0101e6041_met_d_m.tex`. That is the entire cause of the three
`structure/removed` (ours-only) payload members in that pack's `/resave` baseline, the only three
member-name divergences left anywhere in the PMP corpus.

So this fixup must land before member-name parity can be claimed complete — it is not merely a
`.tex` content gap.

## Neither half is ported

`applyLoadFixes` (`src/upgrade/upgrade.ts`) has no PMP branch at all today —
`docs/superpowers/specs/2026-07-12-pmp-writer-regeneration-design.md` §4.3.1 claimed "PMP has no
load-time fixes at all (both are TTMP-gated)", which this finding shows is false; the spec text has
been corrected in place, but `applyLoadFixes` itself has NOT been extended.

**Consequence:** any PMP `.tex` carrying either broken mip offsets or trailing null padding diverges
from the `/resave` golden (and, by the same load-time reasoning, potentially from the `/upgrade`
golden too).

Deliberately deferred, same shape as T2: port the mip-offset half together with T2's (shared
`FixUpBrokenMipOffsets` / `ValidateTexFileData` logic) and the null-padding truncation as a small
addition, gated on PMP rather than on `DoesModpackNeedFix`.

## Update (2026-07-13): confirmed on the `/upgrade` side too, not just `/resave`

Turning on `checkPayloadMembers` (payload zip-member NAME comparison) for every PMP golden, not just
no-ops, surfaced new member-name diffs on the same three real packs the writer-regeneration fix
touched (`Westlaketea's Constellation Crown`, `[Jaque] Marcellus`, `[Jaque] Romeo & Juliet`). Every
one traced back to a payload byte mismatch already sitting in that pack's `/upgrade` baseline under
`diffUpgrade`'s bare-`gamePath` key — mostly `.tex` length differences that are multiples of 80
bytes, this fixup's exact signature. No new bug; re-blessed as the same, already-known divergence
surfacing under a second key (`<optionPrefix><gamePath>` instead of bare `gamePath`) now that the
member-name check runs on every PMP. See
`docs/superpowers/specs/2026-07-12-pmp-writer-regeneration-design.md` §7 for the full account.
