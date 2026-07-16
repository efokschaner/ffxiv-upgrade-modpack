# Make `option.files` a `Map<string, ModpackFile>` (mirror the C# `Dictionary`)

Filed: 2026-07-15 · Status: open

`ModpackOption.files` (`src/model/modpack.ts`) is a `ModpackFile[]`. Its C# counterpart,
`WizardStandardOptionData.Files` (`WizardData.cs:69-80`), is a
`Dictionary<string, FileStorageInformation>` keyed by game path. This item proposes changing the
port's model to a `Map<string, ModpackFile>` so it mirrors the C# structurally. It is filed as a
deferred **decision**, not a ready-to-execute task: the refactor is principled but must not be done
reactively — settle the gating question below first.

## Why consider it

- **Faithful structural mirror / traceability.** A JS `Map` is the same abstraction as the C#
  `Dictionary` — ordered, unique-keyed, O(1). The array is the odd shape out, and the project's
  whole ethos is "read like the source, port behaviour, cite provenance" (AGENTS.md).
- **Every round would read like the C#.** The upgrade code is full of `files.ContainsKey(path)` /
  `files[path]` / `files.Add(path, info)` (`EndwalkerUpgrade.cs:1840/:1852/:1867`; the
  `UpdateSkinPaths` `.Add`, `ModpackUpgrader.cs:487-497`). Against a `Map` these transcribe 1:1 to
  `.has` / `.get` / `.set`. Against the array each becomes a `.some()` / `.find()` scan a reader has
  to mentally re-map back to the C# — a traceability tax paid at every call site.
- **O(1) lookups (the origin of this item).** Removes the O(n) membership scans. This is *not* itself
  a strong reason — perf is negligible at real corpus option sizes — but it is a free side effect and
  it closes the code-review note that started the discussion (an O(n²) `option.files.some(...)` in
  `updateSkinPaths`, `src/upgrade/upgrade.ts`, vs. C#'s `Dictionary.ContainsKey`).
- **Forces correct duplicate-key handling.** A `Dictionary` cannot hold two files with the same game
  path; our array can. A `Map` makes us reproduce C#'s collapse behaviour (last-write-wins via the
  indexer, or throw on `.Add`) deliberately, instead of silently keeping both entries.

## Why it is deferred, not done

- **Repo-wide, invasive change over green, byte-parity-passing code.** `files` is consumed by every
  reader (`src/container/pmp.ts`, `ttmp2.ts`, `ttmp-legacy.ts`), every writer, `resolve-duplicates.ts`,
  `option-prefix.ts`, every upgrade round, `allFiles` (`src/model/modpack.ts`), and dozens of tests.
  AGENTS.md cautions against reshuffling already-merged, tested port code; the counterweight here is
  fidelity, not aesthetics, but the churn/regression risk is real.
- **Iteration order is load-bearing and must survive the change.** `resolveDuplicates` (point 3 of
  its header, `src/container/resolve-duplicates.ts`) depends on files being visited option-by-option,
  file-by-file in insertion order — that drives the `common/N` member numbering in a written PMP. A
  JS `Map` preserves insertion order, so this is preservable, but every mutation (`push` → `set`)
  must maintain it or byte-parity regresses.
- **The dup-key decision could silently regress output.** Switching naively to last-write-wins
  changes output wherever the array currently holds duplicate-path entries. Confirm which behaviour
  matches TexTools *before* flipping the model.

## The gating question — settle this first

Does any real load path produce two files with the same `gamePath` within one option, where
TexTools' `Dictionary` load collapses them and our array keeps both? PMP cannot hit it (its source
`Files` is already a dict — `pmp.ts` reads it via `Object.entries(o.Files)`). The candidate is the
TTMP `ModsList`, an ordered list: check what C#'s TTMP load does with a repeated `FullPath` (throw on
`.Add` vs. last-write-wins indexer) and whether our `ttmp2.ts` / `ttmp-legacy.ts` readers can emit the
duplicate at all.

- If **yes** → it is a real divergence. Per AGENTS.md ("a found divergence is a test-coverage gap"),
  author a synthetic pack (`scripts/generate-synthetics/`) that reproduces it; that failing golden
  justifies the `Map` (or a narrower collapse step at the reader) and pins the fix.
- If **no** → the `Map` is a pure traceability + O(1) improvement with no behavioural change:
  nice-to-have, not worth churning green code. Keep the array; if the O(n) scan is worth closing on
  its own, a local `Set<string>` of existing paths inside `updateSkinPaths` addresses the original
  review note without touching the model.

## Origin

A code-review note on `updateSkinPaths` (`src/upgrade/upgrade.ts`) flagged the O(n)
`option.files.some(...)` membership scan as worst-case O(n²) versus C#'s `Dictionary.ContainsKey`,
suggesting a `Set<string>`. The discussion widened it to the underlying model-shape question: whether
`option.files` should simply be a `Map` keyed by game path, like the C# `Dictionary` it ports.
