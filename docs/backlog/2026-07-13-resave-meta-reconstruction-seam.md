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
