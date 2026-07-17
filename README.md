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

**Baseline: TexTools `v3.1.0.2`.** The oracle is the *installed* ConsoleTools
(`test/helpers/oracle.ts:17`),
`C:\Program Files\FFXIV TexTools\FFXIV_TexTools\ConsoleTools.exe`, ProductVersion
`1.0.0+b83feb57…` — i.e. FFXIV_TexTools_UI tag `v3.1.0.2`. `reference/` is pinned to
match it exactly:

| Path in `reference/` | Repo | Commit | = |
|----------------------|------|--------|---|
| `FFXIV_TexTools_UI/` | [FFXIV_TexTools_UI](https://github.com/TexTools/FFXIV_TexTools_UI) (app + **ConsoleTools**) | `b83feb57b59a8f061ee458e9e8b416a99225110b` | **tag v3.1.0.2** |
| `FFXIV_TexTools_UI/lib/xivModdingFramework/` | [xivModdingFramework](https://github.com/TexTools/xivModdingFramework) (most ported logic) | `e20179a014ab86269e8f4da3762be1003bc611ab` | submodule pin @ v3.1.0.2 |
| `bc7enc_rdo/` | [bc7enc_rdo](https://github.com/richgel999/bc7enc_rdo) (BC7 codec reference) | `dbe416d28a5530b4e8cc45b14bf034dc6b96bbde` | — |
| *(not vendored)* | [SixLabors/ImageSharp](https://github.com/SixLabors/ImageSharp) (resampler/blur/compositing reference) | tag `v2.1.11` | — |

Unlike the three vendored rows above, ImageSharp is **not vendored under `reference/`** — it's a NuGet
dependency of xivModdingFramework (`SixLabors.ImageSharp` v2.1.11, pinned in
`xivModdingFramework.csproj:37`), so its source isn't part of the submodule pin above. We read it
directly from the `SixLabors/ImageSharp` GitHub repo at tag `v2.1.11` (the version the pinned
xivModdingFramework references). `src/tex/imagesharp/` ports the specific resamplers
(Bicubic/NearestNeighbor `Resize`), `BoxBlur`, and Porter-Duff compositing (`DrawImage`
`SrcOver`/`SrcAtop`) that `EndwalkerUpgrade.ConvertEyeMaskToDiffuse` calls — not all of ImageSharp.

`xivModdingFramework` is vendored as the **real git submodule** of `FFXIV_TexTools_UI`
(at `lib/xivModdingFramework`), so the parent's pin *enforces* the correct commit — the
two can't silently drift apart. It was formerly a separate side-by-side clone tracking
`master` (ahead of the release); it was rolled back to the `v3.1.0.2` pin so the read
source matches the oracle. That rollback required **no ported-code changes**: the core
transform (`EndwalkerUpgrade.cs`) and every codec (`Mdl.cs`/`TTMP`/`Dat`/`DDS`/`Tex`/
`ShaderHelpers`/…) are byte-identical between `master` and `v3.1.0.2`; the only
`master`-side differences in files we cite are unported subsystems (item catalogs,
install-time auto-assign) and the additive PMP "Combining" group feature, which our port
carries opaquely via `raw`.

**Incremental upgrade.** To move to a newer TexTools release: install that ConsoleTools,
read its ProductVersion `+hash`, check out `reference/FFXIV_TexTools_UI` at the matching
tag and `git submodule update` (which moves `lib/xivModdingFramework` to that release's
pin), regenerate the goldens, then port only the upstream diff between the old and new
pins.

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
