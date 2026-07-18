# `readLegacyTtmp` silently returns an empty pack when fed a non-legacy (zip) archive

Filed: 2026-07-17 · Status: **harness re-read FIXED 2026-07-17**; the fail-loud half below remains open

## Resolved half — the harness re-read (shipped)

The motivating bug: both golden harnesses re-read our written archive under the **source** filename,
so a legacy `.ttmp` source (written as ttmp2) was re-read as legacy and came back empty, making every
file a phantom `#N:added` divergence. Fixed by re-reading under the **written** `target` extension in
`corpus-upgrade.ts` and `corpus-resave.ts` (the golden side already folded `.ttmp` → ttmp2 via
`goldenExt`/`resaveExt`). The affected v1 `.ttmp` packs were re-blessed to their real diffs.

## Remaining half — make `readLegacyTtmp` fail loud

The reason a wrong-format re-read produced a *silent phantom divergence* rather than a loud error is
that `readLegacyTtmp` (`src/container/ttmp-legacy.ts`), handed a ttmp2 **zip**, returns an empty pack
instead of throwing — against this repo's fail-loud rule. It should detect a non-legacy container
(e.g. the `PK\x03\x04` zip magic, which a real length-prefixed v1 `.ttmp` never starts with) and
throw, so a future miswire surfaces immediately instead of as a whole-pack phantom diff. Needs a
focused unit test feeding it a zip and asserting the throw.

## Original symptom (kept for context)

Adding the first legacy-format (v1 `.ttmp`) packs to the corpus surfaced this. Every v1 `.ttmp`
pack reports `0 matched` with its *entire* content showing as `#N:added` (golden has every file,
ours has none) on the `/upgrade` check — e.g. `Cutiepoo's Curly Hair for Almost All.ttmp`,
`Cutiepoo's Curly Hair for Elezen.ttmp`, `tightandfirmmaxfilia.ttmp`. The upgraded output looks
empty even though the transform is correct.

## Root cause

`registerUpgradeCheck` (`test/helpers/corpus-upgrade.ts:113`) writes our upgraded archive with
`target = name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2"` — so a v1 `.ttmp` source is
written as **ttmp2** (our writer only emits ttmp2/pmp; there is no legacy-ttmp writer). It then
re-reads that archive with `loadModpack(name, oursArchive)`, still passing the **source** filename.
`detectFormat` (`src/container/detect.ts`) is purely extension-based, so `…All.ttmp` dispatches to
`readLegacyTtmp`, which is handed a ttmp2 **zip** and silently returns an empty pack. The whole-pack
byte diff then sees "golden has everything, ours has nothing."

The golden side already handles this correctly and even documents it: `goldenExt`
(`test/helpers/upgrade-golden.ts:39`) folds every TTMP-family input — legacy `.ttmp` included — to
`ttmp2` and loads the golden as `golden.ttmp2`, "because ConsoleTools /upgrade always emits a
Dawntrail .ttmp2 for those, never legacy .ttmp." The ours-reread seam just missed the same fold.

Verified: re-reading the identical written archive as `ours.ttmp2` yields all files and the real
diff (`Cutiepoo's Curly Hair for Almost All` is then `matched=9, 0 game diffs` — a clean pass masked
entirely by the artifact; `tightandfirmmaxfilia` reduces to a T4 index-path-override diff).

## Fix

Re-read the written archive under a name whose extension matches the **write target**, not the
source — e.g. `loadModpack(target === "ttmp2" ? "ours.ttmp2" : "ours.pmp", oursArchive)` (or reuse
`goldenExt`). Check `corpus-resave.ts` for the same seam. After fixing, **re-bless** the affected v1
`.ttmp` packs: their current baselines encode the empty-reread artifact, not real divergences.

Secondary (fail-loud) fix worth bundling: `readLegacyTtmp` silently returns an empty pack when fed a
non-legacy (zip) archive, against this repo's fail-loud rule. It should detect the ttmp2/zip magic
and throw rather than yield empty — that would have turned this into a loud error instead of a
silent whole-pack "divergence."
