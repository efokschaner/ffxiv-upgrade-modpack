# Design: make `option.files` a `Map<string, ModpackFile>` (mirror the C# `Dictionary`)

Date: 2026-07-15 · Status: approved-pending-review

Foundation / roadmap: `docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md`.
Backlog item this closes: `docs/backlog/2026-07-15-option-files-map.md` (top of the prioritized list).

## Problem

`ModpackOption.files` (`src/model/modpack.ts`) is a `ModpackFile[]`. Its C# counterpart,
`WizardStandardOptionData.Files` (`WizardData.cs:71`), is a
`Dictionary<string, FileStorageInformation>` keyed by game path. The array is the odd shape out:

- **Not a structural mirror.** The whole port navigates by the C# map (AGENTS.md: "read like the
  source, port behaviour, cite provenance"). Every upgrade round is written against a dictionary —
  `files.ContainsKey(path)` / `files[path]` / `files.Add(path, info)`
  (`EndwalkerUpgrade.cs:1840/:1852/:1867`; UpdateSkinPaths `.Add`, `ModpackUpgrader.cs:487-497`).
  Against our array each becomes a `.some()` / `.find()` / `.push()` scan a reader has to re-map back
  to the C# — a traceability tax at every call site, and an O(n) membership scan (worst-case O(n²) in
  `updateSkinPaths`) where C# is O(1).
- **The array can hold something the dictionary cannot** — two files with the same game path in one
  option. C#'s TTMP load collapses a repeated `FullPath` **last-write-wins** (`WizardData.cs:729-737`);
  our reader keeps both. That is a latent divergence hiding behind green byte-parity today.

Origin: a code-review note on the O(n) `option.files.some(...)` scan in `updateSkinPaths`, widened to
the underlying model-shape question.

## Why now / why it's safe

The backlog item filed this as a **decision**, gated on one question:

> Does any real load path produce two files with the same `gamePath` within one option, where
> TexTools' `Dictionary` collapses them and our array keeps both?

**Resolved.** The C# TTMP load path handles the duplicate explicitly and deterministically —
last-write-wins (`WizardData.cs:729-737`):

```csharp
if (data.Files.ContainsKey(mj.FullPath))
    data.Files[mj.FullPath] = finfo;   // later ModsJson overwrites earlier
else
    data.Files.Add(mj.FullPath, finfo);
```

The simple-pack path routes the flat `SimpleModsList` through the *same* `FromWizardGroup`
(`WizardData.cs:1224` builds one option whose `ModsJsons = mpl.SimpleModsList`), so it has the same
collapse semantics. PMP cannot hit the case at all (its source `Files` is already a dict, read via
`Object.entries` — `pmp.ts:118`).

This makes the decision independent of whether any *real* corpus mod trips it: a `Map` built by
`.set(gamePath, file)` in source order **reproduces C#'s last-write-wins collapse for free**, so we
match TexTools whether or not a duplicate ever appears. The gating question is therefore no longer a
correctness blocker — it only decides whether we owe *positive test coverage* of the collapse (see
Testing).

## Decision

1. **`ModpackOption.files: Map<string, ModpackFile>`**, keyed by game path — the exact mirror of
   `Dictionary<string, FileStorageInformation>`. Map iteration order is insertion order, preserving
   the load-bearing option-by-option / file-by-file order (below).

2. **Drop `gamePath` from the `ModpackFile` value.** This is the "closer to C#" half of the decision,
   per the operator's steer to match the C# structure. `FileStorageInformation`
   (`TransactionDataHandler.cs:42-47`) carries **no game path** — only `StorageType`, `RealOffset`,
   `RealPath`, `FileSize`; the game path lives *only* as the `Dictionary` key. So the faithful value
   type has no path field, and the Map key is the single source of truth.

   `ModpackFile` remains a pragmatic union (it inlines `data` bytes and carries round-trip `ttmp`
   metadata that live elsewhere in C#), so this does not make it a pure `FileStorageInformation`
   mirror — it makes the *keying* faithful, which is what this item is about.

### Alternative considered and rejected: keep `gamePath` in the value

Keeping `gamePath` as a redundant field (`key === value.gamePath` invariant) is far lower churn —
all ~23 `.gamePath` read-sites stay untouched. It was rejected because the operator's instruction was
explicitly "match the C# data structure, whichever option is closer", and the C# value has no path.
The cost of the faithful choice is real and is accounted for below (the `allFiles` return-type ripple).

## Where the path re-attaches: `allFiles` mirrors `FileIdentifier`

Downstream consumers that legitimately need the path *as data* — the diff harness (`byGamePath`), the
TTMP blob builder + `ModsJsons` emitter, the PMP writer — currently get it from `f.gamePath` via
`allFiles`. With the path gone from the value, `allFiles` must carry it alongside each file.

This is exactly what C# does. At the write seam it flattens the per-option dicts into
`FileIdentifier { Path = key, Info = value, OptionPrefix }` (`PmpExtensions.cs:603-608`). So:

- **`allFiles(data)` returns `Array<{ gamePath: string; file: ModpackFile }>`** (mirroring
  `FileIdentifier`'s `Path` + `Info`), replacing today's `ModpackFile[]`. Its call sites (the diff
  harness, `writeTtmp2`/`buildBlob`, etc.) destructure the pair.

## Invariants that must survive the change

1. **Insertion order = C# `Dictionary` insertion order.** `resolveDuplicates`
   (`src/container/resolve-duplicates.ts`, header point 3) depends on files being visited
   option-by-option, file-by-file in insertion order — it drives the `common/N` member numbering of a
   written PMP. C# enumerates its `Dictionary` in insertion order and never removes
   (`PmpExtensions.cs:503-551`). A JS `Map` preserves insertion order, so this is preserved **iff**
   every mutation maintains order:
   - Readers `.set(path, file)` in source order (`ModsJsons` order for TTMP, `Object.entries(Files)`
     order for PMP). `Map.set` on a **new** key appends; on an **existing** key it updates in place
     **without moving** the key — which is exactly the array's `findIndex`-replace behaviour today
     (`texture.ts:136-138`) and C#'s indexer assignment.
   - The round transforms that rebuild the collection (`materialRound`/`modelRound`/`metadataRound`,
     `upgrade.ts:159/221/240`) must rebuild a Map in iteration order, not reorder.

2. **Last-write-wins collapse on read.** The TTMP reader building the Map via `.set` in `ModsJsons`
   order *is* the C# collapse (`WizardData.cs:729-737`). No extra code; it is a property of `Map.set`.
   Documented at the reader with the citation.

3. **`Map.set` == C# indexer/`Add`.** `updateSkinPaths` (`upgrade.ts:266-275`) transcribes to the
   canonical form: `if (option.files.has(target)) continue; option.files.set(target, {...})` — a 1:1
   port of `ContainsKey` + `.Add` (`ModpackUpgrader.cs:487-497`), and it closes the original O(n²)
   review note.

## Seams touched (high level — the plan enumerates exact edits)

- **Model** (`src/model/modpack.ts`): `files` type; drop `gamePath` from `ModpackFile`; `allFiles`
  return type → `{ gamePath, file }[]`.
- **Readers**: `ttmp2.ts` (`ModsJsons`/`SimpleModsList` → `.set` loop, documenting the collapse),
  `ttmp-legacy.ts`, `pmp.ts` (`Object.entries(Files)` → `.set` loop). Each drops the now-key
  `gamePath` from the file value.
- **Writers**: `ttmp2.ts` (`writeTtmp2`/`buildBlob`/`modOf` take the path from `allFiles`/entries),
  `pmp.ts` (`for (const [gamePath, f] of o.files)`; `reconstructOption`'s `Files[gamePath] = …`),
  `resolve-duplicates.ts` (`for (const [gamePath, file] of option.files)`).
- **Rounds** (`src/upgrade/`): `upgrade.ts` clone + the three `.map` rebuilds + `updateSkinPaths`;
  `texture.ts` (`.find` → `.get`, `.findIndex`/`.push` → `.set`); `texfix.ts` (`.filter` → rebuild
  or `.delete`).
- **Helpers/other**: `option-prefix.ts` (3 `.files` reads), `index.ts`, and the diff harness
  `test/helpers/upgrade-diff.ts` (`byGamePath` consumes `allFiles`' new pair shape).
- **Tests**: every fixture that builds an option `files` array becomes a `Map` (or a small
  `filesOf(...)` helper that builds one from entries).

## Testing

- **Byte-parity is the primary proof.** The `/upgrade` golden harness must stay byte-exact across the
  whole corpus — this is a structural refactor, not a behaviour change, so no golden may move and no
  `DIVERGENCE_RULES` entry is added. The `/resave` baselines must not regress. This is the gate.
- **Positive coverage of the last-write-wins collapse** (the resolved gating question). Today no test
  asserts it. Add a **synthetic unit test** on the TTMP reader: an option whose `ModsJsons` repeats a
  `FullPath` with different bytes must yield a single `files` entry carrying the *later* bytes
  (`WizardData.cs:729-737`). A synthetic *golden* pack is the richer option but the duplicate is a
  hand-authored `.mpl` construction a unit test pins more directly; prefer the unit test unless the
  plan finds a golden reaches it more cheaply.
- **Coverage check**: `npm run test:coverage` should show no newly-unreachable branch introduced by
  the reshape (report-only, no threshold).

## Out of scope

- The `WizardHelpers.WriteImage` re-encode, FileSwap handling, and other backlog items that also
  touch these files stay as-is (their fail-loud guards are preserved verbatim).
- No change to `ModpackFile`'s `data`/`ttmp`/`storage` fields beyond removing `gamePath`.
- The broader "other Dict-ported-as-array" audit (running in parallel) may file *new* backlog items;
  it does not expand this change.

## Risks

- **Byte-parity regression via mis-ordered mutation.** The mitigation is invariant 1 above plus the
  unchanged golden harness catching any reorder immediately.
- **Churn volume.** ~23 `.gamePath` sites + ~40 `.files` sites + tests. Mechanical but broad; the plan
  sequences it so the suite is green at each committable step.
