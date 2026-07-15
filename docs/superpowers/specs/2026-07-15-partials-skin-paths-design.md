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
    path. (TexTools re-derives `Name`/`Category` from the game path on write — an orthogonal,
    already-baselined `/resave` seam — so carrying `ttmp` through is faithful and parity-neutral.)

Appending new files is the same pattern the generated-texture round already uses
(`texture.ts` `writeGeneratedTex` pushes), which passes goldens today, so output member
ordering is already known-compatible.

**No encoder/divergence risk.** The aliased file is byte-identical to its source at a new path;
there is no pixel transform, so no `DIVERGENCE_RULES` entry is needed.

## 4. Data table

`src/upgrade/skin-repath-dict.ts` exports `SKIN_REPATH_DICT: ReadonlyMap<string, string>`,
built from a literal array of `[old, new]` pairs transcribed verbatim from
`SkinRepathDict` (`EndwalkerUpgrade.cs:2197-2246`). A `Map` (not a plain object) mirrors the
C# `Dictionary`'s `ContainsKey`/indexer semantics and sidesteps prototype-key pitfalls.

Only the **active** entries are ported (~45: base-game bodies, Bibo, TBSE bodies, Au Ra
tails). The large commented-out "norms" block below the active entries
(`EndwalkerUpgrade.cs:2248+`) is inactive in C# and is **omitted**, with a header comment
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
- **Real golden (corpus).** Skin/body mods (Bibo, TBSE) are among the most common mod types, so
  a real corpus pack very likely already exercises this and currently sits as a ratchet-baselined
  diff. After the port, **re-bless the baselines** and confirm the skin-path diff *shrinks* (the
  `_base.tex`/aliased entry now matches the golden) rather than assuming it. If no corpus pack
  hits it, note that and add a synthetic modpack builder under `scripts/generate-synthetics/`
  that includes a `--c….._d.tex` skin texture.

## 7. Backlog changes

- Rewrite `docs/backlog/2026-07-08-partials-round.md` to cover only what remains after this
  slice (hair + eye), or retire it in favour of the two new items below.
- File `docs/backlog/2026-07-15-partials-unclaimed-hair.md` — `UpdateUnclaimedHairTextures`
  (+ `UpdateUnclaimedHairAccessory`). Needs a bundled canonical hair/tail/ear/accessory material
  table (per material: normal/mask Dx11 sampler paths, shaderpack, material flags) extracted from
  a live DT install, plus a `FileExists` path-set; reuses the already-ported
  `updateEndwalkerHairTextures` pixel path and the `_SampleHair` constant source for the tail
  backface special-case.
- File `docs/backlog/2026-07-15-partials-eye-mask.md` — `UpdateEyeMask`. Needs a bundled iris
  `(race, face) → diffuse texture path` table (via the iris material) and the
  `ConvertEyeMaskToDiffuse` / `SwizzleRB` / DDS-conversion helpers (confirm which are unported).

## 8. Discovered, out of scope

`ResolveHighlightOptionsAndMashupHair` (`ModpackUpgrader.cs:83`, a **pre-round** run
unconditionally before round 1, *not* gated by `includePartials`) is also unported — our
`upgradeModpack` has no pre-round. It is unrelated to the partials round and out of scope here;
flag to the operator and file separately if confirmed reachable.
