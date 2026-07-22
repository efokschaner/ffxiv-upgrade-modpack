# TTMP load fix does not handle `.rgsp`; it passes through unchanged (read side)

Filed: 2026-07-21 · Status: open

`makeTtmpLoadFix` (`src/upgrade/load-fixes.ts`) ports the `.meta` half of `WizardData.cs:685-698`'s
combined `mj.FullPath.EndsWith(".meta") || .EndsWith(".rgsp")` branch — it deserializes a `.meta`,
decides via `yieldsManipulations` whether it survives, and drops the manipulation-less ones. The
`.rgsp` half of that same C# branch (`:693-697`, `RacialGenderScalingParameter` →
`PMPExtensions.RgspToManipulations`) is unported: our load fix returns every `.rgsp` file unchanged,
the same as any ordinary file. In TexTools, `.rgsp` never reaches `data.Files` at all — like `.meta`,
it is deserialized and diverted straight into `data.Manipulations` at load, so it is unconditionally
absent from the loaded pack there.

This is a **different** gap from
[`docs/backlog/2026-07-13-pmp-write-meta-rgsp-manipulations.md`](2026-07-13-pmp-write-meta-rgsp-manipulations.md),
which is about the PMP **write** side (`writePmp` throwing instead of converting to `Manipulations`)
and is unreachable today because no upgrade flow performs a TTMP→PMP format conversion. This item is
the TTMP **read** side, and — unlike the write-side item — a TTMP pack carrying an `.rgsp` file is a
normal, reachable input.

**Not yet known to be a real divergence.** No corpus pack has been confirmed to carry a race/gender
scaling `.rgsp` entry, so whether this actually moves a golden (and whether TexTools' write side ever
re-materializes an `.rgsp`-derived manipulation the way `PMP.ManipulationsToMetadata` does for
`.meta`) is unverified. Filed as a known gap per AGENTS.md rather than a silent TODO; noted at the
load-fix call site (`src/upgrade/load-fixes.ts`).

**To close:** port `RgspToManipulations` (`PmpExtensions.cs`) analogously to `yieldsManipulations`,
determine whether an `.rgsp` should ever survive the load fix (it may always be manipulation-bearing,
unlike a housing `.meta`), and find or build a corpus/synthetic pack that carries one to pin the
behaviour against a real golden before changing anything.
