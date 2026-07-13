# Audit the port for TexTools bugs we already reproduce, and register them

Filed: 2026-07-12 · Status: open

`docs/TEXTOOLS_BUGS.md` is the register of upstream **bugs** (null derefs, dead guards,
non-terminating loops, lying exit codes) that we deliberately reproduce for byte-parity, or
deliberately don't reach, or fail loud on instead. It was seeded from the PMP absent-file
investigation plus a grep for existing `QUIRK` / `NRE` comments, so it is **not** exhaustive — it
captures what was in reach, not what is there.

Sweep `src/` (and the `reference/` C# it cites) for the rest and add an entry per finding.
Candidates to adjudicate on the way through, all of which are currently only noted in code comments:

- the EQP set-0 omission (`src/meta/reconstruct.ts`, `ItemMetadata.cs:522-528`);
- the `PlayableRaces` vs `PlayableRacesWithNPCs` race-order disagreement
  (`src/meta/playable-races.ts`, `Eqp.cs:48-92`);
- `MakePMPPathSafe`'s platform-dependent `Path.GetInvalidFileNameChars()` (`src/container/pmp.ts`,
  `PMP.cs:1316-1326`).

Each needs the bug-vs-quirk call the register's header describes — a faithfully transcribed SE
oddity is a quirk and stays a code comment; only a genuine defect gets an entry.

Useful both as a correctness audit (a reproduced bug we *think* we reproduce may not actually match)
and as the shortlist of patches we could offer upstream.
