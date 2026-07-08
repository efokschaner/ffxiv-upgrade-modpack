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

The port is a snapshot in time of specific upstream commits. Recording them lets us
do **incremental upgrades** later: bump the pins, diff upstream between old and new,
and port only what changed. `reference/` is gitignored (vendored third-party C#), so
these SHAs — not the working tree — are the record of what a given state of this repo
was ported against.

There are two distinct things to pin, and today they differ:

**1. The source we read and port from** (`reference/*`, read-only maps):

| Repo | Role | Commit | Date |
|------|------|--------|------|
| [xivModdingFramework](https://github.com/TexTools/xivModdingFramework) | the modding framework — most ported logic | `bbc7069c84b2ac9dcddaacb8a9c1877fcc0083cc` | 2026-05-25 |
| [FFXIV_TexTools_UI](https://github.com/TexTools/FFXIV_TexTools_UI) | the TexTools app; **ConsoleTools** (our CLI oracle) is a project within it | `6f4ababa2fc9a1f71c19f86296b92e0a3cc75214` | 2026-05-25 |
| [bc7enc_rdo](https://github.com/richgel999/bc7enc_rdo) | BC7 texture codec reference (used transitively for `.tex`) | `dbe416d28a5530b4e8cc45b14bf034dc6b96bbde` | 2026-02-26 |

(All on `master`; the clones carry no release tags, so commit SHAs are the pin.)

**2. The oracle binary that generates goldens** — the *installed* ConsoleTools, not
built from the clones above (`test/helpers/oracle.ts:17`):

- `C:\Program Files\FFXIV TexTools\FFXIV_TexTools\ConsoleTools.exe`,
  ProductVersion `1.0.0+b83feb57b59a8f061ee458e9e8b416a99225110b` — i.e. built from
  FFXIV_TexTools_UI commit `b83feb57…`.

> ⚠️ **Drift caveat.** The oracle's build commit (`b83feb57…`) is **not** the
> `reference/FFXIV_TexTools_UI` clone HEAD (`6f4abab…`) and is not even present in that
> clone. So the C# we *read* and the binary that *defines correct output* are not
> verified to be the same tree. Byte-parity is judged against the installed oracle; the
> `reference/` clones are the map. When upgrading, re-pin **both** together — check out
> the reference clones at the exact commit the installed ConsoleTools was built from
> (its ProductVersion `+hash`), regenerate the goldens, then port the upstream diff.

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
