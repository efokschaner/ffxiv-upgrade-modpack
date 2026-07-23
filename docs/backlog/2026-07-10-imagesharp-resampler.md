# T3 — ImageSharp Bicubic resampler: T2's `ValidateTexFileData` NPOT resize still unported

Filed: 2026-07-10 · Status: open (narrowed 2026-07-16, narrowed again 2026-07-22 to the load-time
call site alone) · Needs its own spec→plan

The Bicubic resampler (`resizeBicubic`, `src/tex/imagesharp/resample.ts`) is built and, as of
2026-07-16, wired into `updateEndwalkerHairTextures` (`src/upgrade/texture.ts`): the NPOT pow2
pre-step (`:1195-1202`) and the common-max resize (`ResizeImages`, `:1205`) both resize for real
now, feeding both callers — the round-2 texture pass (`upgradeRemainingTextures`'s `HairMaps`
branch) and the round-6 `updateUnclaimedHairTextures` rescue. `TextureResizeUnsupported` is no
longer thrown from the hair path; it stays live only for `createIndexFromNormal` (`:1098`) and
`upgradeMaskTex` (`:2088`), both NPOT-normalize pre-steps this item still needs to close. (All
three call sites resize via Bicubic — `ResizeXivTx`/`ResizeImage` default `nearestNeighbor=false`;
there is no NearestNeighbor step in this family despite the old title of this item.)

**Real corpus cases:** `Misty_Hairstyle_Female.ttmp2` (hair size-mismatch, round-2) and
`Eliza.ttmp2` (hair size-mismatch, round-6) both now regenerate real Bicubic-resized output instead
of the baselined raw-copy skip. Measured against their ConsoleTools `/upgrade` goldens (header/dims/
length byte-identical on every affected file in both cases):
- `Misty_Hairstyle_Female.ttmp2` (no resize needed — normal/mask already share one pow2 size, so
  `ResizeImages` is the `TextureHelpers.cs:368` no-op and the only float math is the createHairMaps
  byte remap): max |ours-golden| = 1 (e.g. `--c0201h0170_hir_c_n.tex` 22305/89478560 bytes at delta
  1; `--c0201h0170_hir_b_n.tex` byte-identical) — within the existing global `.tex` ±1
  `DIVERGENCE_RULES` tolerance already, no new rule needed.
- `Eliza.ttmp2` (a genuine 512²->1024² Bicubic upscale of the normal, mask already at 1024² so
  byte-identical): max |ours-golden| = 11 on the resized normal, but the histogram is a sharply
  decaying float-precision tail, not a systematic/structural offset — of 5,592,480 bytes, 5,084,939
  (90.9%) are exact, 506,979 (9.1%) are ±1, and the count collapses fast past that (356 @2, 125 @3,
  28 @4, 22 @5, 9 @6, 14 @7, 4 @8, 2 @9, 2 @11 — i.e. 2 outlier bytes total across 5.6M). This exceeds
  the global ±1 rule (so these two files stay recorded as ratchet-baselined mismatches, not
  auto-confirmed) but matches the expected float64-vs-float32 Bicubic gap, just larger here because a
  real 2x upscale kernel touches more source texels near edges than the Misty no-op case. No
  `DIVERGENCE_RULES` entry was added for this (path-scoping a rule to two specific hair textures over
  a tolerance measured on one pack felt premature); revisit if more corpus coverage shows the same
  shape and the baselined-mismatch route gets noisy.
Blessing this also surfaced a SEPARATE, already-tracked gap on the same two packs — the newly-
regenerated hair `.tex`/`.mtrl` entries lose their `ttmp` (Name/Category/DatFile) metadata because
`writeGeneratedTex`/`writeGeneratedMtrl` don't carry it forward; see
`2026-07-13-resave-ttmp2-name-category.md` (now confirmed to reach `/upgrade`, not just `/resave`).

**`createIndexFromNormal`/`upgradeMaskTex` SHIPPED 2026-07-22** — see
[`docs/superpowers/specs/2026-07-21-npot-texture-resize-design.md`](../superpowers/specs/2026-07-21-npot-texture-resize-design.md).
Both now NPOT-normalize via `roundToPowerOfTwo` + `resizeBicubic`, and **`TextureResizeUnsupported`
no longer exists** — the class and the `upgradeRemainingTextures` catch that swallowed it were both
deleted, which also made that loop structurally match `EndwalkerUpgrade.cs:1842` (no catch there
either).

**A claim this item made was FALSIFIED, and it is worth recording why.** The paragraph above used to
read "**No NPOT source exists anywhere in the ~940-pack scan**", which is what kept this branch ranked
as latent. `Club Cyberia Motorbike.ttmp2` carries `v01_m0242b0001_n_c.tex` at **400×400**, and it was
silently costing that pack a generated `_id.tex` in all 12 options. The scan was not wrong about the
packs it saw; it was over-read as evidence about packs in general — exactly the failure mode
`docs/BACKLOG.md`'s "deploying changes the probability term" note warns about. Treat corpus silence as
absence of evidence, not evidence of absence.

**Remaining scope: T2's `ValidateTexFileData` NPOT-resize only**
(`EndwalkerUpgrade.cs:2100-2113`, tracked by
[`2026-07-10-fixoldtexdata-load-round.md`](2026-07-10-fixoldtexdata-load-round.md)) — a *load-time*
call site depending on the same resampler, untouched by the 2026-07-22 work.

One residual from the shipped work, tracked separately rather than here: the elided
`MergePixelData` BC re-encode makes the mask path diverge for BC-compressed NPOT sources —
[`2026-07-22-bc-encoder-merge-pixel-data.md`](2026-07-22-bc-encoder-merge-pixel-data.md).
