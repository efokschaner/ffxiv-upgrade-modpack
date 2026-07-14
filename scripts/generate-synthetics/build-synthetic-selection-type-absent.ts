// Builds test/corpus/synthetic/selection-type-absent.ttmp2: one group with the SelectionType key
// OMITTED entirely. Separate from selection-type.ttmp2 deliberately — this is the only input that
// could plausibly be rejected by ConsoleTools, and /upgrade's harness models only pack|noop, so an
// erroring pack would hard-fail it uncached every run (see docs/backlog/2026-07-11-expected-failure-
// golden.md). Isolating it keeps a rejection from taking the good pack's golden down with it.
//
// Predicted: Multi. A missing key deserializes to null, and `null == "Single"` (WizardData.cs:652)
// is an ordinary C# string value comparison — false, no dereference.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.

import { writeTtmp2Pack } from "./ttmp2-builder";

writeTtmp2Pack("selection-type-absent.ttmp2", "SelectionType Absent Repro", [
  { name: "No SelectionType" },
]);
