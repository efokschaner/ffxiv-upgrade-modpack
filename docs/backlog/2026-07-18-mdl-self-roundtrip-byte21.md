# SQPack model encode writes unused-LoD offsets as end-of-data instead of `0`

Filed: 2026-07-18 · Status: open · ratcheted in `test/corpus/.roundtrip-baseline/` (the ONLY
non-empty entry across 81 packs — every other pack's baseline is `[]` and rejects any divergence)

Surfaced by adding `torn bassment glow.pmp` to `test/corpus/real/`. Unrelated to the FileSwaps work
that brought the pack in.

**Symptom.** `test/helpers/corpus-sqpack.ts`' self round-trip
(`decodeSqPackFile(encodeSqPackFile(x, Model))`) fails on
`chara/equipment/e0246/model/c0201e0246_top.mdl`: `1362688` vs `1362756` bytes.

**Diagnosis (measured, not hypothesised).** The model has `lodCount = 1`, so LoDs 1 and 2 are
unused. The original stores their offsets as `0`; our round-trip rewrites them to the file length:

    field              original     round-tripped
    vertexOffset[1]           0           1362688
    vertexOffset[2]           0           1362688
    indexOffset[1]            0           1362688
    indexOffset[2]            0           1362688

Every populated field (`version`, `stackSize`, `runtimeSize`, `vertexOffset[0]`, `indexOffset[0]`,
all buffer sizes, `lodCount`) is byte-identical. `1362688` is exactly the input length, which is also
where the `+68` total growth comes from.

So the encoder appears to compute each LoD's offset as a running end-of-data cursor without the
"unused LoD stays `0`" case. Find the offset-assembly site (`src/mdl/geometry/offsets.ts`,
`src/sqpack/`) and check it against the C# that writes these fields (`Mdl.cs`) — **port the C#
condition, do not invent a `lodCount` guard from this item's description.**

**Why the existing 68-byte allowance does not cover it.** `corpus-sqpack.ts:114-138` tolerates the
benign Type-3 non-idempotency (a PMP-stored `.mdl` lacks the reserved runtime padding the decode
canonically appends, so `decode(encode(x))` is `x` plus 68 zero bytes). `isTrailingZeroGrowth`
requires **all three** of byte-exact prefix, exactly `+68`, and an all-zero tail. This case satisfies
two — right delta, right tail — but diverges at byte 21 (inside `vertexOffset[1]`). The guard worked
as documented ("Any other Type-3 divergence is a hard failure"): it caught a real bug wearing the
benign case's size signature. **Do not widen `isTrailingZeroGrowth` to tolerate a prefix mismatch** —
that retires the only check standing between us and an arbitrary Type-3 encode bug.

**Possible severity beyond the round-trip.** `/upgrade` rewrites `.mdl` files (the v6 bump), so
emitted models may carry these bogus offsets. Whether they do is **not currently observable for this
pack**: the default-only option-prefix bug
(`docs/backlog/2026-07-18-default-only-pmp-option-prefix.md`) renames every member, so the golden
diff reports `added`/`removed` name pairs and never content-compares them. Fixing the prefix bug will
expose whatever content divergence is hiding behind it. Treat that as a reason to fix the prefix bug
first, and do not read this pack's blessed baseline as evidence that its `.mdl` content matches.

**Working on it:** delete this pack's entry from `test/corpus/.roundtrip-baseline/` to make the check
fail hard again. When fixed, leave the entry deleted rather than re-blessing — the goal state is an
all-`[]` baseline set, which rejects any divergence outright.
