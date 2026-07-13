# `modelRound` propagates a model-normalizer throw and kills the whole pack; TexTools drops just the file

Filed: 2026-07-12 · Status: open — **deliberate for now**, revisit when coverage is broad

`src/upgrade/upgrade.ts` (`modelRound`) calls `requireBytes` + `normalizeModel` unguarded, so a
throw from `normalizeModel` (an unported/unparseable model structure) propagates out of
`upgradeModpack` and fails the entire `/upgrade`.

TexTools does not fail the pack here: every caller of `FixOldModel` on the `/upgrade` path wraps it
in `try { … } catch (Exception ex) { Trace.WriteLine(ex); continue; }` — `WizardData.cs:716-727`
(the one `ModpackUpgrader.cs:58 → WizardData.FromModpack` actually takes), and the same shape at
`TTMP.cs:741-754` and `:1380-1393` — and the `continue` skips the `data.Files.Add` a few lines below
(`WizardData.cs:729-737`), so the file is silently DROPPED from the option rather than killing the
pack.

Pre-existing (true before the absent-file-tolerance change; unrelated to it — an absent file can
never reach `modelRound` at all, since absent files are PMP-only and this round is gated off for PMP
by `needsMdlFix`/`DoesModpackNeedFix`, `TTMP.cs:916`).

**Deliberate, not an oversight:** fail-loud here is what exposes an unported model structure as a
loud failure during development instead of silently shipping a pack with a missing model — matching
TexTools' *outcome* (dropping the file) would require catching the normalizer's throw and removing
the file from the option, the same shape as `materialRound`'s per-file try/catch. Revisit once model
normalization coverage is broad enough that a throw here is more likely a real unported case than a
bug worth surfacing loudly.
