# Writer always emits `FileSwaps: {}`; Penumbra omits the key when empty

Filed: 2026-07-18 · Status: open · Priority: unprioritized (documentation/coverage gap, not a known
live bug on any `/upgrade`-transformed pack) · Surfaced during the final-review pass on
`docs/superpowers/specs/2026-07-18-pmp-fileswap-preservation-design.md`

`src/container/pmp.ts:446` (`base.FileSwaps = o.fileSwaps`) unconditionally serializes the option's
`FileSwaps` map, so a swap-free option always round-trips as an explicit `FileSwaps: {}` key. Penumbra
itself — the actual author of a `default_mod.json`/`group_NNN.json` — does not: `SubMod.cs`'s
`WriteModContainer` (Penumbra repo, `Penumbra/Mods/SubMods/SubMod.cs:102-113`, a separate repository
from this project's `reference/`) only writes the `FileSwaps` property `if (data.FileSwaps.Count > 0)`
— the same `Count > 0` gate it applies to `Files` (`:86-100`). An empty map omits the key entirely.

**Where this surfaces today.** `Flower Child - by Solona.pmp` (real corpus, no FileSwaps at all) has a
`/upgrade` ratchet-baseline entry `default_mod.json#/FileSwaps | removed` — `jsonPointerDiff`'s
"removed" means present in ours, absent from the golden (`test/helpers/json-diff.ts:69`). `/upgrade`
no-ops on this pack, so the "golden" the harness diffs against is literally the pack's own original
(Penumbra-authored) bytes, not anything TexTools wrote — confirmed via
`test/corpus/.upgrade-cache/79a4e810ec43a2cc84806724659678c26a4f08da27f0b7450c91d84c0b2f8e47.noop`.
That source's `default_mod.json` simply never had a `FileSwaps` key; ours adds one.

**Why it does NOT affect a pack ConsoleTools actually rewrites.** `PmpStandardOptionJson`'s own
`ShouldSerializeFileSwaps()`/`ShouldSerializeFiles()`/`ShouldSerializeManipulations()` overrides
(`PMP.cs:1519-1524`) are commented out in the vendored TexTools source, with a `// TODO: Comment this
out in the future to mimic Penumbra's behavior` marker directly above them. So TexTools' *own* writer
currently emits `FileSwaps: {}` unconditionally too — matching our port. The asymmetry is therefore
purely a **no-op-comparison artifact**: it only appears when the "golden" is an untouched Penumbra
export rather than a TexTools-produced file, which is exactly the shape of `/upgrade`'s no-op branch
(`upgradeGoldenCached`'s `{ kind: "noop" }`, `test/helpers/upgrade-golden.ts`) and of `/resave`'s
load-then-write oracle for a pack whose swaps are otherwise untouched. If TexTools ever uncomments that
`ShouldSerializeFileSwaps` block (the TODO reads like an intent to do so), this would start showing up
on real `/upgrade`-transformed output too, not just no-ops.

**Unrelated to FileSwap preservation.** The spec's `dropConfirmedAbsentKeys` carve-out
(`test/helpers/upgrade-archive-diff.ts`, the `option()` function's swap block) only confirms the
*opposite* shape — golden `FileSwaps` empty, ours non-empty and populated (the real preserved-swap
divergence, §5.1). This bug's shape is "golden omits the key, ours writes `{}`" — both effectively
empty — which the carve-out's `Object.keys(oSwaps).length > 0` guard deliberately excludes, so it
correctly does not fire here; the diff falls through to the ratchet baseline instead.

## What to do

Mirror Penumbra's `Count > 0` gate: only set `base.FileSwaps` (and, if the same audit confirms `Files`
has the identical no-op-only exposure, `base.Files`) when the map is non-empty, omitting the key
otherwise. Needs its own pass, not a drive-by fix here:
- confirm whether any `Files`-count-zero option exists in the corpus (untested assumption above);
- re-bless `Flower Child - by Solona.pmp`'s `/upgrade` baseline (and check `/resave`'s) once fixed;
- decide whether to gate this on "is this option going through TexTools' write path at all" vs. always
  omitting when empty — the former would require distinguishing a no-op pass-through from an actual
  write, which today's architecture may not have a hook for.

Reference: `src/container/pmp.ts:446` · Penumbra repo `Penumbra/Mods/SubMods/SubMod.cs:82-113`
(`WriteModContainer`) · `reference/.../Mods/FileTypes/PMP.cs:1504-1524` (`PmpStandardOptionJson`, the
commented-out `ShouldSerialize*` block) · `test/corpus/.upgrade-baseline/79a4e810ec43a2cc84806724659678c26a4f08da27f0b7450c91d84c0b2f8e47.json`.
