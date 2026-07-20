# `.meta` reconstruction is a LOAD/WRITE behaviour in TexTools, but lives in our UPGRADE transform

Filed: 2026-07-13 · Status: open · Surfaced by the `/resave` write-side oracle

**This is not a bug in our shipped `/upgrade` output.** Our `/upgrade` `.meta` bytes are *identical*
to the `/upgrade` golden; the divergence is that we apply the transform at a **different seam** than
TexTools does, which only a load-then-write oracle can see. Fixing it is about seam fidelity, and
any fix must keep the `/upgrade` goldens byte-exact.

62 `.meta` payload diffs. TexTools' TTMP load turns a `.meta` file into typed
metadata/manipulations and its writer turns them back into `.meta` bytes, so a pure `/resave`
**grows** the file. Our `metadataRound` does the same reconstruction but sits inside
`upgradeModpack`, so our `/resave` path leaves the source `.meta` untouched.

**Evidence** (`Tight&Firm-YorhaCollection-2B.ttmp2`, `chara/equipment/e0649/e0649_dwn.meta`): source
182 bytes (sha `24db7b7fd262`); `/resave` golden 192 bytes (sha `33423dcdfb29`); ours on the resave
path = 182 bytes, **unchanged**; ours on the upgrade path = 192 bytes, sha `33423dcdfb29` —
**byte-identical to the golden**. So `reconstructMeta` is *correct*; only its seam is wrong.

Same shape as the `.mdl` v6-bump finding (`2026-07-13-resave-mdl-v6-bump-seam.md`): decide whether
`metadataRound` belongs on the load seam (where FixOldTexData/FixOldModel now run — `loadModpack` /
`makeTtmpLoadFix`, `src/upgrade/load-fixes.ts`) rather than in `upgradeModpack`, and keep the
`/upgrade` goldens byte-exact.

**2026-07-19 (Task 4, the weapon IMC growth synthetic):** now exercised by a **synthetic** pack too,
not only by real corpus packs — `test/corpus/synthetic/imc-weapon.ttmp2`
(`scripts/generate-synthetics/build-synthetic-imc-weapon.ts`) reproduces this seam in miniature and
is blessed into its `/resave` baseline as a single payload entry,
`chara/weapon/w2021/obj/body/b0001/w2021b0001.meta … "84 vs 90 bytes"`. It is the tightest repro of
this item yet: the 6-byte delta is exactly **one IMC entry**, because the pack ships a deliberately
1-entry IMC segment against a base-game root carrying 2. The same pack's `/upgrade` payload diff is
**empty** — our upgraded `.meta` is byte-identical to the `/upgrade` golden — so it exhibits both
halves of this item's thesis (reconstruction correct, seam wrong) in one 2-file fixture, buildable on
a fresh clone via `npm run synthetics` with no third-party mod. Worth using as the regression fixture
when the seam is moved.
