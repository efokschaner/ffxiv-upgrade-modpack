# Metadata Round (Round 5) — Design

**Date:** 2026-07-10
**Status:** Design signed off; implementation not started.
**Roadmap:** Round 5 of the foundation design's burndown
(`2026-06-30-dawntrail-modpack-upgrader-design.md` §8.2). Supersedes that section's
"small codec, ~49 diffs" framing — see *What this round actually is* below.
**Goal:** Make our upgraded `.meta` output byte-identical to ConsoleTools `/upgrade`,
replacing today's opaque pass-through, by faithfully reproducing TexTools' metadata
re-materialization — including the minimal base-game reference data that requires.

---

## 1. What this round actually is (the scoping finding)

The roadmap scoped round 5 as a small `ItemMetadata` codec that backfills EQDP races.
A scoping spike (2026-07-10) proved that is **incomplete**: the golden `.meta` is not a
deserialize→serialize of the mod's own file — it is a full **re-materialization against
the current (Dawntrail) base game**.

### Why the golden `.meta` differs from the input

TexTools' internal modpack model (`WizardData`) is **Penumbra-compatible**: it represents
all metadata as **sparse manipulations** (per-entry deltas), not whole `.meta` files.
Every `/upgrade` round-trips each `.meta` through that model:

- **Read** (both `.ttmp2` and `.pmp`): `ItemMetadata.Deserialize` → `MetadataToManipulations`
  (TTMP via `WizardData.cs:685-691`; PMP via `PMP.cs:894`; the converter is
  `PmpExtensions.cs:417`).
- **Write**: `ManipulationsToMetadata` → `ItemMetadata.Serialize`
  (`WizardData.cs:467-479`, `PMP.cs:1208`).

The decisive step is `PMP.ManipulationsToMetadata` (`PMP.cs:1271`), which seeds a fresh
`ItemMetadata` from **`ItemMetadata.GetMetadata(path, forceOriginal=true)`** — the clean
**base-game** metadata (all 18 Dawntrail playable races, canonical order, real EST/IMC/EQP/
GMP values via `ItemMetadata.CreateFromRaw` → `Eqp`/`Est`/`Imc`) — then applies the mod's
deltas on top (`meta.ApplyToMetadata`). The in-code comment is explicit: *"start from the
clean base game version."*

So a pre-Dawntrail (16-race) `.meta` comes out as an 18-race Dawntrail `.meta`. **The growth
is normalization, not a designed upgrade transform** — an emergent side-effect of the
Penumbra sparse-delta model, undocumented upstream (confirmed by a full history review of
`TexTools/xivModdingFramework`).

### History (informs the "faithful, not clever" stance)

- The EQDP race backfill (`ItemMetadata.cs:782-788`, *"SE adding more races in the future"*)
  is **generic 2020 forward-compat code** (`b2977b8e`), not a Hrothgar reaction.
- It only started *firing* when `Hrothgar_Female` (race **1601**) entered `Eqp.PlayableRaces`
  (`Eqp.cs:48-70`) via PR #60 (2024-04-18) for the Dawntrail benchmark.
- The manipulation model was built May 2024 for Penumbra/PMP interop and shipped in
  TexTools 3.0 (July 2024).

The takeaway: the behaviour is **base-game normalization**. We reproduce it faithfully
rather than approximating, per the repo's "ask what TexTools does, then reproduce it" and
"fail loud, never silently diverge" principles.

---

## 2. Empirical scope (what actually changes)

Measured across the current corpus (42 size-differing `.meta`) and a 949-pack library scan,
diffing our pass-through against the cached golden, decomposed per segment:

| Segment | Behaviour | Base-game data required? |
|---|---|---|
| **EQDP** | Expand to canonical 18 `PlayableRaces`; existing races = mod value, **new races = 0** | **No** — see below |
| **EQP / GMP** | Single entry; mod's value overrides the base seed | **No** (mod fully specifies)¹ |
| **EST** | Expand to the est type's base race set; new-race skelId from base game | **Yes** |
| **IMC** | Variant list from base; grows to fit; mod overrides its own variants | **Yes** |

Key empirical facts (corpus-wide, not sampled):
- **EQDP new-race backfill is always 0** (0 non-zero across all 42). This is *guaranteed*, not
  luck: `DeserializeEqdpData` injects a zero entry for every missing `PlayableRaces` race at
  **read** time (`ItemMetadata.cs:782-788`), so all 18 races become explicit manipulations and
  the base EQDP seed is fully overwritten. EQDP needs **no** base data.
- **Present-race values never differ** (0 mismatches) — the mod's own values are always
  preserved; base never leaks into a race the mod defines.
- **EST/IMC residue is real but a minority.** Two hard cases in the current corpus:
  `e6016_met` EST race 1601 skelId=**6016** (an extra skeleton the base game gives the new
  race), and `e6137_top` IMC 2→3 variants (extra variant from base IMC). The 949-pack scan
  confirms these classes recur (extra-skeleton accessories: ears/tails/horns; multi-variant
  accessories) but remain the exception, not the rule.
- **Hair `.meta` no-ops.** Hair EST is race-specific; new Dawntrail races don't share old
  hair models, so the base seed adds nothing and hair metas are unchanged. Our reconstruction
  must reproduce this (i.e. must **not** blindly expand EST to 18) — it falls out naturally
  from seeding from the base est file, which for that hair lacks the new races.

¹ EQP/GMP could in principle require the base seed if a mod's `.meta` omitted them while the
base has them; no corpus case exhibits this (EQP/GMP never grow). We bundle the (tiny,
game-wide) EQP/GMP files anyway so the seed is faithful and the edge case fails safe, not
silently wrong.

---

## 3. Approach: faithful reconstruction + minimal bundled base-game data

Reproduce the **net** transform on each `.meta` binary — parse → reconstruct (base seed +
apply mod deltas) → serialize — rather than literally routing through a manipulation list.
The net is identical and far simpler to port and test. Where the base seed carries data the
mod doesn't (EST new-race skelId, IMC extra variants), consult **bundled minimal base-game
tables** extracted once from the game. Target: **byte-exact, no divergence allow-list.**

This pulls a slice of round 6's reference-asset bundling forward, which is correct: the EST/
IMC dependency is genuinely base-game data, and doing it faithfully now is what makes the
`.meta` ratchet reach byte-zero.

### 3.1 Modules (split, don't blend; each cites its C# source)

- `src/meta/deserialize.ts` — `ItemMetadata.Deserialize` (`ItemMetadata.cs:869`) incl. the
  EQDP read-side race backfill (`DeserializeEqdpData`, `:755-791`).
- `src/meta/serialize.ts` — `ItemMetadata.Serialize` header + segment layout
  (`ItemMetadata.cs:503-660`; per-segment serializers `:662-748,813-816`).
- `src/meta/reconstruct.ts` — the base-seed + apply-deltas net transform
  (`PMP.ManipulationsToMetadata` `PMP.cs:1208`, `ItemMetadata.CreateFromRaw` `:218`,
  `Est.GetExtraSkeletonEntries` `Est.cs:300`, IMC variant grow `PMP.cs:455-480`).
- `src/meta/estType.ts` — slot → `EstType` mapping (`Est.GetEstType`) to pick the est table.
- `src/meta/reference/` — bundled extracted tables (§3.3) + the committed extractor.
- Wiring: replace the opaque `.meta` pass-through in `src/upgrade/upgrade.ts` with a metadata
  round that runs every `.meta` through the reconstruction.

### 3.2 Reconstruction per segment

Given the parsed mod `ItemMetadata` and the bundled base tables for its root:

- **EQDP** — emit all 18 `Eqp.PlayableRaces` in canonical order (`Eqp.cs:48-70`; note the
  Viera **Male-before-Female** ordering quirk); value = mod's value if present, else `0`.
  No base data. `SerializeEqdpData` = uint32 race code + 1 byte (`ItemMetadata.cs:735-748`).
- **EQP / GMP** — base seed (bundled game-wide file), overridden by the mod's single entry
  when present. Serialize unchanged (`:813-816` / `:662-666`).
- **EST** — determine `EstType` from slot; take the base est table's race set for the item's
  set id, override with the mod's entries, keep base skelId for races the mod omits. 6 bytes/
  entry: ushort race, ushort setId, ushort skelId (`:668-684`). Hair naturally no-ops.
- **IMC** — base variant list (bundled), grown to the max of base and any mod variant index,
  with the mod's variants overriding their slots; extra variants come from base. 6 bytes/
  entry (`:692-707`).

### 3.3 Minimal derived game data + extraction

A committed `scripts/extract-meta-reference.ts` (mirroring the existing T4 extractor
`scripts/extract-index-overrides.ts`) pulls these via ConsoleTools `/extract`, reduced to
compact tables under `src/meta/reference/`:

- **EST** — the 4 game-wide est files (small lookup tables):
  `chara/xls/charadb/extra_met.est` (Head), `extra_top.est` (Body),
  `hairskeletontemplate.est` (Hair), `faceskeletontemplate.est` (Face) (`Est.cs:39-45`).
  Reduce to `(estType, race, setId) → skelId`.
- **EQP / GMP** — `chara/xls/equipmentparameter/equipmentparameter.eqp` and
  `gimmickparameter.gmp` (`Eqp.cs:28-29`). Small, game-wide.
- **IMC** — per-item `.imc` files, reduced to `(setId, slot) → variant entry bytes`.
  **This is the only potentially-bulky piece.** Decision: **extract and measure it first.**
  If it lands in the few-MB range (comparable to the already-planned `item_sets.db`, 2.5 MB),
  bundle it for full faithfulness. If it is large, reduce or stage it and record the tradeoff
  in a follow-up — the ratchet baselines any IMC-growth case until then.

- **EQDP** — **not extracted** (new-race backfill is data-free; §2). Documented as an
  explicit non-dependency so a future reader doesn't add it.

---

## 4. Corpus test data (first implementation step)

Per the "corpus first" steer, the plan's first step brings a minimal, verified selection into
`test/corpus/real/` (gitignored; the user supplies the files). All four are pre-Dawntrail,
oracle-verified to upgrade (not no-op), and small:

| Pack | Size | Risk exercised |
|---|---|---|
| **Purrfection Ears & Bow** | 8.1 MB | EST non-zero new-race (`e5035_met` r1601=5035, ears) + GMP |
| **Paglth'an Redeux** (`[V] [VC]`) | 3.7 MB | IMC variant growth (`e0724_top` 4→7) |
| **Vixen** (`[V] [AM]`) | 4.4 MB | general EQDP/EST expansion — Vermillion author diversity |
| **Cambria** (`•Arabella•`, May 2023) | 9.2 MB | general EQDP/EST expansion — Arabella author diversity |

The two residue packs give a *second item/author* on each base-game-dependent path (the
corpus already has `e6016_met` EST-nz and `e6137_top` IMC growth once each); the two
general packs add author diversity on the common expansion path — a little redundancy
against unknown-unknowns, as requested.

**Synthetic unit tests** cover what no small real pack cheaply reaches: the codec round-trip
(parse→serialize byte-identity), EQDP canonical reorder + zero-backfill, the est-type
expansion boundary, and **hair no-op** (small hair packs either no-op entirely or are 126 MB).

**Bonus finding to log:** `Spring Florals` (`[V] [AM]`) *throws in our current pipeline* — a
pre-existing, non-meta bug surfaced during this scan. Add a `docs/BACKLOG.md` entry (and it's a
corpus candidate once fixed); out of scope for this round.

---

## 5. Divergence policy & burndown

- **Target byte-exact, no `DIVERGENCE_RULES` entry.** The whole point of bundling the base
  data is that we can match every byte. Any residual mismatch is a real bug or an
  extraction-coverage gap (widen the table), not an accepted divergence.
- **Burndown:** the `.meta` diffs (~49 baselined + the corpus residue) go to byte-zero. The
  two new residue packs must fully match on their first run (no baseline); the two general
  packs likewise.

---

## 6. Known risks & open questions

- **IMC bundle size** (§3.3) — the one unmeasured quantity; resolved by extract-and-measure
  as the first data step, before committing to the full-faithful IMC path.
- **EST race-set model** — reconstruction relies on the base est table to decide which races
  an item's EST covers (equipment expands to the full set, hair does not). This is faithful
  by construction (we read the same base est file TexTools does); the synthetic hair test
  guards against a regression to blind expansion.
- **Est type coverage** — the slot→`EstType` map must match `Est.GetEstType`; a slot we
  don't map should **fail loud**, not guess.
- **Extraction reproducibility** — the extractor needs a game install (maintainer's machine),
  like the T4 index-override extractor; the bundled tables are the committed artifact so a
  fresh clone needs no game to run the port.
