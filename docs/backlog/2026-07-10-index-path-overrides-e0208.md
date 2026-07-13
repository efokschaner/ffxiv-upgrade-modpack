# T4 — `index-path-overrides` table missing `chara/equipment/e0208` (and likely other) base-game entries

Filed: 2026-07-10 · Status: open (ratchet baselines the gap) · Fix is mechanical

`The_Final_Requiem_veil.ttmp2` overwrites base-game e0208 materials; the golden's index path uses the
canonical override (`EndwalkerUpgrade.cs:923-936`) but `src/upgrade/reference/index-path-overrides.ts`
has no e0208 c0101 entry, so we emit at the convention path (golden has `_met_id.tex` we don't →
`#0:added`) and the two e0208 `.mtrl` mismatch.

The index generation itself is byte-exact once pointed at the right path (triage-confirmed).

**Fix:** re-run `scripts/extract-index-overrides.ts` against a game install to widen the table.
