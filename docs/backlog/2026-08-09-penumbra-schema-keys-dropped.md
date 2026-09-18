# Newer Penumbra group/option/meta keys are dropped on write — including behaviour-defining ones

Filed: 2026-08-09 · Status: open · **TexTools-faithful, so NOT a divergence** — see *Not a divergence*

`writePmp` rebuilds every manifest document from the typed model rather than carrying the source
through, so any key the C# classes do not declare is dropped. That is deliberate and correct as a port.
What is new is *which* keys a current Penumbra actually emits: some of them **define behaviour**, not
presentation.

## Measured 2026-08-09, on `Parent Settings.pmp`

A Penumbra feature-test pack (`FileVersion 4`, 8 groups) sourced from the official dev Discord. Its
`meta.json` carries keys no part of this port models:

| level | keys present | modelled? |
| --- | --- | --- |
| meta | `Identifier`, `LastWrite`, `Name`, `Author`, `Version`, **`RequiredFeatures`**, **`PageNames`**, `Groups`, `FileVersion` | `RequiredFeatures`, `PageNames` — **no** |
| group | `Type`, **`Id`**, `Name`, `Priority`, `Page`, **`Layout`**, **`Condition`**, **`ParentSetting`**, `Options` | `Id`, `Layout`, `Condition`, `ParentSetting` — **no** |
| option | `Id`, `Name`, **`Layout`**, **`Color`**, **`Condition`**, `Priority` | `Id`, `Layout`, `Color`, `Condition` — **no** |

Note what is *absent* as well: these groups carry no `Version`, `Description`, `Image` or
`DefaultSettings`, and the options carry no `Files`. This is a materially different document shape from
the `PMPGroupJson` the port models (`PMP.cs:1495-1518`), under the same `FileVersion: 4`.

`Condition` and `ParentSetting` are the load-bearing ones — they encode Penumbra's conditional-group /
parent-setting relationships ("Single Parent", "Single Child 1", "Complex Conditions" are the pack's
own group names). Dropping them does not corrupt a file; it **flattens a conditional mod into an
unconditional one**.

## Where the drop happens (verified by reading, not yet by round-trip)

- **Group** — `KNOWN_GROUP_KEYS` (`src/container/pmp.ts:1012-1026`) is an **allowlist**: `filteredRaw`
  keeps only those keys, and `groupJson` spreads `filteredRaw`. Anything else is gone.
- **Option** — `optionToJson` (`:650`) builds a fresh object from `Name`/`Description`/`Image`/`Files`/
  `FileSwaps`/`Manipulations`/`Priority`. Its own doc comment (`:644-649`) states the rationale: the C#
  option classes "own exactly … and nothing else, the same class of drop already proven for
  `meta.json`'s `DefaultPreferredItems`".
- **Meta** — `meta` (`:1175-1200`) is a fixed object literal. `data.meta.raw` is never spread in, so
  `RequiredFeatures` and `PageNames` do not survive.

**First step is to confirm this empirically**, which nothing does today: build a synthetic v4 pack
carrying `Condition`/`ParentSetting`/`Layout`/`Color` on a non-`Combining` group (a builder under
`scripts/generate-synthetics/`, so it flows through the normal harness), round-trip it, and diff. Read
by code alone the conclusion is clear, but this repo's standard is a test that would have caught it.
`Parent Settings.pmp` itself cannot serve — both writers refuse it for its `Combining` groups before
reaching the question.

## Not a divergence

TexTools drops these keys too: `PMPGroupJson` and the option classes declare none of them, and Json.NET
round-trips only what is declared. So reproducing the drop is *correct* under "byte-parity is the
definition of correct", and there is no golden diff to see. This item is filed because the behaviour is
**silent** and, unlike `DefaultPreferredItems`, the dropped data changes what the mod does — not
because the port is wrong.

Whether to eventually diverge (preserve the keys where TexTools discards them) is a user-benefit
divergence and needs all three AGENTS.md bars, including in-game verification. Do not treat it as a
free improvement.

## Reachability today, and the trigger that changes it

**Unreachable on the shipping path.** A pack carrying these keys is `FileVersion 4`, and `/upgrade`
refuses v4 outright (`src/upgrade/upgrade.ts:445-451`), so the user gets an honest refusal long before
the writer could drop anything. The drop is reachable only through the `/resave` writer path, which is
a test harness.

**The trigger is lifting that refusal** —
[`2026-08-09-v4-pmp-input-refused.md`](2026-08-09-v4-pmp-input-refused.md). On the day v4 input is
accepted, this becomes rubric class 1 (silent wrong output) with no further change: a conditional mod
would be upgraded into an unconditional one and the user would never be told. Closing this is therefore
a **precondition** of that item, not a follow-up to it.
