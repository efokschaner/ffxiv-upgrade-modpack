# The geometry A2 golden cross-check silently skips PMP-sourced goldens

Filed 2026-07-14, found while turning on the PMP asset-level codec checks (the source-side gap that
change closed is the sibling of this one).

## What

The geometry check has two halves (`test/helpers/corpus-geometry.ts`): **A1** round-trips the
corpus *source* models, **A2** repeats the decode→encode symmetry on the cached `/upgrade` *golden*
(Float-format, proving the codec on normalized data too). A1 now runs over PMP source models — but
**A2 round-trips 0 models for every PMP-sourced golden**:

```
[geometry] Westlaketea's Constellation Crown ....pmp: A1 round-tripped 2 source model(s)
[geometry] Westlaketea's Constellation Crown ....pmp: A2 round-tripped 0 golden model(s)
[geometry] [Jaque] Romeo & Juliet ....pmp:            A1 round-tripped 6 source model(s)
[geometry] [Jaque] Romeo & Juliet ....pmp:            A2 round-tripped 0 golden model(s)
```

The cause is the same one-storage filter, in a *different* decode path. A2 decodes the golden
`ModpackData` itself via `goldenModels`, which iterates `compressedFilesOf` (SqPackCompressed only):

```ts
for (const f of compressedFilesOf(data)) {
  if (!f.gamePath.toLowerCase().endsWith(".mdl")) continue;
  const d = decodeSqPackFile(f.data);
  ...
}
```

The `/upgrade` golden of a **PMP** source is itself a PMP, so its models are `RawUncompressed` — the
filter matches nothing and A2 goes green over an empty list.

This is the sibling of the *source-side* gap fixed in the shared decode (`decodePack` /
`assetFilesOf` in `corpus-decode.ts`). That change deliberately did **not** touch A2, to keep the
source-side coverage expansion isolated with its own triage — A2 over PMP goldens (normalized
Float-format models the source A1 never sees) may surface its own geometry divergences.

## The fix

Make `goldenModels` storage-agnostic, the same way `assetFilesOf` is: for a `RawUncompressed` golden
entry use the bytes as-is (type from the game path via `detectTypeFromGamePath`), for a
`SqPackCompressed` one keep the `decodeSqPackFile` path; skip absent entries (`f.data === undefined`).
Consider factoring the shared "decode a ModpackData's models, storage-agnostic, tolerating an
undecodable legacy model" helper so A2 and the source decode cannot drift apart again.

Expect this to newly exercise the A1/A2 encoder/decoder over normalized PMP goldens; triage anything
it surfaces as a real geometry bug vs a documented divergence (`geometry-divergence.ts`).
