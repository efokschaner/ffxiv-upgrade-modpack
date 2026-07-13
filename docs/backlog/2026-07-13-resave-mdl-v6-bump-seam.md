# Our load-fix seam bumps `.mdl` to v6; TexTools' load does not — the v6 bump belongs to the UPGRADE caller

Filed: 2026-07-13 · Status: open · Surfaced by the `/resave` write-side oracle

**This is not a bug in our shipped `/upgrade` output.** Our `/upgrade` `.mdl` bytes are *identical*
to the `/upgrade` golden; the divergence is that we apply the transform at a **different seam** than
TexTools does, which only a load-then-write oracle can see. Fixing it is about seam fidelity, and
any fix must keep the `/upgrade` goldens byte-exact.

483 `.mdl` payload diffs across the TTMP corpus, and the single most interesting `/resave` finding.
`normalizeModel` (`src/upgrade/model.ts`) hard-sets `model.mdlVersion = 6` — with the comment
*"FixOldModel emits v6 (R1: caller-set, ShrinkRay.cs:108)"*, which already says the version is set
by the **caller**, not by `FixOldModel`. On `/upgrade` that is exactly right; on `/resave` TexTools
leaves the model at v5.

**Evidence** (`Tight&Firm-YorhaCollection-2B.ttmp2`,
`chara/equipment/e0649/model/c0101e0649_dwn.mdl`): source is 84376 bytes; all three normalized
outputs are 56184 bytes; TexTools `/resave` = sha `4afb2e51a5bc`, TexTools `/upgrade` = sha
`d1b66f709ede`, **ours (both paths) = sha `d1b66f709ede`** — i.e. *our `/upgrade` output is
byte-identical to the `/upgrade` golden*. Diffing the two goldens against each other: 57 differing
bytes out of 56184, and **byte 0 is `0x05` in `/resave` vs `0x06` in `/upgrade`** (the MDL version),
the remaining 56 being the v5-vs-v6 bone-set encoding.

So TexTools' *load* runs `FixOldModel` **without** the v6 bump, and `/upgrade` applies it afterwards.
Our `applyLoadFixes` therefore over-reaches.

**Fix:** move the v6 bump out of the load seam into the upgrade caller — and keep the `/upgrade`
goldens byte-exact while doing it.
