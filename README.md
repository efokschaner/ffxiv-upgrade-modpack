# ffxiv-upgrade-modpack

A client-side, static (GitHub Pages–hostable) tool that upgrades a pre-Dawntrail
FFXIV modpack to Dawntrail format — the equivalent of TexTools'
*Tools → Dawntrail Upgrades → Upgrade Modpack*, reimplemented in TypeScript so it
runs entirely in the browser with no game install and no backend.

Status: **in progress.** Foundation (modpack container I/O) and the SQPack codec
(Type 2/3/4 decode + encode) are implemented; the semantic codecs (`.mtrl` / `.tex`
/ `.mdl`) and the Endwalker→Dawntrail transforms are the next increments. See
`docs/superpowers/` for the design specs and implementation plans.

## License

Copyright (C) 2026 Edmund Fokschaner and contributors.

This project is licensed under the **GNU General Public License, version 3 or
later (GPL-3.0-or-later)** — see [`LICENSE`](./LICENSE). The license applies to
every file in this repository; individual source files carry no per-file
license header.

It is a **derivative work**: substantial portions (the SQPack codec and the
modpack container readers/writers) are a hand port from C# to TypeScript of
[**xivModdingFramework**](https://github.com/TexTools/xivModdingFramework) and
[**FFXIV TexTools**](https://github.com/TexTools/FFXIV_TexTools_UI), both
Copyright (C) Rafael Gonzalez ("liinko") and contributors and licensed under
GPL-3.0-or-later. Because of that, this project is GPL-3.0-or-later too — see
[`NOTICE`](./NOTICE) for the full attribution.

FINAL FANTASY XIV and its assets are the property of SQUARE ENIX CO., LTD. This
repository ships no game assets.

## Upstream provenance — what we port from

The port is a snapshot in time of specific upstream commits. **The porting baseline is
the installed TexTools release** — the same build that generates our goldens — so the
C# we *read* is exactly the C# that *produces the bytes we diff against*. `reference/`
is gitignored (vendored third-party C#), so these SHAs — not the working tree — are the
record of what a given state of this repo was ported against.

**Baseline: TexTools `v3.1.1.4`.** The oracle is a *portable install* resolved
repo-relative at `reference/oracle/<tag>/ConsoleTools.exe` (default in
`test/helpers/oracle.ts`, overridable with the `FFXIV_CONSOLETOOLS` env var),
provisioned by `npm run setup-oracle`. Its ProductVersion is `1.0.0+b96139d3…` — i.e.
FFXIV_TexTools_UI tag `v3.1.1.4`. `reference/` is pinned to match it exactly:

| Path in `reference/` | Repo | Commit | = |
|----------------------|------|--------|---|
| `FFXIV_TexTools_UI/` | [FFXIV_TexTools_UI](https://github.com/TexTools/FFXIV_TexTools_UI) (app + **ConsoleTools**) | `b96139d3c2bbe8d8fa7ace94c9a9f00d1b500c40` | **tag v3.1.1.4** |
| `FFXIV_TexTools_UI/lib/xivModdingFramework/` | [xivModdingFramework](https://github.com/TexTools/xivModdingFramework) (most ported logic) | `8e2a2603f963ceb38062798c128b7f4efd966e11` | submodule pin @ v3.1.1.4 |
| `bc7enc_rdo/` | [bc7enc_rdo](https://github.com/richgel999/bc7enc_rdo) (BC7 codec reference) | `dbe416d28a5530b4e8cc45b14bf034dc6b96bbde` | — |
| *(not vendored)* | [SixLabors/ImageSharp](https://github.com/SixLabors/ImageSharp) (resampler/blur/compositing reference) | tag `v2.1.11` | — |

Unlike the three vendored rows above, ImageSharp is **not vendored under `reference/`** — it's a NuGet
dependency of xivModdingFramework (`SixLabors.ImageSharp` v2.1.11, pinned in
`xivModdingFramework.csproj:37`), so its source isn't part of the submodule pin above (verified
unchanged across the re-pin). We read it directly from the `SixLabors/ImageSharp` GitHub repo at
tag `v2.1.11` (the version the pinned xivModdingFramework references). `src/tex/imagesharp/` ports
the specific resamplers (Bicubic/NearestNeighbor `Resize`), `BoxBlur`, and Porter-Duff compositing
(`DrawImage` `SrcOver`/`SrcAtop`) that `EndwalkerUpgrade.ConvertEyeMaskToDiffuse` calls — not all of
ImageSharp.

`xivModdingFramework` is vendored as the **real git submodule** of `FFXIV_TexTools_UI`
(at `lib/xivModdingFramework`), so the parent's pin *enforces* the correct commit — the
two can't silently drift apart. It was formerly a separate side-by-side clone tracking
`master` (ahead of the release); before the `v3.1.0.2` baseline it was rolled back from
`master` to that pin so the read source matched the oracle then in use. That rollback
required **no ported-code changes**: the core transform (`EndwalkerUpgrade.cs`) and every
codec (`Mdl.cs`/`TTMP`/`Dat`/`DDS`/`Tex`/`ShaderHelpers`/…) were byte-identical between
`master` and `v3.1.0.2`; the only `master`-side differences in files we cite were unported
subsystems (item catalogs, install-time auto-assign) and the additive PMP "Combining"
group feature. The repo has since moved on from that `v3.1.0.2` baseline to the
`v3.1.1.4` baseline recorded above, which changed the Combining picture: the port now
**refuses** a Combining group at the write seam, reproducing upstream's own throw
(design §10 row 2). Carrying the group opaquely via `raw` remains true of everything
BELOW that refusal — we accept the `Type`, never model `Containers`, and throw on write.

**Incremental upgrade.** To move to a newer TexTools release: add the release to
`scripts/lib/oracle-releases.ts` (asset URL + a verified sha256) and run
`npm run setup-oracle -- <tag>` to provision it under `reference/oracle/<tag>/`; then, in
both `reference/FFXIV_TexTools_UI` and its submodule (both clones are shallow, so fetch
the tag first — `git -C reference/FFXIV_TexTools_UI fetch --depth=1 origin tag <tag>`,
`git -C reference/FFXIV_TexTools_UI checkout <tag>`,
`git -C reference/FFXIV_TexTools_UI submodule update --init --depth=1`), which moves
`lib/xivModdingFramework` to that release's pin; then wipe the three caches
(`test/corpus/.oracle-cache/`, `test/corpus/.upgrade-cache/`, and
`test/corpus/.resave-cache/`), re-bless the ratchet baselines, and port only the
upstream diff between the old and new pins.

**Snapshot `test/corpus/.roundtrip-baseline/` before that bless and diff it after.**
`UPDATE_UPGRADE_BASELINE=1` re-blesses all three baselines, and the roundtrip one records
our codec contradicting *itself* with no oracle involved — so an oracle re-pin must not move
it, and the bless would otherwise silently absorb a regression that the baselines being
gitignored keeps `git` from showing. Any movement is investigated, never blessed away. See
`docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §7.2.

## Development

- **Format + lint:** `npm run check` (Biome owns formatting; don't hand-format).
- **Typecheck:** `npm run typecheck`
- **Test:** `npm test`
- **Build:** `npm run build`

A pre-commit hook (lefthook) runs Biome on staged files and a whole-project
typecheck. The full test suite runs at end-of-task, not on push — see
[`AGENTS.md`](./AGENTS.md).

After cloning, opt in to clean blame across the one-time formatting reflow:

    git config blame.ignoreRevsFile .git-blame-ignore-revs
