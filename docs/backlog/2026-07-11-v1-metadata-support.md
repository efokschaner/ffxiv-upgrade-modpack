# v1 metadata support

Filed: 2026-07-11 · Status: open (fail-loud guard in place; v1 is extinct in the wild)

`src/meta/deserialize.ts` throws on any `.meta` with `version !== 2` rather than silently
mis-upgrading it. An empirical probe (`scripts/probes/probe-v1-meta.ts`: downgrade a real pack's v2
equipment meta to v1 — `version=1`, EST/GMP stripped — run it through ConsoleTools `/upgrade`,
inspect the golden) confirmed ConsoleTools cleanly upgrades v1 → v2 by **injecting base-game data**
the v1 meta lacks, per C#'s `dataVersion==1` default-injection branches:

- `DeserializeEstData` (`ItemMetadata.cs:823-826`) defaults a missing EST segment to
  `Est.GetExtraSkeletonEntries(root)` — the est-table (`src/meta/reference/est-table.ts`) already
  supports computing this, so EST injection is portable today.
- `DeserializeGmpData` (`ItemMetadata.cs:851-855`) defaults a missing GMP segment to
  `GetGimmickParameter(root, true)` — this needs a **new per-item base-game GMP reference table +
  extraction**, which round 5 deliberately skipped (it extracted IMC/EST but not GMP). Without it, a
  v1 upgrade can't be reproduced faithfully.

Extinct in the wild (0 v1 metas across 1431 real corpus `.meta`s), so deferred behind the fail-loud
guard in `deserialize.ts` rather than ported. Re-run the probe script (still present, not wired into
the harness) to re-verify against a fresh ConsoleTools build if this is ever picked up.

`src/meta/serialize.ts` always writes version `2` on output regardless of input version
(`ItemMetadata.Serialize`, `ItemMetadata.cs:509`), so this is purely a read-side gap.
