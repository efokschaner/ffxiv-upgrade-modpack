// Builds test/corpus/synthetic/selection-type-absent.ttmp2: one group with the SelectionType key
// OMITTED entirely. A missing key deserializes to null, and `null == "Single"` (WizardData.cs:652) is
// an ordinary C# string value comparison — false, no dereference — so the group loads as Multi. The
// /resave golden confirms it, and that ConsoleTools accepts such a pack at all.
//
// It is a SEPARATE pack from selection-type.ttmp2 because it is the only input here ConsoleTools could
// plausibly reject, and /upgrade's harness models only pack|noop — an erroring pack hard-fails it,
// uncached, every run (docs/backlog/2026-07-11-expected-failure-golden.md). Isolating it keeps a
// rejection from taking the other pack's golden down with it.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.

import { writeTtmp2Pack } from "./ttmp2-builder";

writeTtmp2Pack("selection-type-absent.ttmp2", "SelectionType Absent Repro", [
  { name: "No SelectionType" },
]);
