// Builds test/corpus/synthetic/selection-type.ttmp2: a wizard TTMP declaring one group per
// SelectionType value, so ConsoleTools' /resave golden pins what TexTools does with each.
//
// WizardData.cs:652 compares against "Single" only, so an unrecognized value collapses to Multi.
// The golden confirms it: "Single" -> "Single", "Multi" -> "Multi", "Not A Real Type" -> "Multi".
// An absent SelectionType is covered by its sibling pack, build-synthetic-selection-type-absent.ts.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.

import { writeTtmp2Pack } from "./ttmp2-builder";

writeTtmp2Pack("selection-type.ttmp2", "SelectionType Repro", [
  { name: "Single", selectionType: "Single" },
  { name: "Multi", selectionType: "Multi" },
  { name: "Unrecognized", selectionType: "Not A Real Type" },
]);
