# Penumbra `Combining` groups are unported in both writers — a fail-loud guard waiting on a product decision

Filed: 2026-08-09 · Status: open

A `Combining` group loads (opaquely) and is refused by both writers. Neither refusal is a port gap in
the usual sense — **TexTools refuses one too** — but the deferral has never been recorded, which is what
this entry fixes.

## Current behaviour, verified 2026-08-09 against `Parent Settings.pmp`

A real Penumbra pack with 3 `Combining` groups (8 containers each) among 8 total:

- **Read** — loads fine (2 pages). The group survives to the writers, carrying its `Containers`
  (`PMP.cs:1562-1563`) opaquely; `src/container/pmp.ts:342-368` documents two deliberate non-ports at
  load (no `StandardData`/`ImcData` population, and no `Containers`-seeded ExtraFiles scan) and argues
  both are unobservable precisely because every write path refuses the group first.
- **`writePmp`** — throws `Editing or exporting PMP Combining groups is not supported.`, mirroring
  `WizardGroupEntry.ToPmpGroup` (`WizardData.cs:897-900`). **Faithful**: TexTools refuses here too.
- **`writeTtmp2`** — throws `UnportedGapError`, citing `WizardOptionEntry.ToModOption`
  (`WizardData.cs:425-428`, *"TTMP Export does not support one or more of the selected Option types."*)
  and stating that emitting it as a Multi group would silently drop the group's data. The C# refuses
  per-option; we refuse at the group, a seam difference the guard's own message records.

So there is no silent wrong output anywhere on this path today — the pack is refused loudly by both
targets, which is the correct behaviour for an unported feature.

## What is actually open

Two separable questions, neither answered:

1. **Do we want to support `Combining` at all?** Supporting it means doing something ConsoleTools
   refuses to do, so the golden harness has no oracle for the result — the same methodological problem
   [`2026-08-09-v4-pmp-input-refused.md`](2026-08-09-v4-pmp-input-refused.md) raises, and it should be
   answered once for both. Against: it is a product decision with no oracle. For: it is a mainstream
   Penumbra feature, and a public page that refuses every pack using it is a page that refuses a
   growing share of real mods.
2. **If not, is the refusal in the right place?** `writeTtmp2` refuses the whole write at the first
   Combining group; the C# refuses the *option*, inside `WizardData`'s per-option conversion. Whether
   TexTools' seam produces a partial pack rather than a refusal has not been traced, and if it does,
   ours is a divergence — an honest one, but unrecorded.

Same shape as [`2026-07-13-pmp-write-meta-rgsp-manipulations.md`](2026-07-13-pmp-write-meta-rgsp-manipulations.md):
a fail-loud guard that is correct today and blocked on a product decision rather than on porting effort.

## Reachability

Gated behind the v4 refusal exactly like its siblings: a Combining group is a v4-era Penumbra feature,
and `/upgrade` refuses `FileVersion > 3` before any of this is reached
(`src/upgrade/upgrade.ts:445-451`). Reachable today only through the `/resave` writer path, i.e. the
harness. It becomes a live product question on the day v4 input is accepted.
