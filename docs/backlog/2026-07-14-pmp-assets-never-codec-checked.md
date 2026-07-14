# The asset-level corpus checks silently skip every PMP pack

Filed 2026-07-14, found while profiling the test suite (the `assets` unit fold).

## What

The five asset-level corpus checks — `sqpack`, `mtrl`, `tex`, `mdl`, `geometry` — assert on **zero
files** for every PMP-sourced pack in the corpus. They do not fail and they do not skip: they run,
find nothing to look at, and go green.

The cause is a one-line filter. The shared decode (`test/helpers/corpus-decode.ts`,
`compressedFilesOf`, inherited from the old per-check `compressedFiles`/`mtrlFiles`/`texFiles`/
`mdlFiles`) selects only `FileStorageType.SqPackCompressed`:

```ts
allFiles(data).filter((f) => f.storage === FileStorageType.SqPackCompressed)
```

But a **PMP stores its game files `RawUncompressed`** — the payloads are plain zip members, not
SQPack entries (that is exactly why `writeModpack` refuses to write a `SqPackCompressed` file to a
PMP target, `src/index.ts`). So the filter matches nothing, and the checks iterate an empty list.

Observable in the suite's own log lines today — every PMP reports `of 0`:

```
[tex]  [DVNO] DMBX Shoes 1.pmp: 0 byte-exact, 0 decode-smoked, 0 unsupported-format, 0 legacy-skipped (of 0)
[mdl]  [DVNO] DMBX Shoes 1.pmp: 0 byte-exact, 0 legacy-skipped, 0 trailing-bytes (of 0)
[mtrl] [DVNO] DMBX Shoes 1.pmp: 0 exact, 0 normalized, 0 unstable, 0 semantic-break (of 0)
```

versus a TTMP2, which exercises them properly:

```
[tex] chained_collars_v1_1_0.ttmp2: 14 byte-exact, 4 decode-smoked, 0 unsupported-format, 0 legacy-skipped (of 14)
```

## Why it matters

The `.mtrl`/`.tex`/`.mdl` codec round-trips (`serialize(parse(x)) === x`) and the geometry
decode→encode symmetry check currently run **only on TTMP-sourced assets**. Every PMP pack's
materials, textures and models — a large slice of the corpus, and the *newer* half of it — are never
put through the codecs at all by these checks.

They are not entirely unverified: the `upgrade` and `resave` golden harnesses do decode PMP payloads
and diff them against ConsoleTools. But that is a *transform* oracle, not a codec round-trip: it only
covers files the upgrade actually touches, and it cannot catch a parse/serialize asymmetry in a file
the transform leaves alone. The per-asset checks exist precisely to close that gap for TTMP, and they
are absent for PMP.

## The fix

Make the shared decode storage-agnostic: yield `{gamePath, bytes, type}` for both storage kinds —
`decodeSqPackFile(f.data)` for `SqPackCompressed`, and for `RawUncompressed` the bytes as-is with the
type derived from the game path (`detectTypeFromGamePath` is already exported from `src/index.ts`).
The five check families then need no change; they already dispatch on `SqPackType`.

Deliberately **not** bundled into the perf work that found it: turning these checks on for ~14 PMP
packs is a coverage *expansion* that may well surface real failures (that is the point), and it
deserves its own change with its own baseline, not a silent widening inside a refactor whose whole
claim was "the test count is identical, only the decode is shared".

Note the absent-file case: a PMP `RawUncompressed` entry can legitimately carry no bytes (absent-file
design spec §3.1, `f.data === undefined`) — those must be skipped, not treated as empty payloads.
