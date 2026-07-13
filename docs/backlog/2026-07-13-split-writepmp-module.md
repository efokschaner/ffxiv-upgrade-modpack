# Split `writePmp` (`src/container/pmp.ts`) — it blends two different C# symbols into one TS module

Filed: 2026-07-13 · Status: open · Violates AGENTS.md's "split, don't blend"

`writePmp` merges `PMP.WritePmp` (`PMP.cs:830-928` — the zip assembly:
meta.json/default_mod.json/group_NNN.json/payload directory write, `ZipFile.CreateFromDirectory`)
with `WizardData.WritePmp` (`WizardData.cs:1460-1619` — the DataPages walk, default-mod absorption
search, `Page` renumbering, and the call into `PopulatePmpStandardOption` / `ResolveDuplicates`).

These are two separate C# methods in two separate files/classes; our port collapses them into one
function in one module, unlike the rest of the PMP write path (`option-prefix.ts` ports
`WizardData`'s prefix generators on their own, `resolve-duplicates.ts` ports
`PmpExtensions.ResolveDuplicates` on its own).

**Fix:** carve `writePmp` into

- `pmp-write.ts` — the `PMP.WritePmp`-shaped zip/JSON assembly (meta.json, default_mod.json,
  group_NNN.json serialization, the payload/ExtraFiles zip write); and
- `wizard-write-pmp.ts` — the `WizardData.WritePmp`-shaped orchestration (DataPages walk, absorption
  search, Page renumbering — already largely factored out into `buildPages` / `optionPrefixes`, this
  would just relocate the remaining orchestration currently still inline in `writePmp`).

Deferred out of the write-regeneration review (2026-07-13) as a pure reorganization with no
behavioral change — real risk is byte-for-byte parity regressions from a mechanical refactor with no
new test signal, so it needs its own careful pass rather than riding along with a correctness fix.

Bundle with `2026-07-13-buildpages-called-twice.md` — one signature change over the same code.
