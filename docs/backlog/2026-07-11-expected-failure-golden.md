# Expected-failure golden capability for the `/upgrade` harness

Filed: 2026-07-11 · Status: **done** — the `/resave` half landed 2026-07-13, the `/upgrade` half
2026-07-17. Kept (not deleted) as the durable design-rationale reference several shipped modules and
specs cite (the Milktruck `/resave` CMP case; why `/upgrade` never sees write-side oracle errors).

**Update (2026-07-17) — the `/upgrade` half is DONE, with a correction.** Modelling only `pack|noop`
was extended with `{kind:"error"}` + a `<sha>.error` marker, mirroring the `/resave` half — but the
`/resave` classifier reads the oracle error from **stdout/stderr**, and that does NOT work for
`/upgrade`: `ConsoleTools.HandleUpgrade` reports failures via `Trace.WriteLine(ex)`, not `Console`
(`Program.cs:185` vs `/resave`'s `:217`), so a genuine `/upgrade` error has empty stdout/stderr. The
shipped fix captures the **Trace channel** instead: ConsoleTools is configured (one-time, manual) to
write Trace to a home-dir log via a `TextWriterTraceListener`; the harness validates that config
(fail-loud), runs ConsoleTools at its install dir, and classifies a genuine `HandleUpgrade` exception
into `{kind:"error"}` (`test/helpers/oracle.ts` `upgradeWithTraceCapture`/`OracleUpgradeError`,
`upgrade-golden.ts`). Pass/fail differs from `/resave`'s loud-skip: a matched failure (oracle errors
AND our port throws) is a PASS, a mismatch a loud FAIL. See
`docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md` Part B.

The `/upgrade` golden harness models only two ConsoleTools outcomes: a produced **pack** or a
**noop** marker (`GoldenResult = { kind: "pack" } | { kind: "noop" }`,
`test/helpers/upgrade-golden.ts`). It has **no way to represent (or cache) an input on which
`/upgrade` is *expected to error***. When ConsoleTools returns `-1`, `execFileSync` throws inside
`run()` in `test/helpers/oracle.ts`, the exception propagates out of `upgradeGoldenCached` uncaught,
the test hard-fails, and nothing is cached — so every subsequent run re-spawns ConsoleTools and
throws again. There is no "bless this as an expected failure" path (the ratchet baseline only covers
known byte-diffs on a *produced* pack).

To assert "TexTools errors here and our port should error the same way," add: (1) a third
`GoldenResult` kind (e.g. `{ kind: "error", … }`) capturing the failure, (2) a cached error-marker
analogous to `<sha>.noop` so the outcome is content-addressed and not re-run, and (3) a bless path
to record it.

Originally recorded as a hypothetical: the only expected-failure case in flight was the
`Mdl.cs:2822` vertex-buffer hard cap, covered by a synthetic unit test that drives the serializer
directly (see `docs/superpowers/specs/2026-07-11-mdl-half-precision-fallback-design.md` §4.2-4.3).

## Update (2026-07-13): it appeared for real, on the `/resave` side

The `/resave` harness had the same two-outcome limitation, and one corpus pack tripped it:
**`Milktruck Bust Scaling Tweaks v1.0.0.ttmp2`** (the only pack of 63 with no `/resave` golden;
62/63 cached). ConsoleTools exits `-1` and `execFileSync` throws, so the unit hard-failed on every
run and nothing was cached. The pack is 12 `.rgsp` files (racial scaling) and nothing else. The
failure is in ConsoleTools' **write** path, and it is **environmental, not a defect in the pack or
in our port**:

    System.Exception: CMP Format Changed - Unable to read all CMP data.
       at xivModdingFramework.General.DataContainers.CharaMakeParameterSet..ctor(Byte[] data)
       at xivModdingFramework.General.CMP.GetScalingParameter(...)
       at xivModdingFramework.Mods.FileTypes.PMP.PMP.ManipulationsToMetadata(...)
       at xivModdingFramework.Mods.WizardOptionEntry.ToModOption(...)      [...]
       at xivModdingFramework.Mods.WizardData.WriteModpack(...)
       at ConsoleTools.ConsoleTools.HandleResaveModpack(...)

On write, TexTools converts each `.rgsp` into an RSP manipulation, which reads the **installed
game's** `human.cmp`; this TexTools build does not recognize the current game's CMP layout and
throws. `/upgrade` never hit it because `/upgrade` on this pack is a no-op — ConsoleTools writes
nothing, so `WriteModpack` is never reached.

**This is the real, general reason `/upgrade` can never see a whole class of write-side oracle
failures**, not a one-off: `/upgrade` only reaches TexTools' writer when the transform actually
changes something, so any pack whose upgrade happens to be a no-op gets a free pass on every defect
in TexTools' own writer, this CMP crash included. `/resave` always writes, so it is the only oracle
that can see this class at all.

## The `/resave` half is DONE (2026-07-13)

`resaveGoldenCached` (`test/helpers/resave-golden.ts`) gained a `ResaveGoldenResult = { kind:
"pack"; bytes } | { kind: "error"; message }` (mirroring `upgrade-golden.ts`'s `GoldenResult`),
catches a `produce()` throw, and caches it as a content-addressed `<sha>.error` marker (analogous to
`<sha>.noop`) so ConsoleTools is spawned at most once for this pack instead of throwing on every
run. `registerResaveCheck` (`test/helpers/corpus-resave.ts`) treats `{ kind: "error" }` as neither
pass nor generic skip: it `console.error`s a loud, explicit message naming the pack and the oracle's
error text, then calls `ctx.skip(message)` so the test reports as **skipped with a note**, not green
— the writer is explicitly UNVERIFIED for this pack, never silently treated as matching. Covered by
a focused unit test (`test/helpers/resave-golden.test.ts`) exercising the `opts.produce` injection
seam (no real ConsoleTools spawn).

## The `/upgrade` half is done too (correcting the section below)

**This section is now stale and is corrected here rather than left asserting something false.**
`upgradeGoldenCached` / `GoldenResult` (`test/helpers/upgrade-golden.ts`) gained the third outcome
during the PMP v4 work: `GoldenResult` is now `{ kind: "pack" } | { kind: "noop" } | { kind: "error";
message: string }` (`test/helpers/upgrade-golden.ts:31-33`), backed by a content-addressed `<sha>.error`
marker, exactly as this document originally called for. `corpus-upgrade.ts`'s golden check branches on
`golden.kind === "error"` (`test/helpers/corpus-upgrade.ts:503`) and asserts a **matched** failure —
our port must throw the same way ConsoleTools' oracle did — via `assertMatchedUpgradeFailure`, rather
than treating an oracle error as a skip the way the `/resave` side does (see the "still NOT done"
section immediately below, which is the original, now-superseded text, kept for history rather than
silently deleted).

The original text follows unmodified for context:

## The `/upgrade` half is still NOT done *(superseded — see the section above)*

`upgradeGoldenCached` / `GoldenResult` (`test/helpers/upgrade-golden.ts`) remains two-outcome
(`pack` | `noop`) with no `error` kind, so an `/upgrade` input on which ConsoleTools itself errors
would still hard-fail every run uncached, exactly as described above. No corpus pack currently
forces this on the `/upgrade` side (Milktruck's `/upgrade` is a no-op, so it never reaches
`WriteModpack` there), so it remains deferred until one does — extend `upgrade-golden.ts` the same
way (`{ kind: "error" }` + `<sha>.error` marker + loud skip in `corpus-upgrade.ts`) if/when it's
needed.

## Closing note (2026-08-07) — the Milktruck `/resave` failure is resolved

The `/resave` oracle error this document analyses (the "CMP Format Changed" throw on
`Milktruck Bust Scaling Tweaks v1.0.0.ttmp2`) was **environmental**, not a property of the pack: it
was the patch-7.5 `human.cmp` breakage in the pinned TexTools `v3.1.0.2` build — a hardcoded
`MetadataStart` offset that a later game patch's colour-region growth invalidated — described in full
in `docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §1.1.

It is **resolved by the re-pin to TexTools `v3.1.1.4`**, which carries upstream's back-anchored CMP
fix (`d731d744`, "Fix CMP RSP offset for patch 7.5" — spec §1.2). The pack now produces a real
`/resave` golden instead of throwing, and the suite's skip count is zero — `Milktruck Bust Scaling
Tweaks v1.0.0.ttmp2` was the suite's only `ctx.skip` site.

Milktruck's `/resave` writer is now compared against that real golden and records **3 diffs**, all
manifest-level: `TTMPL.mpl#/ModPackPages`, `#/SimpleModsList`, `#/TTMPVersion`. Notably, **none is
`.rgsp` payload**: our load path passes `.rgsp` files through verbatim, where TexTools decodes them
to manipulations on load and re-materializes them on write from the game's clean default parameter
plus those manipulations — a different code path that happens to land on the same bytes here. This is
**evidence the risk is low, not proof the gap is closed** — a byte match on one pack on one game
version does not establish that the two implementations are equivalent for every field. The gap
itself remains tracked separately, and does not overstate as "confirmed correct":
`docs/backlog/2026-07-21-ttmp-load-rgsp-passthrough.md` (now `docs/BACKLOG.md` priority 1).

This document is **kept, not deleted**: its analysis of why `/upgrade` can never see a whole class of
write-side oracle failures (the "real, general reason" paragraph above) remains the durable reference
the harness code and other specs cite. This is a closing note on one finding, not a retirement of the
file.
