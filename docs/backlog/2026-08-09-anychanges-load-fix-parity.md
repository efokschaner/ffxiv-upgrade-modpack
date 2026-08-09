# `ModpackUpgrader.AnyChanges` is unported: a load-fix-only pack is a TexTools no-op, but we rewrite it

Filed: 2026-08-09 · Status: open · Surfaced by the pre-Part-B fact-check of the v3.1.1.4 re-pin
(`docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §10 row 1).

## What TexTools does

`ModpackUpgrader.cs · UpgradeModpack · 70-86` snapshots each option's file dictionary into
`originals` from the data returned by `WizardData.FromModpack` — i.e. **after** the per-file load
fixes at `WizardData.cs · FromWizardGroup · 691-744` have already run. `:192-213` then compares the
post-transform dictionaries against that snapshot, and the outer overload writes an output pack only
`if (data.AnyChanges || rewriteOnNoChanges)` (`:244-247`); ConsoleTools `/upgrade` passes no
`rewriteOnNoChanges`, so a pack with no *transform*-stage change produces **no output file at all**.

The consequence is that the load fixes are structurally invisible to `AnyChanges`: a `.tex` repaired
by `ValidateTexFileData`, a `.mdl` normalized by `FixOldModel`, and a `.meta` diverted into
`Manipulations` are all already reflected in the baseline they will later be compared against. A pack
whose *only* defect is a broken mip-offset table is therefore reported as "no changes" and left
untouched on disk.

## What we do

`src/upgrade/upgrade.ts` has no `AnyChanges` equivalent — `upgradeModpack` always returns a pack, and
`writeModpack` always serializes one. For any pack whose only change is a load fix, TexTools writes
nothing and we hand back a rewritten pack carrying the repaired file.

This is a **seam-fidelity** divergence in the same family as the `.mdl` v6-bump and `.meta`
reconstruction findings (`docs/backlog/2026-07-13-resave-mdl-v6-bump-seam.md`,
`docs/backlog/2026-07-13-resave-meta-reconstruction-seam.md`) rather than a wrong-output bug: our
extra output is a *repair* TexTools also performs when it writes for another reason. It is recorded
because it is currently unrecorded anywhere, and because the ratchets cannot see it — a no-op pack is
compared against its own input, so the divergence only becomes visible on a pack that has a load-fix
defect and nothing else, which no corpus pack has.

## Partial parity already exists, for one case only

`src/upgrade/load-fixes.ts`'s `.meta` bullet (the `makeTtmpLoadFix` header comment) went out of its
way to preserve exactly this parity for manipulation-less `.meta` files: it drops them **at load**
rather than in the transform, "so its per-option file-set baseline is captured from the load result,
and in TexTools a manipulation-less `.meta` was never part of that file set to begin with". The same
comment already flags that the parity is partial for manipulation-*bearing* metas. The `.tex`-repair
and `.mdl`-normalize cases have the identical shape and were never considered.

## Deciding it

Three options, in rough order of size:

1. **Record and accept.** Argue the divergence is user-benefiting (a broken texture gets repaired
   rather than silently left broken) and confirm it where it becomes observable. Note this needs
   AGENTS.md's three-bar evidence test if it is ever to ship as a *deliberate* divergence rather than
   an unexamined one — including in-game verification.
2. **Port `AnyChanges` for reporting only.** Return a `changed: boolean` beside the existing
   `{ ok, data, diagnostics }` (`docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md`)
   so the site can say "this modpack needed no changes" without changing what we emit.
3. **Port it for behaviour.** Suppress the output pack entirely on `!anyChanges`, matching
   ConsoleTools. This is the byte-faithful option and the one that interacts with the site's UX (the
   page has to do something sensible when there is no file to hand back).

Whichever is chosen, the observable case needs a synthetic: an old-`TTMPVersion` pack carrying a
single broken-offset `.tex` and **nothing** upgradable. Note this is precisely the pack shape the
load-seam goldens had to *avoid* — `test/corpus/synthetic/load-seam-mipfix.ttmp2` and
`load-seam-npot.ttmp2` (2026-08-09) each carry a co-resident upgrading `.mtrl` for exactly this
reason, since without one ConsoleTools no-ops and emits no golden at all. Their builders
(`scripts/generate-synthetics/build-synthetic-load-seam-*.ts`) are therefore the closest starting
point: take one and delete the `.mtrl` + its bound textures.
