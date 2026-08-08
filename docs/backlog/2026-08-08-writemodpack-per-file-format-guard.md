# `writeModpack`'s cross-format guard is per-FILE, so a fileless pack crosses formats silently

Filed: 2026-08-08 · Status: open · Surfaced by the Task 10 review during the v3.1.1.4 re-pin
(`src/container/ttmp2.ts`'s Combining port-gap guard cites this item).

## The defect

`writeModpack` (`src/index.ts:82-100`) is documented and relied on as the thing that stops a
cross-format write — a PMP-sourced model must not be written as a `.ttmp2`, and vice versa. It does
not actually check that. What it checks is:

```ts
const needed =
  target === "ttmp2" ? FileStorageType.SqPackCompressed : FileStorageType.RawUncompressed;
const bad = allFiles(data).find(({ file }) => file.storage !== needed);
if (bad) throw new Error("Cross-format conversion is not supported: ...");
```

The format is inferred **per file**, from each file's `storage`. A model carrying **no files at all**
has nothing to mismatch, `bad` is `undefined`, and the write proceeds into a writer that was never
meant to see that model. `ModpackData.sourceFormat` — which states the answer directly — is never
consulted.

## Measured

2026-08-08, during the Task 10 review: a PMP whose only group is a Penumbra `Combining` group with
empty `Containers` and an empty `default_mod` carries zero files. `writeModpack(data, "ttmp2")`
produced a **605-byte `.ttmp2`** rather than refusing. The same model through
`writeModpack(data, "pmp")` throws, correctly.

A fileless pack is not exotic: an options-only wizard pack, a pack whose every `Files` entry was
`canImport`-rejected, or a manipulations-only Penumbra mod all reach zero files while still carrying
real group/option structure that the wrong writer will mangle or silently reshape.

## Why it was not fixed in place

It predates the change that surfaced it (Task 10 only made one such model *loadable*), and the
immediate hole — a Combining group emitted as a `"Multi"` TTMP group with no data — is already closed
loudly at the seam that would have produced wrong output
(`src/container/ttmp2.ts`, `UnportedGapError`). Widening `writeModpack`'s contract is a separate,
larger question: it changes the refusal's *shape* for every caller, and the harness and
`test/container/*` fixtures build models by hand in both formats, so the blast radius wants its own
pass rather than a drive-by.

## What the fix probably looks like

Gate on `data.sourceFormat` (`src/model/modpack.ts`) — the field that already records the answer —
and keep the per-file storage scan as a secondary consistency assertion rather than as the primary
test. Note this is *not* purely additive: `writeModpack` is public API, and some tests construct a
`ModpackData` whose `sourceFormat` is set for convenience rather than accuracy
(e.g. `test/container/pmp-write.test.ts`'s `modeledData` helpers declare `ModpackFormat.Ttmp2` while
being written as PMP). Those need auditing in the same change, which is most of the work.

## Covering test to add with the fix

A fileless `ModpackData` of each `sourceFormat`, asserted to be refused by the *opposite* target —
the case that is green today for the wrong reason.
