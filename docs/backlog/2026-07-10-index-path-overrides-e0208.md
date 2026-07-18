# T4 — `index-path-overrides` table missing `chara/equipment/e0208` (and likely other) base-game entries

Filed: 2026-07-10 · Status: open (ratchet baselines the gap) · Fix is mechanical

`The_Final_Requiem_veil.ttmp2` overwrites base-game e0208 materials; the golden's index path uses the
canonical override (`EndwalkerUpgrade.cs:923-936`) but `src/upgrade/reference/index-path-overrides.ts`
has no e0208 c0101 entry, so we emit at the convention path (golden has `_met_id.tex` we don't →
`#0:added`) and the two e0208 `.mtrl` mismatch.

The index generation itself is byte-exact once pointed at the right path (triage-confirmed).

**More cases confirmed 2026-07-17** (corpus additions; the "and likely other" this item predicted):
the same convention-vs-canonical id-path split shows up beyond equipment — a **common** path
(`tightandfirmmaxfilia.ttmp`: golden `chara/common/texture/id_16.tex`, ours
`…/hair/h0133/texture/--c0201h0133_acc_id.tex`, same bytes) and a **monster** path (`Camp Site.ttmp2`:
golden `…/m8373/…/v01_m8373b0001_id.tex`, ours `v01_unknown_id.tex`, same bytes), each with the
referencing `.mtrl` mismatching. The widened extraction needs to cover common/monster id overrides,
not just equipment.

**Fix:** re-run `scripts/extract-index-overrides.ts` against a game install to widen the table.
