# Both C# loaders drop a zero-option group; our readers keep it

Filed: 2026-07-20 · Status: open · Found while porting the Single-group "none selected" backstop
that sits two lines below it (`docs/superpowers/specs/2026-07-20-ttmp2-mpl-manifest-fidelity-design.md`
§5, which scoped this out).

Both wizard-model group constructors bail out on an option-less group and return `null`, so the
group never enters `WizardPage.Groups` at all:

- `reference/.../Mods/WizardData.cs · WizardGroupEntry.FromWizardGroup · 749-753` (TTMP)
- `reference/.../Mods/WizardData.cs · WizardGroupEntry.FromPMPGroup · 851-855` (PMP)

Both read:

    if (group.Options.Count == 0)
    {
        // Empty group.
        return null;
    }

The net effect on both wizard paths is that a zero-option group is **dropped from the wizard model
entirely** — it is not re-emitted by `WriteModpack`, and it does not occupy a `MakeGroupPrefix` /
`MakePagePrefix` collision slot. But **the callers do not agree on how** that happens, and the
difference decides where a port of this has to land:

- **TTMP wizard** — `WizardPageEntry.FromWizardModpackPage` (`WizardData.cs:983-988`) discards the
  null at the call site: `if (g == null) continue;`. The group never enters `page.Groups`.
- **PMP** — `WizardData.FromPmp` calls `page.Groups.Add(await ...FromPMPGroup(...))`
  **unconditionally**, at both its sites (`WizardData.cs:1136` for the synthesized default group,
  `:1156` for the real ones), so a `null` *is* added to `page.Groups`. It is pruned later by
  `WizardData.ClearNulls` (`:1234-1266`), whose group loop is
  `if (g == null || !g.HasData) { p.Groups.Remove(g); continue; }` (`:1249`) — the one call is
  `data.ClearNulls()` at `:1159`, on the way out of `FromPmp`.
- **TTMP simple** — `WizardData.FromSimpleTtmp` (`:1229-1230`) also adds unconditionally, and
  **never calls `ClearNulls`**, so a null would survive in `page.Groups`. In practice it is
  unreachable: the group it builds is hand-constructed with exactly one option, so
  `FromWizardGroup`'s early return cannot fire.

`readTtmp2` (`src/container/ttmp2.ts`) and `readPmp` (`src/container/pmp.ts`) port neither early
return: an option-less group survives the read as a `ModpackGroup` with `options: []`.

## Why it has not bitten us

- No corpus pack — real or synthetic — carries a zero-option group, so the golden harness has never
  compared one. This is a *latent* divergence, not a baselined one.
- On the PMP write path it is already masked downstream, and **not incidentally**: `groupHasData`
  (`src/container/option-prefix.ts:105-107`) is `g.options.length > 0`, so `dataPages` filters the
  empty group out before prefixes are assigned. That is a port of `WizardGroupEntry.HasData`
  (`WizardData.cs:621-627`) as consumed by `ClearNulls:1249` — which, per the caller breakdown
  above, **is precisely the mechanism TexTools itself uses to drop an empty group on the PMP path**.
  So on PMP our output is closer to faithful than a "we don't port the early return" reading
  suggests: we reach the same end state by the same predicate, just at a different seam (write-time
  page building rather than load-time pruning).

  What is genuinely unported is the rest: the group still exists in `ModpackData.groups` for any
  direct consumer, and the TTMP path has no equivalent mask at all — there `FromWizardModpackPage`'s
  `continue` is the only mechanism, and we port neither it nor a `ClearNulls` stand-in.

## What is waiting on it

Task 1 of the `.mpl` manifest fidelity work added an `options.length > 0` guard to each backstop
seam **because of this gap** — the C# backstop is unreachable with zero options (the early return
fires first), so without the guard our transcription would index `options[0]!` on an empty array:

- `src/container/ttmp2.ts:184-190`
- `src/container/pmp.ts:258-264`

Both cite this early return in place. Two unit tests pin **our** behaviour (the empty group
survives), not TexTools':

- `test/container/ttmp2-selected.test.ts` — "a zero-option Single group does not trip the backstop"
- `test/container/pmp-selected.test.ts` — "Single: a zero-option group does not trip the backstop"

If the early return is ported, those guards become dead code (delete them and their comments) and
both tests must be rewritten to assert the group is **absent** rather than present-and-empty.

## Doing it

The early return is only half of it; the callers do the rest, and they differ. A faithful port has to
reproduce **both halves at the seam each one actually lives at**, rather than collapsing them into a
single "skip the push" at both readers:

- `readTtmp2` — port `FromWizardGroup:749-753`'s `return null` *and*
  `FromWizardModpackPage:986`'s `if (g == null) continue;`. Here a skip-the-push at the reader is
  the honest transcription, because that is exactly what the C# caller does.
- `readPmp` — port `FromPMPGroup:851-855`'s `return null`, but **not** as a skip-the-push:
  `FromPmp:1136,1156` add unconditionally and `ClearNulls:1249` prunes afterwards. Reproducing the
  C# control flow (AGENTS.md, "reproduce the C# control flow, not just its output") means the group
  is dropped by a `ClearNulls` equivalent, not suppressed at the add. Note this interacts with the
  existing `groupHasData` mask in `option-prefix.ts` — decide deliberately whether `ClearNulls`
  lands at load and the write-time mask becomes redundant, or the mask stays as the sole
  implementation; do not end up with two half-ports of the same pruning.
- `FromSimpleTtmp:1229-1230` needs nothing: it adds unconditionally with no `ClearNulls`, and its
  hand-built one-option group cannot trigger the early return. If we ever port a null-carrying shape
  here, note that TexTools would leak the null — reproduce, do not fix (and register it in
  `docs/TEXTOOLS_BUGS.md`).

Cite each site's own C# lines separately (these are distinct symbols; do not share a helper, per
AGENTS.md's "split, don't blend"). Add a synthetic modpack carrying an authored zero-option group so
the change is proven against a real ConsoleTools golden rather than only against our own reading;
the group should be absent from the golden's `TTMPL.mpl` / `default_mod.json` set entirely.
