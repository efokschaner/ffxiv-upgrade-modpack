# Our load-fix seam bumps `.mdl` to v6; TexTools' load does not — the v6 bump belongs to the UPGRADE caller

Filed: 2026-07-13 · Status: open · Surfaced by the `/resave` write-side oracle

**Correction, 2026-07-21b — this IS a bug in our shipped `/upgrade` output, for models the upgrade
transform never touches.** As originally filed this item said the opposite (kept below, since the
reasoning still holds for every *chara* model). The furniture `.mdl` parse fix (part of the
furniture `bgparts` writer work, shipped 2026-07-23) let
`bgcommon` models reach our output for the first time, and three of them in
`raykie Gym Equipment Posing Props V1_0_2.ttmp2` now differ from the `/upgrade` golden in **exactly
one field — the MDL version at byte 0, ours `0x06` vs golden `0x05`** — with identical length and
identical bytes everywhere else:

```
bgcommon/hou/indoor/general/0613/bgparts/fun_b0_m0613.mdl   ours ver=6  golden ver=5   (59924 B both)
bgcommon/hou/indoor/general/0466/bgparts/fun_b0_m0466.mdl   ours ver=6  golden ver=5   (79732 B both)
bgcommon/hou/indoor/general/0824/bgparts/fun_b0_m0824.mdl   ours ver=6  golden ver=5   (40468 B both)
```

That is this item's exact signature, and it confirms the diagnosis: TexTools bumps the version in the
**upgrade caller**, which only runs for models the transform converts. A furniture model the transform
leaves alone therefore stays v5 in the golden, while our load-seam bump makes it v6 unconditionally.
The chara case is invisible only because the transform touches those models anyway. Recorded in
`raykie`'s `.upgrade-baseline` / `.resave-baseline` entries; it is a *pre-existing* gap made visible,
not a regression from that fix.

Original filing follows.

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
Our load-fix seam (`makeTtmpLoadFix`'s `.mdl` branch, `src/upgrade/load-fixes.ts`) therefore over-reaches.

**Fix:** move the v6 bump out of the load seam into the upgrade caller — and keep the `/upgrade`
goldens byte-exact while doing it.

## Complexity — this is a medium port, not a one-line seam move (2026-07-23)

Investigated while shipping the furniture-`bgparts` writer (2026-07-23). The
version is **not a standalone byte**: `MakeUncompressedMdlFile` writes `ttModel.MdlVersion`
(`Mdl.cs:2490`) and the **bone-set block encoding branches on that version** (`Mdl.cs:3378`) — v6 uses
the compact `Getv6BoneSet` path, v5 uses a different fixed-layout branch (`Mdl.cs:3395-3445`). Our port
has **only a v6 bone-set writer** (`src/mdl/model/bone-sets.ts`, `buildV6BoneSetBlock`); the v5 write
branch is **unported**. So a faithful "let the source version flow through the load fix" requires:

1. Porting the v5 bone-set write branch (currently absent), so the writer can emit a v5 model at all.
2. Restructuring version flow: `normalizeModel` (`src/upgrade/model.ts:48`) stops forcing
   `mdlVersion = 6`, the writer emits the source version, and the `/upgrade` caller bumps only the
   models the transform touches — mirroring TexTools, where `FixOldModel` (`EndwalkerUpgrade.cs:190-208`)
   preserves the version and the transform bumps.
3. Re-verifying all 483 chara `.mdl` goldens stay byte-exact.

**A furniture-scoped shortcut is tempting but non-faithful — do NOT take it.** Furniture models are
unweighted, so they carry no bone-sets, so their v5 and v6 output differ *only* in byte 0; "preserve
the source version when the model is unweighted" would byte-match those 3 models trivially. But TexTools
scopes the bump by **whether the transform touched the model**, not by weightedness. The two conditions
merely coincide on the current corpus; a hand-authored unweighted model the transform *does* touch would
diverge (golden v6, shortcut v5). That is the "reproduce the control flow, not just the output" trap.
The honest fix is the general one above.

**Current residual (post furniture-writer, 2026-07-23):** the 3 furniture-BB models
(`gar_b0_m0193`, `fun_b0_m0467`, `fun_b0_m0257`) now emit and differ from golden in exactly byte 0 —
the same signature as the models above — recorded in the affected packs' `.upgrade-baseline`. It burns
down when this item lands.
