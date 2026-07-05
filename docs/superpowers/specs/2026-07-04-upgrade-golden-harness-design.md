# Upgrade E2E Golden Harness + Caching — Design

**Date:** 2026-07-04
**Status:** Design approved (brainstorming); ready for implementation plan.
**Depends on:** all shipped codecs (sqpack / mtrl / tex+BCn / mdl), container I/O
(ttmp2 / pmp / legacy), the `ModpackData` model, and the ConsoleTools oracle
plumbing in `test/helpers/oracle.ts`.

---

## 1. Context: where this sits in the larger effort

The repo has every codec and container built and corpus-validated. The one
missing piece is the **Dawntrail upgrade transforms** — the port of C#
`ModpackUpgrader.cs` (orchestration, four rounds) + `EndwalkerUpgrade.cs`
(~2,200 lines: material/colorset EW→DT, model v5→v6, normal+colorset→index-map,
hair material/texture migration, eye mask→diffuse, skin repaths, partial
heuristics).

That port is too large for one spec. It decomposes into sequential
sub-projects, each its own spec→plan→implement cycle:

1. **This spec — E2E golden harness + `/upgrade` caching + baseline ratchet.**
   The confidence backbone and burndown chart for everything after it.
2. Orchestration + material/colorset round.
3. Model round (v5→v6).
4. Texture round (index-map generation, remaining textures, hair textures).
5. Partials (unclaimed hair, eye mask→diffuse, skin repaths) + reference-asset
   bundling.

**Decision (sequencing):** build the harness first. With an identity pipeline
every pack "differs", and that diff — recorded as a ratchet baseline — becomes
the burndown chart that makes each later round test-driven (the round is done
when it shrinks the baseline to zero for the files it owns).

## 2. Goal of this sub-project

A corpus check that, for each input pack: runs **our** upgrade pipeline, fetches
the **cached ConsoleTools `/upgrade` golden**, and diffs the two per-option,
per-`gamePath`, on **decompressed content** — asserting **exact byte equality by
default**, with tolerance permitted **only** on an explicit, documented
divergence allow-list. A gitignored per-pack **ratchet baseline** keeps
`npm test` green while transforms are still unwritten, and turns red on any
regression.

Non-goals for this sub-project: porting any transform. The pipeline ships as a
structural-identity skeleton so the harness runs end-to-end and produces a real
(large) baseline.

## 3. Key facts driving the design

- **`/upgrade` is a transforming op**, not byte-preserving: it decompresses,
  re-compresses with a different block layout, and normalizes `.mdl`. Any golden
  diff must compare **decompressed / semantic** content, never raw compressed
  payloads. (Established in the foundation design §6; reconfirmed here.)
- **`/upgrade` writes nothing on a no-op.** ConsoleTools calls the 2-arg
  `ModpackUpgrader.UpgradeModpack(src, dest)`, which defaults
  `rewriteOnNoChanges = false`; when `AnyChanges == false` no output file is
  produced (`ModpackUpgrader.cs:212-222`, `Program.cs:179`). A missing golden is
  therefore a **first-class "no-op" signal**: our upgrade must be semantically
  identity for that pack. Some corpus packs are expected no-ops; that is a valid
  test, not a gap.
- **Generated textures will never byte-match.** Index maps and upgraded masks
  are BCn-encoded by C#'s encoder (BcnSharp/DirectXTex); our BC5/BC7 encoder is
  not bit-identical. Exact equality on those is unattainable *by construction* —
  hence the tolerance allow-list, scoped to explicitly-documented divergences.
- **Our `.mtrl`/`.mdl` serializers already reproduce C#'s normalization** (the
  mtrl corpus check proves the fixed-point + semantic-lossless property). So
  non-texture upgraded files are expected to match the golden **exactly** once
  the transforms are correct; they are NOT on the tolerance allow-list.
- **Comparison must be per-option, not globally flattened.** The C# upgrade runs
  on each option's own file dict (`o.StandardData.Files`); the same `gamePath`
  can appear in multiple options with different bytes. Neither our pipeline nor
  `/upgrade` adds or removes options, so options align by structural position
  (group index → option index).

## 4. Components

### 4.1 Pipeline seam — `src/upgrade/upgrade.ts`

```ts
export function upgradeModpack(data: ModpackData): ModpackData
```

Pure, in-memory, returns a new `ModpackData` (does not mutate its input).
Signature is synchronous; it becomes `async` later only if a transform needs it.

Ships in this sub-project as a **skeleton**: the four rounds present as named
no-op passes over `groups → options → files`, returning a structurally-equal
deep copy. This is the single seam every future transform round plugs into.
Exported from `src/index.ts` so both the harness and (eventually) the site call
one entry point.

Rationale for a structural copy rather than returning the input unchanged: it
forces the skeleton to exercise the full traverse/rebuild path the real rounds
will use, and guarantees the harness's "ours" side is independent of its input.

### 4.2 Golden cache — `test/helpers/upgrade-golden.ts`

Mirrors the `.oracle-cache` pattern in `oracle.ts` (content-addressed, atomic
temp-file + rename, concurrency-safe, gitignored). Reuses `oracleKey` for the
hash and the same fail-loud policy.

- **Location:** `test/corpus/.upgrade-cache/` (inside the wholly-gitignored
  `/test/corpus/` tree — no `.gitignore` change).
- **Key:** `sha256(inputPackBytes)` — self-invalidates when a pack changes.
- **Stored value:** the raw golden pack bytes under `<key><ext>`, where `<ext>`
  matches the source format (`.pmp` → `.pmp`, `.ttmp2`/`.ttmp` → `.ttmp2`) to
  minimize incidental container noise. Comparison is decompressed-by-`gamePath`
  regardless, so format is not load-bearing — this is just hygiene.
- **No-op sentinel:** when `/upgrade` produces no output file, store a
  zero-byte marker `<key>.noop` so the no-op verdict is cached and distinguished
  from a genuine cache miss.

```ts
type GoldenResult =
  | { kind: "pack"; data: ModpackData }   // golden loaded & parsed
  | { kind: "noop" };                     // /upgrade wrote nothing ⇒ identity expected

export function upgradeGoldenCached(name: string, bytes: Uint8Array): GoldenResult | null;
// null ⇒ uncached AND no oracle available (fail per policy, like unwrapCached).
```

On miss with oracle available: run ConsoleTools `/upgrade` into a temp dir; if
the dest exists, cache its bytes and return `{ kind: "pack" }`; if not, cache the
`.noop` marker and return `{ kind: "noop" }`.

### 4.3 Diff engine — `test/helpers/upgrade-diff.ts`

```ts
type DiffStatus = "added" | "removed" | "mismatch";
interface FileDiff {
  gamePath: string; index: number;   // index = position within this path's sorted diff list (stable id)
  status: DiffStatus;
  detail?: string;                    // e.g. byte lengths, PSNR, first-divergence offset
}
interface PackDiff { pack: string; matched: number; files: FileDiff[]; }

export function diffUpgrade(
  pack: string, ours: ModpackData, golden: ModpackData,
  confirmDivergence: (gamePath: string, ours: Uint8Array, golden: Uint8Array) => boolean,
): PackDiff;
```

**Key by `gamePath`, not by option structure.** A simple ttmp2 collapses to a
single synthetic `Default` group/option, and `/upgrade`'s container writer gives
no guarantee it preserves simple-vs-wizard structure or option ordering — so
aligning by structural index is fragile. Instead, mirror the shipped
`compareInnerFilesByteIdentical`: reduce **each whole pack** to
`Map<gamePath, Uint8Array[]>` of **uncompressed** payloads (decode sqpack for
ttmp, raw for pmp — a `gamePath` may carry several payloads across options, so
it is a multiset), then per `gamePath` pair ours↔golden order-independently:

1. Remove **exact byte-equal** pairs → counted in `matched`.
2. On the remainder, pair via `confirmDivergence` (§4.4); a confirmed pair is an
   intended divergence → counted in `matched`.
3. Leftovers (sorted lexically for stable `index`): `min(nOurs,nGolden)` reported
   as `mismatch`, surplus golden as `added`, surplus ours as `removed`.

`PackDiff.files` holds only the **non-matched** entries (the ratchet cares about
those); `matched` is a count for logging. Only non-matched entries need the
`{gamePath, index}` stable identity.

For the `noop` golden: run the same engine with the **original input pack** as
`golden`; any non-matched entry means our pipeline changed a file the oracle left
alone.

### 4.4 Comparison + intentional-divergence confirmations — `test/helpers/upgrade-compare.ts`

Default comparator is **exact decompressed-byte equality** (`bytesEqual`).

Where our output intentionally diverges from TexTools, we do **not** ignore the
divergence — we replace the exact-byte check with a **targeted confirmation that
the divergence is exactly the one we intended, and nothing else**. So the
allow-list is a registry of *intentional-divergence assertions*, not tolerances.
Each entry: a `predicate(gamePath, ours, golden)`, a `confirm(ours, golden)`
that **positively asserts the expected relationship**, and a **cited reason**.
`confirm` must be as tight as the intended difference allows, so an *unexpected*
divergence (wrong channel, wrong dimensions, a real transform bug) still fails —
it only passes the specific, documented difference. Example (added only when the
texture round lands):

```ts
{
  reason: "generated _id.tex index map: we deliberately use our own BC5 encoder " +
          "(≠ C#'s BcnSharp), so the compressed blocks differ by design. Confirm " +
          "the intended difference is ONLY the block encoding: same tex header/" +
          "format/dimensions/mip count, and decoded pixels agree within the " +
          "precision our encoder is documented to sacrifice.",
  predicate: (p) => /_id\.tex$/.test(p),
  confirm: (ours, golden) =>
    sameTexShape(ours, golden) &&                       // header, format, dims, mips identical
    maxChannelDelta(decode(ours), decode(golden)) <= INDEX_MAP_MAX_DELTA, // pixels: intended precision loss only
}
```

The registry starts **empty** (the skeleton generates nothing) and grows
alongside the transform rounds — ideally staying small. A file not covered by
any entry MUST match exactly. This keeps every divergence from TexTools
**explicit, reasoned, and actively verified** rather than a blanket softening: a
divergence is only ever accepted after we confirm it is the difference we meant
to introduce.

### 4.5 Baseline ratchet — gitignored, in the corpus tree

Because the baseline describes specific corpus packs that do not live in git, it
lives with them under the gitignored corpus tree, **not** committed.

- **Location:** `test/corpus/.upgrade-baseline/<sha256(inputPackBytes)>.json` —
  one file per pack, content-addressed so an entry self-invalidates when its
  pack changes (mirrors the per-key layout of `.oracle-cache` /
  `.upgrade-cache`; no concurrent-writer contention since each pack is a
  distinct key).
- **Contents per pack:** the set of currently-expected non-matched diffs
  (each `{gamePath, index, status}`, matching `FileDiff`), i.e. the
  known-unimplemented remainder.
- **Ratchet semantics:**
  - A pack with **no baseline entry has an empty baseline** — it is **expected
    to fully match** (exact + allow-list). This is the default for every newly
    added corpus mod: if it matches (a no-op pack, or a pack whose transforms are
    all implemented) it goes green with zero ceremony.
  - PASS when the actual diff set ⊆ the baseline set (empty baseline ⇒ pass iff
    zero divergences).
  - FAIL on any **regression**: a diff not in the baseline (a new/unexpected
    divergence, or a file that used to match and now doesn't), or a `removed`.
  - Making a failing pack green is always a **deliberate act**, never automatic:
    either (a) add the divergence to the committed **allow-list** (§4.4) with a
    cited reason — the right resolution for an intentional, permanent divergence
    from TexTools; or (b) **bless** it into the pack's baseline as a
    not-yet-implemented remainder during build-out.
- **Bless step:** an explicit update mode (`UPDATE_UPGRADE_BASELINE=1`,
  snapshot-test ergonomics) rewrites each pack's baseline to its current actual
  diff. Used to record the initial mass of unimplemented diffs when the check is
  first introduced, and to re-record (shrink) after each transform round. The
  baseline strictly monotonically shrinks toward empty as rounds land; the **end
  state is every baseline empty**, with the committed allow-list holding the only
  remaining, intentional divergences.

### 4.6 Corpus wiring

- Add `CheckKind = "upgrade"` in `test/helpers/corpus-units.ts` (enumerated per
  pack, one unit per pack) and dispatch it in `corpus-register.ts` to a new
  `registerUpgradeCheck(pack)` in `test/helpers/corpus-upgrade.ts`.
- `registerUpgradeCheck`: load input → `upgradeModpack` → `upgradeGoldenCached`
  → `diffUpgrade` → compare against baseline → assert (or bless). Fails loudly
  when the oracle/cache can't supply a golden, per policy
  (`assertCorpusPresent` sibling).
- The check joins the standard `npm test` gate. With the identity skeleton it is
  green via a freshly-blessed baseline; it stays green until a transform round
  changes real output, at which point re-blessing records the (smaller)
  remainder.

## 5. Data flow

```
input pack bytes
   │
   ├─ upgradeModpack(loadModpack(bytes)) ─────────────► ours: ModpackData
   │
   └─ upgradeGoldenCached(name, bytes)
          │  hit → cached golden bytes / .noop
          │  miss+oracle → ConsoleTools /upgrade → cache → load
          │  miss+no-oracle → null (fail)
          ▼
        golden: GoldenResult
   │
   ▼
diffUpgrade(ours, golden|input)  ─► PackDiff  ─► compare vs baseline ─► pass / regress / bless
        (per-option, per-gamePath, decompressed; exact + allow-list tolerance)
```

## 6. Testing this harness (the harness needs its own tests)

Fast, oracle-free unit tests (like `oracle-cache.test.ts`) using synthetic
`ModpackData` and a temp cache/baseline dir:

- **golden cache:** miss→null without oracle; produce-once-then-serve with an
  injected `produce`; `.noop` marker round-trips as `{ kind: "noop" }`.
- **diff engine:** identical packs → all `matched`; a changed inner file →
  `mismatch`; a golden-only file → `added`; an ours-only file → `removed`;
  option alignment by position.
- **comparator / divergence confirmations:** exact mismatch fails by default; a
  matching divergence entry whose `confirm` holds passes; a matching entry whose
  `confirm` **fails** (divergence is not the intended one) still fails; a
  `gamePath` outside every entry must match exactly.
- **baseline ratchet:** subset → pass; superset/regression → fail; **missing
  entry ⇒ empty baseline ⇒ pass iff zero divergences** (new pack expected to
  match), fail otherwise; bless writes actual→baseline and a re-run passes.

The **corpus** `upgrade` check itself is the integration test (real packs, real
oracle, cached).

## 7. Out of scope / deferred to later sub-projects

- Any actual transform (materials, models, textures, partials).
- Reference-asset bundling (`_SampleHair`, eye textures, iris/hair tables).
- Coverage-driven corpus iteration — rides on this harness across all rounds
  (run `test:coverage`, find under-exercised upgrade branches, add real mods
  that hit them). Belongs to the transform sub-projects, once there is transform
  code to cover.
- The site/UI upgrade entry point (will call `upgradeModpack`).

## 8. File plan

- `src/upgrade/upgrade.ts` (new) — `upgradeModpack` skeleton.
- `src/index.ts` (modify) — export `upgradeModpack`.
- `test/helpers/upgrade-golden.ts` (new) — cache + `upgradeGoldenCached`.
- `test/helpers/upgrade-diff.ts` (new) — `diffUpgrade`.
- `test/helpers/upgrade-compare.ts` (new) — comparator + divergence allow-list.
- `test/helpers/upgrade-baseline.ts` (new) — ratchet load/compare/bless.
- `test/helpers/corpus-upgrade.ts` (new) — `registerUpgradeCheck`.
- `test/helpers/corpus-units.ts` + `corpus-register.ts` (modify) — enumerate +
  dispatch the `upgrade` kind.
- `test/upgrade-harness.test.ts` (new) — fast oracle-free unit tests (§6).
- No `.gitignore` change (cache + baseline live under gitignored
  `/test/corpus/`).
