// Builds test/corpus/synthetic/selection-type.ttmp2: a wizard TTMP declaring one group per
// SelectionType spelling, so ConsoleTools' /resave golden tells us what TexTools' reader+writer
// actually do with each — instead of us inferring it from WizardData.cs:652.
//
// Predicted (design spec §6.2): "Single" -> "Single"; "Multi" -> "Multi"; "Single Selection" ->
// "Multi" (the :652 comparison is against "Single" only, and "Single Selection" is a string no
// TexTools code has ever written — it was invented by this port from a doc-comment). If the oracle
// disagrees, the ORACLE WINS and the reader follows it.
//
// The .ttmp2 is gitignored; regenerate with `npm run synthetics`.

import { writeTtmp2Pack } from "./ttmp2-builder";

writeTtmp2Pack("selection-type.ttmp2", "SelectionType Repro", [
  { name: "Modern Single", selectionType: "Single" },
  { name: "Modern Multi", selectionType: "Multi" },
  { name: "Invented Legacy", selectionType: "Single Selection" },
]);
