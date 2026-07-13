# EQDP reconstruction drops mod rows for non-playable races (latent)

Filed: 2026-07-10 · Status: open (unreachable today — fails loud rather than dropping silently)

`reconstructMeta`'s EQDP step (`src/meta/reconstruct.ts`, round 5) emits exactly the 18
`Eqp.PlayableRaces` in canonical order (mod value or 0). C#'s `DeserializeEqdpData`
(`ItemMetadata.cs:773-788`) instead keeps *every* race the mod file carries and then backfills the
missing playable races — so a mod EQDP row for a **non-playable** race would be preserved by C# but
is not by our port.

Unreachable today: game EQDP files are playable-race-scoped, so no real `.meta` carries a
non-playable EQDP row (flagged in the round-5 final review as a latent fail-loud/fidelity asymmetry,
unlike the EST/IMC out-of-range cases which were made to throw).

Revisit only if a real pack ever exercises it; the honest fix is to keep the mod's extra rows
(matching C#) rather than drop or throw.
