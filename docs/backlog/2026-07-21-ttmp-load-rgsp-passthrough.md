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

**Not yet known to be a real divergence.** ~~No corpus pack has been confirmed to carry a race/gender
scaling `.rgsp` entry~~, so whether this actually moves a golden (and whether TexTools' write side ever
re-materializes an `.rgsp`-derived manipulation the way `PMP.ManipulationsToMetadata` does for
`.meta`) is unverified. Filed as a known gap per AGENTS.md rather than a silent TODO; noted at the
load-fix call site (`src/upgrade/load-fixes.ts`).

## Update after the v3.1.1.4 re-pin — the blocking premise is gone

Updated 2026-08-07. The struck-through sentence above is **no longer true**, and the "To close"
prerequisite below is now **satisfied**.

`Milktruck Bust Scaling Tweaks v1.0.0.ttmp2` is exactly such a pack — 12 `.rgsp` files and nothing
else (`docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §1.1). It was in the
corpus all along, but ConsoleTools v3.1.0.2 could not `/resave` it (the patch-7.5 `human.cmp`
breakage), so it produced no golden and the pack was UNVERIFIED for its entire life. The re-pin fixed
that: it now has a real `/resave` golden (`.resave-cache/e51fa3e5….bin`).

**Empirical result — no recorded divergence.** Milktruck's resave baseline holds 3 entries, and all
three are manifest-level (`TTMPL.mpl#/ModPackPages`, `#/SimpleModsList`, `#/TTMPVersion`). None is
`.rgsp` payload, and all three are generic ttmp2 manifest drift shared with most of the corpus
(`ModPackPages` appears in 72 of 90 resave baselines, the other two in 25 each). So our verbatim
passthrough currently emits the same `.rgsp` bytes the oracle does.

**This does NOT discharge the gap, and must not be read as doing so.** TexTools does not pass the
file through: it decodes to manipulations on load, then on write fetches the game's *clean default*
parameter (`PMP.cs · ManipulationsToMetadata · 1335`, `CMP.GetScalingParameter(..., forceOriginal:
true)`) and applies the pack's manipulations over it (`:1347`) before re-serializing. That the result
matches our verbatim bytes means the decode→re-encode round-trip happened to be **lossless for this
input on this game version** — not that the two implementations are equivalent. Whether it is
lossless *by construction* depends on whether `RgspToManipulations` emits a manipulation for every
field of the struct; any field it does not cover would be silently reset to the game default by
TexTools while we preserve the pack's value. **Nobody has read that C# yet** — it is the same open
question this item was filed for, and one pack matching on one game version is evidence that the risk
is low, not proof that there is none.

**To close:** port `RgspToManipulations` (`PmpExtensions.cs`) analogously to `yieldsManipulations`,
determine whether an `.rgsp` should ever survive the load fix (it may always be manipulation-bearing,
unlike a housing `.meta`), ~~and find or build a corpus/synthetic pack that carries one to pin the
behaviour against a real golden before changing anything~~ — Milktruck now provides exactly that
golden, so the port can be pinned against it directly. Start by establishing whether
`RgspToManipulations` covers the full struct: that single question decides whether this is a
behaviour-preserving refactor or a live divergence waiting on the right input.

Note the inconsistency this leaves in our port, worth resolving in the same pass: the PMP **write**
path fails loud on a `.rgsp` (`src/container/pmp.ts:774` throws, unported-gap style), while this
**load** path silently passes one through. A throw would be wrong here — TexTools handles these packs
fine and every rgsp-bearing pack would break — so the resolution is to port the branch, not to guard
it.
