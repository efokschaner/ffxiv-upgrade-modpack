# Port `.meta`/`.rgsp` → `Manipulations` conversion on the PMP write path (currently: fail loud)

Filed: 2026-07-13 · Status: open

`writePmp` (`src/container/pmp.ts`) throws when an option's resolved zip paths include a `.meta` or
`.rgsp` file, rather than converting it to a `Manipulations` entry the way
`PopulatePmpStandardOption` does (`PMP.cs:891-900` → `PMPExtensions.MetadataToManipulations` /
`RgspToManipulations`, `PmpExtensions.cs:417`).

**Unreachable today:** a PMP-sourced model never holds a `.meta`/`.rgsp` (the upgrade load path
passes `mergeManipulations=false`, `WizardData.cs:818`, so manipulations stay opaque and are never
turned back into files), and a TTMP-sourced model can only reach the PMP writer through a TTMP→PMP
format conversion — which no upgrade flow performs (`WriteModpack` dispatches on the destination
extension and the GUI reuses the source's, `WizardData.cs:1312-1326`) and which `writeModpack`
(`src/index.ts`) already rejects outright as a cross-format write.

If TTMP→PMP conversion ever becomes a product feature, `/resave x.ttmp2 → y.pmp` is the ready-made
golden to pin the conversion against — no new harness plumbing needed, just a corpus pack run
through it.
