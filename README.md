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
