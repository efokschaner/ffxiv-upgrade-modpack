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

Each caller discards a `null` group, so a zero-option group is **dropped from the wizard model
entirely** — it is not re-emitted by `WriteModpack`, and it does not occupy a `MakeGroupPrefix` /
`MakePagePrefix` collision slot.

`readTtmp2` (`src/container/ttmp2.ts`) and `readPmp` (`src/container/pmp.ts`) port neither early
return: an option-less group survives the read as a `ModpackGroup` with `options: []`.

## Why it has not bitten us

- No corpus pack — real or synthetic — carries a zero-option group, so the golden harness has never
  compared one. This is a *latent* divergence, not a baselined one.
- On the PMP write path it is partly masked downstream: `groupHasData`
  (`src/container/option-prefix.ts:105-107`) is `g.options.length > 0`, so `dataPages` filters the
  empty group out before prefixes are assigned. That mask is incidental — it is a port of
  `WizardGroupEntry.HasData` / `ClearNulls`, a *different* symbol that happens to reduce to the same
  predicate — and it does not cover the TTMP write path or any consumer reading `ModpackData.groups`
  directly.

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

Port the early return at both seams — skip pushing the group when it has no options — citing each
site's own C# lines separately (they are two distinct symbols; do not share a helper, per
AGENTS.md's "split, don't blend"). Add a synthetic modpack carrying an authored zero-option group so
the change is proven against a real ConsoleTools golden rather than only against our own reading;
the group should be absent from the golden's `TTMPL.mpl` / `default_mod.json` set entirely.
