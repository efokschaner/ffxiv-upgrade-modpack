# Round 6 partials — slice 1: `UpdateSkinPaths`

Filed: 2026-07-15 · Foundation roadmap: [`2026-06-30-dawntrail-modpack-upgrader-design.md`](2026-06-30-dawntrail-modpack-upgrader-design.md) §8.2 "Round 6 — Partials".

## 1. Context & scope

Round 6 (the `includePartials` block, `ModpackUpgrader.cs:148-183`) is the last transform
round and is currently a no-op stub (`partials()` in `src/upgrade/upgrade.ts`). It bundles
three independent transforms, run per option in this order:

1. `UpdateSkinPaths` — alias old Endwalker skin/body/tail diffuse texture paths to their
   Dawntrail names via a static dict.
2. `UpdateUnclaimedHairTextures` (+ hair accessory) — texture-only hair/tail/ear heuristics.
3. `UpdateEyeMask` — iris mask → diffuse conversion.

**This spec covers only slice 1, `UpdateSkinPaths`.** It is the one transform of the three
that is self-contained: a static hardcoded dict and pure file-pointer aliasing, with **no
live game-index read, no texture decode, and no pixel math**. Slices 2 and 3 both depend on
reference tables extracted from a live Dawntrail install (plus, for eyes, texture-conversion
helpers that may be unported) and are refiled as their own backlog items (§7).

`ConsoleTools /upgrade` calls the `includePartials = true` overload (`Program.cs:179` →
`ModpackUpgrader.cs:212`), so `UpdateSkinPaths` **is part of the golden output** — this is a
byte-parity port, not speculative.

## 2. Provenance (C# sources)

| TS artifact | C# source |
| --- | --- |
| `SKIN_REPATH_DICT` data table | `EndwalkerUpgrade.SkinRepathDict` (`EndwalkerUpgrade.cs:2197-2246`, active entries only) |
| `updateSkinPaths(option)` transform | `ModpackUpgrader.UpdateSkinPaths` (`ModpackUpgrader.cs:484-500`) |
| `partials` seam (per-option iteration) | `ModpackUpgrader.cs:158`, `ForAllOptions(data, UpdateSkinPaths)` |

The two symbols come from two different C# files, so per "split, don't blend" they map to two
TS homes: the data table to its own module, the transform to `upgrade.ts` (which already maps
to `ModpackUpgrader` orchestration alongside `materialRound`/`modelRound`/`metadataRound`).

## 3. Behaviour (exact semantics)

C# (`ModpackUpgrader.cs:484-500`):

```csharp
var clone = new Dictionary<string, FileStorageInformation>(opt.Files);
foreach (var fkv in clone) {
    var file = fkv.Key;
    if (EndwalkerUpgrade.SkinRepathDict.ContainsKey(file)) {
        var target = SkinRepathDict[file];
        if (opt.Files.ContainsKey(target)) continue;
        opt.Files.Add(target, fkv.Value);   // duplicate the pointer
    }
}
```

For each file whose game path is a key in the dict, if the option does **not** already contain
the target path, add a new entry at the target path pointing at the **same** storage/bytes. It
never removes the source and never rewrites content — pure aliasing.

**Model adaptation.** Our `option.files` is a `ModpackFile[]`, not a `Dictionary`. The port:

- Snapshot the original `option.files` (mirrors C#'s `clone`).
- For each snapshot entry whose `gamePath` is a dict key: compute `target`; if no file with
  `gamePath === target` exists in the **growing** list, push `{ ...source, gamePath: target }`.
  - Checking against the growing list (not the snapshot) mirrors C#'s live `opt.Files.ContainsKey`.
    The dict's targets are unique, so this only matters in the degenerate two-keys-one-target
    case, but we match C# exactly.
  - `{ ...source, gamePath: target }` duplicates the pointer: it shares the source's `data`
    reference and copies `storage` and any `ttmp` metadata, exactly like `cloneFile` with a new
    path — the closest analogue to C#'s `opt.Files.Add(target, fkv.Value)`, which reuses the same
    `FileStorageInformation`.
  - **Manifest caveat (corrected 2026-07-15 after running the harness).** Carrying the source's
    `ttmp` metadata is faithful but NOT parity-neutral: the aliased file becomes a new
    `TTMPL.mpl` `ModsJsons` entry, and our `writeTtmp2` round-trips the carried `Name`/`Category`
    (and omits `ModPackEntry`) where TexTools re-derives `Name`/`Category` from the new game path
    and writes `ModPackEntry: null`. This is the **already-filed TTMP writer divergence**
    (`docs/backlog/2026-07-13-resave-ttmp2-name-category.md`,
    `…-missing-mpl-fields.md`) — the same divergence the pack's *original* files already exhibit —
    now reachable on one more file. The file **payload** is byte-exact; only the `.mpl` manifest
    metadata diverges, so it is handled by the ratchet baseline (§6), not a `DIVERGENCE_RULES`
    entry. Fixing it belongs to the writer backlog items, not this slice.

Appending new files is the same pattern the generated-texture round already uses
(`texture.ts` `writeGeneratedTex` pushes), which passes goldens today, so output member
ordering is already known-compatible.

**No encoder/divergence risk on the payload.** The aliased file's bytes are byte-identical to its
source at a new path; there is no pixel transform, so no `DIVERGENCE_RULES` entry is needed. (The
`.mpl` *manifest* entry for the new file does diverge, per the writer gap in the Manifest caveat
above — handled by the ratchet baseline, not `DIVERGENCE_RULES`.)

## 4. Data table

`src/upgrade/skin-repath-dict.ts` exports `SKIN_REPATH_DICT: ReadonlyMap<string, string>`,
built from a literal array of `[old, new]` pairs transcribed verbatim from
`SkinRepathDict` (`EndwalkerUpgrade.cs:2197-2246`). A `Map` (not a plain object) mirrors the
C# `Dictionary`'s `ContainsKey`/indexer semantics and sidesteps prototype-key pitfalls.

Only the **active** entries are ported (36: 10 base-game bodies, 5 Bibo, 5 TBSE bodies, 16 Au Ra
tails). The large commented-out "norms" block below the active entries
(`EndwalkerUpgrade.cs:2248-2280`) is inactive in C# and is **omitted**, with a header comment
noting why so a future reader does not "restore" it.

## 5. Orchestration seam

`partials()` gains the pack (`out.groups`) and iterates every option, calling
`updateSkinPaths(option)` — mirroring `ForAllOptions(data, UpdateSkinPaths)`. It stays the last
round in `upgradeModpack`, and `UpdateSkinPaths` runs first within it, before the (still-stubbed)
unclaimed-hair / eye-mask third round. The `unusedTextures`/`contained` computation
(`ModpackUpgrader.cs:150-155,171`) feeds only the hair/eye passes and is **not** needed here; it
lands with slice 2.

## 6. Testing

Per AGENTS.md's preference order (real golden > synthetic golden > synthetic unit test):

- **Durable pin (synthetic unit test).** `test/upgrade/skin-paths.test.ts`, cited from the C#,
  covering: (a) a matching source path adds the target with byte-identical shared data;
  (b) target already present → no-op (no duplicate); (c) multiple matching keys in one option →
  multiple additions; (d) non-matching files untouched; (e) source left in place (not moved).
  This survives a fresh clone where the corpus is empty.
- **Real golden (corpus) — observed 2026-07-15.** Three real corpus packs exercise the transform;
  all changes are `kind: manifest` (TTMPL.mpl), **zero file-payload divergences** — the aliased
  `.tex` bytes match the golden everywhere. Two simple TTMP packs **shrank** (their previously-
  baselined missing-`_base.tex` file diffs are now resolved; residual is only the pre-existing
  simple-pack manifest gap). One pack (Fantasia) **grew by +9** manifest entries: the aliased
  file's `ModsJsons` entry exhibits the *same* `Name`/`Category`/`ModPackEntry` writer divergence
  its original files already showed — no new divergence class. Baselines re-blessed to record it;
  a fresh clone (empty corpus) falls back to the synthetic unit tests above.

## 7. Backlog changes

- Retire the old umbrella partials item and split it into the two focused, pickup-cold items
  below (done in this change).
- File `docs/backlog/2026-07-15-partials-unclaimed-hair.md` — `UpdateUnclaimedHairTextures`
  (+ `UpdateUnclaimedHairAccessory`). **Shipped 2026-07-16** (see
  `docs/superpowers/specs/2026-07-16-unclaimed-hair-partials-design.md`): a bundled canonical
  hair/tail/ear/accessory material table (per material: normal/mask Dx11 sampler paths, shaderpack,
  flags) extracted from a live DT install doubles as the `FileExists` oracle, reusing the ported
  `updateEndwalkerHairTextures` pixel path and the `_SampleHair` constant source for the tail
  backface special-case. Backlog item retired.
- File the round-6 eye-mask partial backlog item — `UpdateEyeMask`. Needs a bundled iris
  `(race, face) → diffuse texture path` table (via the iris material) and the
  `ConvertEyeMaskToDiffuse` / `SwizzleRB` / DDS-conversion helpers (confirm which are unported).
  **Shipped** (see `docs/superpowers/specs/2026-07-16-eye-mask-partial-design.md` for the
  control-flow gate + iris table, and `docs/superpowers/specs/2026-07-16-eye-mask-pixel-pipeline-design.md`
  for the ImageSharp pixel pipeline that closed it, proven against a real ConsoleTools `/upgrade`
  golden). Backlog item retired.

## 8. Discovered, out of scope

`ResolveHighlightOptionsAndMashupHair` (`ModpackUpgrader.cs:83`, a **pre-round** run
unconditionally before round 1, *not* gated by `includePartials`) is also unported — our
`upgradeModpack` has no pre-round. It is unrelated to the partials round and out of scope here;
flag to the operator and file separately if confirmed reachable.
