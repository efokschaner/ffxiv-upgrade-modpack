import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Diagnostic,
  DiagnosticCode,
  loadModpack,
  type ModpackData,
  type UpgradeResult,
  upgradeModpack,
  writeModpack,
} from "../../src/index";
import { readZip } from "../../src/zip/zip";
import { packHasFileSwaps } from "./archive-redirects";
import { corpusPacks } from "./corpus-roots";
import { oracleKey } from "./oracle";
import { pmpSelfConsistency } from "./pmp-self-consistency";
import { diffArchives } from "./upgrade-archive-diff";
import {
  compareToBaseline,
  loadBaseline,
  saveBaseline,
} from "./upgrade-baseline";
import {
  confirmDivergence,
  ORACLE_ERROR_DIVERGENCE_RULES,
  type OracleErrorDivergenceRule,
} from "./upgrade-compare";
import { diffUpgrade, type FileDiff } from "./upgrade-diff";
import { upgradeGoldenCached } from "./upgrade-golden";
import { transformChanges } from "./upgrade-noop";

/** Locate a corpus pack by exact base name, across every corpus root. Used to resolve a
 *  ORACLE_ERROR_DIVERGENCE_RULES entry's declared sibling. */
function findCorpusPack(fileName: string): string | undefined {
  return corpusPacks().find((p) => basename(p) === fileName);
}

/** Real confirmation for a matched `ORACLE_ERROR_DIVERGENCE_RULES` entry — the default 4th argument
 * to `assertMatchedUpgradeFailure`, injectable for unit testing without touching the real corpus or
 * oracle cache. Proves our successful upgrade of the CRASHING pack is exactly what ConsoleTools
 * /upgrade would have produced had the crash-triggering zero-option group not been there, in TWO
 * complementary ways (code review, 2026-08-05 — see that review for why one alone is not enough):
 *
 *  1. CONTENT, by diffing against the rule's declared sibling's own /upgrade golden via `diffUpgrade`
 *     — layout-agnostic, keyed by gamePath, decompressed. This is the pre-existing check.
 *  2. STRUCTURE, by running the sibling through OUR OWN pipeline (load -> upgradeModpack -> write)
 *     and diffing the two ARCHIVES with `diffArchives`. `diffUpgrade` cannot see group/page/manifest
 *     structure at all — it is a per-gamePath payload multiset — so a regression that leaves a
 *     zero-option group's `group_NNN.json` in the written PMP, or strands an off-by-one page and
 *     shifts every member under a spurious `pN/` prefix, moves ZERO gamePath-multiset bytes (an
 *     empty-option group carries no files) and (1) alone would stay green. `diffArchives` catches
 *     both: an extra manifest member is a `structure` diff, and a shifted prefix is a payload MEMBER
 *     NAME diff (`diffArchives`' `checkPayloadMembers`).
 *
 *     Comparing ours against the sibling's OWN writer output (not the sibling's raw file) is what
 *     makes (2) layout-comparable at all — our writer regenerates zip paths from the model
 *     (`optionPrefixes`), so a hand-authored sibling's raw member names have no reason to match ours
 *     even when behaviour is identical. The sibling's own writer output is independently anchored to
 *     ConsoleTools: the sibling pack (`test/corpus/synthetic/`) goes through the ordinary
 *     `registerUpgradeCheck` elsewhere in the suite, which diffs it (content AND structure) against
 *     the REAL ConsoleTools /upgrade golden — so if the sibling's own pipeline drifted from TexTools,
 *     that unit already fails independently of this one.
 *
 * The sibling lookup is guarded: a rule naming a pack absent from the corpus fails LOUDLY. A
 * silently-missing sibling would make this whole confirmation a no-op — exactly what AGENTS.md's
 * "never merely tolerated" rule exists to prevent — so this throws/fails rather than treating an
 * unresolved sibling as "nothing to compare, so pass". Likewise a sibling whose OWN oracle run
 * itself errored is not a valid pairing (there would be nothing to confirm against) and fails loud.
 *
 * Check (1) above handles only a NO-OP sibling golden today (both current rule instances' siblings
 * sit at a dummy gamePath /upgrade ignores, so ConsoleTools no-ops on them by construction — see
 * scripts/generate-synthetics/pmp-builder.ts's DUMMY_PAYLOAD comment). A no-op golden means
 * ConsoleTools wrote NO archive, so the reference is the sibling's own untouched input — a
 * hand-authored Penumbra-shaped pack, not TexTools' writer output.
 *
 * A sibling whose OWN /upgrade produces a genuinely-written golden is a real case check (1) does not
 * yet handle — see the `kind === "pack"` guard below for why that is a deliberate gap, not an
 * oversight. Check (2) is unaffected by that gap: it never reads the sibling's oracle golden at all,
 * only the sibling's OWN bytes run through our pipeline, so it already covers a `kind === "pack"`
 * sibling too (once/if that guard below is lifted).
 */
export function confirmOracleErrorDivergence(
  name: string,
  rule: OracleErrorDivergenceRule,
  ours: ModpackData,
): void {
  const siblingName = rule.siblingOf(name);
  const siblingPath = findCorpusPack(siblingName);
  if (siblingPath === undefined) {
    expect.fail(
      `${name}: oracle error matched a confirmed-divergence rule (${rule.reason}) naming sibling ` +
        `"${siblingName}" to supply the expected bytes, but no such pack exists in the corpus. A ` +
        `silently-missing sibling would turn this confirmation into a no-op — AGENTS.md is explicit ` +
        `that a divergence must be CONFIRMED, never merely tolerated.`,
    );
    return; // unreachable — expect.fail throws — but keeps TS's control-flow analysis happy below.
  }
  const siblingBytes = new Uint8Array(readFileSync(siblingPath));
  const siblingGolden = upgradeGoldenCached(siblingName, siblingBytes);
  if (siblingGolden === null) {
    throw new Error(
      `No /upgrade golden for ${siblingName}, the sibling ${name}'s confirmed-divergence rule ` +
        `declares: uncached and no oracle (ConsoleTools) available.`,
    );
  }
  if (siblingGolden.kind === "error") {
    expect.fail(
      `${name}: its declared sibling ${siblingName} ALSO errors under ConsoleTools /upgrade — not ` +
        `a valid pairing to confirm this divergence against:\n${siblingGolden.message}`,
    );
    return;
  }
  if (siblingGolden.kind === "pack") {
    // UNIMPLEMENTED ON PURPOSE (code review, 2026-08-05) — not a forgotten case, and narrower than it
    // once was: this guard only blocks the CONTENT check (point 1 in this function's doc comment),
    // which diffs against the sibling's OWN /upgrade golden and so needs that golden's shape handled.
    // No ORACLE_ERROR_DIVERGENCE_RULES instance has ever exercised this branch: both current rule
    // instances' siblings are no-ops by construction (see this function's doc comment), so a real
    // written-golden comparison here was speculative, UNTESTED generality — dead code by every
    // measure this repo uses (no corpus pack, no unit test). Rather than keep it dark, this throws,
    // so a future rule whose sibling genuinely changes under /upgrade fails LOUDLY here instead of
    // silently re-running the untested path. Implementing it for real needs its own covering test (a
    // fixture pair where the sibling's golden is a real written pack) AND must gate
    // `layoutEquivalent` on the CRASHING pack's OWN FileSwaps, matching `registerUpgradeCheck`'s
    // "gate on the INPUT pack" rule — NOT the sibling's, which is the bug this comment replaces.
    // The STRUCTURE check (point 2) is unaffected by this gap: it never reads the sibling's oracle
    // golden at all, only the sibling's own bytes re-run through OUR pipeline, so it already covers
    // a `kind === "pack"` sibling — it just never gets the chance to run, because this throw fires
    // first, before either check.
    throw new Error(
      `${name}: its declared sibling ${siblingName}'s own /upgrade produced a real written pack ` +
        `(not a no-op) — confirmOracleErrorDivergence does not yet handle that case (see the code ` +
        `comment on this throw). No current rule needs it; add the comparison and a covering test ` +
        `before relying on it.`,
    );
  }

  const target = name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
  const oursArchive = writeModpack(ours, target, { store: true });
  const oursReRead = loadModpack(`ours.${target}`, oursArchive);
  const reference = loadModpack(siblingName, siblingBytes);

  const payload = diffUpgrade(name, oursReRead, reference, confirmDivergence);
  if (payload.files.length > 0) {
    expect.fail(
      `${name}: confirmed-divergence check FAILED — our output does not byte-match the golden of ` +
        `its declared sibling ${siblingName} (${rule.reason}):\n` +
        payload.files
          .map(
            (d) =>
              `  [${d.kind}] ${d.gamePath}#${d.index}:${d.status}` +
              (d.detail ? ` (${d.detail})` : ""),
          )
          .join("\n"),
    );
  }

  // STRUCTURE, the check `diffUpgrade` above cannot perform (see this function's doc comment, point
  // 2). Run OUR OWN pipeline over the sibling's bytes — not the sibling's raw file, which has no
  // reason to share zip layout with our regenerated one — so both archives being compared are our
  // writer's output, and are therefore layout-comparable by `diffArchives`. `reference` (the sibling,
  // loaded but not yet upgraded) is reused as the input to that pipeline.
  const siblingUpgrade = upgradeModpack(reference);
  if (!siblingUpgrade.ok) {
    // Not a divergence in the crashing pack's OWN confirmation — the sibling is supposed to be a
    // clean, unremarkable pack (that is the whole point of pairing against it). If OUR pipeline
    // cannot upgrade it either, the pairing itself is broken and this check has nothing valid to
    // compare against — fail loud rather than silently skipping the structural half.
    throw new Error(
      `${name}: its declared sibling ${siblingName} failed OUR OWN upgrade pipeline, so its ` +
        `structure cannot confirm this divergence:\n` +
        siblingUpgrade.diagnostics
          .map((d) => `  [${d.code}] ${d.message}`)
          .join("\n"),
    );
  }
  const siblingArchive = writeModpack(siblingUpgrade.data, target, {
    store: true,
  });
  const structure = diffArchives(
    oursArchive,
    siblingArchive,
    target === "pmp",
    confirmDivergence,
  );
  if (structure.length > 0) {
    expect.fail(
      `${name}: confirmed-divergence check FAILED — our output's STRUCTURE (manifest members, ` +
        `payload member names) does not match OUR OWN upgrade of its declared sibling ${siblingName} ` +
        `(${rule.reason}):\n` +
        structure
          .map(
            (d) =>
              `  [${d.kind}] ${d.gamePath}#${d.index}:${d.status}` +
              (d.detail ? ` (${d.detail})` : ""),
          )
          .join("\n"),
    );
  }
  console.log(
    `[upgrade] ${name}: confirmed oracle-error divergence (matches sibling ${siblingName}'s golden, ` +
      `content AND structure).`,
  );
}

// Set UPDATE_UPGRADE_BASELINE=1 to (re-)record each pack's baseline to its current actual diff.
const BLESS = process.env.UPDATE_UPGRADE_BASELINE === "1";

/** Assert our port matches a ConsoleTools /upgrade oracle ERROR: a matched failure is a PASS (our
 * upgrade must throw where TexTools throws); our upgrade SUCCEEDING is a divergence -> loud fail.
 * Exported for unit testing (test/helpers/corpus-upgrade.test.ts). See spec §3 +
 * docs/backlog/2026-07-11-expected-failure-golden.md. */
export function assertMatchedUpgradeFailure(
  name: string,
  oracleMessage: string,
  runUpgrade: () => UpgradeResult<ModpackData>,
  confirmOracleError: (
    name: string,
    rule: OracleErrorDivergenceRule,
    ours: ModpackData,
  ) => void = confirmOracleErrorDivergence,
): void {
  // TWO channels, because the two halves of the pipeline fail differently (spec §6.6):
  //   - `loadModpack` is out of scope for the diagnostics channel (spec §5) and still THROWS. It is
  //     deliberately called inside this assertion (see registerUpgradeCheck) because a pack the
  //     oracle refuses at LOAD is refused just as legitimately by our loader.
  //   - `upgradeModpack` no longer throws; it returns ok:false.
  let ourMessage: string | undefined;
  let ourData: ModpackData | undefined;
  try {
    const result = runUpgrade();
    if (!result.ok) {
      // The fatal diagnostic is the LAST one — execution aborted there (spec §4).
      // Note: the type does not enforce that ok:false always includes at least one diagnostic.
      // Supply a sentinel so the empty-string guard below fires the correct "error mismatch" failure
      // instead of the backwards "succeeded when it should have failed" message.
      ourMessage =
        result.diagnostics[result.diagnostics.length - 1]?.message ??
        "<upgrade failed with no diagnostics>";
    } else {
      ourData = result.data; // captured for the confirmed-divergence path below
    }
  } catch (e) {
    ourMessage = e instanceof Error ? e.message : String(e);
  }
  if (ourMessage === undefined) {
    // Our upgrade SUCCEEDED where the oracle errored. Ordinarily that is exactly the divergence the
    // hard failure below exists to catch — UNLESS the oracle's own captured trace matches a
    // registered ORACLE_ERROR_DIVERGENCE_RULES entry (test/helpers/upgrade-compare.ts;
    // docs/TEXTOOLS_BUGS.md #22). Keyed on the trace SIGNATURE, never on `name`, so this generalizes
    // to any pack tripping the same TexTools defect — today's two synthetics and tomorrow's user
    // uploads alike — with nothing blessed per-pack. A trace matching no rule falls through to the
    // exact same hard failure as before this branch existed.
    const rule = ORACLE_ERROR_DIVERGENCE_RULES.find((r) =>
      r.matches(oracleMessage),
    );
    if (rule !== undefined) {
      confirmOracleError(name, rule, ourData!); // ourData is set whenever ourMessage is undefined
      return;
    }
    expect.fail(
      `${name}: ConsoleTools /upgrade errored but our upgrade SUCCEEDED — divergence.\n` +
        `Oracle error was:\n${oracleMessage}`,
    );
  }
  // Verify a MATCHED REASON, not just "both threw": our port reproduces ConsoleTools' exact error
  // strings, so our thrown message must appear within the oracle's captured trace. A compound
  // regression that throws a DIFFERENT error on this pack (e.g. the pre-round stops throwing and a
  // later round throws for another reason) fails here instead of passing silently.
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
  const ourNorm = norm(ourMessage);
  if (ourNorm.length === 0 || !norm(oracleMessage).includes(ourNorm)) {
    expect.fail(
      `${name}: our upgrade threw, but its error does not match the oracle's — a matched failure ` +
        `must be the SAME error our port reproduces from TexTools.\nOur error:\n${ourMessage}\n\n` +
        `Oracle error:\n${oracleMessage}`,
    );
  }
  console.log(
    `[upgrade] ${name}: matched expected failure (oracle + our port both error).`,
  );
}

/** Plain relational string comparison (UTF-16 code-unit order), NOT `localeCompare`. This
 * comparator's entire purpose is a cross-RUN-stable sort order, and `localeCompare` with no
 * explicit locale is collation-aware and ICU/locale-dependent — not guaranteed to return the same
 * ordering across Node builds or host locales. `<`/`>` on strings has no such dependency: it is
 * pure UTF-16 code-unit comparison, defined by the language spec. */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Map a completed upgrade's diagnostics onto the ratchet's `FileDiff` shape (diagnostics-channel
 * spec §7). Exported for unit testing (test/helpers/corpus-upgrade.test.ts) — this is the ONLY
 * thing that pins the assigned `index`, and `idOf` (upgrade-baseline.ts) keys on it, so the sort
 * here must be a genuine total order, not something that quietly falls back to array insertion
 * order on a tie.
 *
 * Sort key: `(gamePath, code, message)`, all three via `compareOrdinal`.
 *  - `gamePath` then `code` group diagnostics the way the ratchet identity does (idOf keys on
 *    exactly those two, plus `status`/`kind`, for this kind).
 *  - `message` is the tiebreak this round adds. It discriminates the reachable collision this was
 *    written for: `HairTransformFailed` (src/upgrade/unclaimed-hair.ts:234-242) carries a
 *    `gamePath` (the shared destination texture, unique within an option but NOT across options —
 *    unclaimed-hair.ts:180-187) and a fixed `code`, but no `option`, so two different options
 *    failing the SAME hair-texture destination collide on both `idOf` keys. `message` is
 *    `err.message` from the swallowed transform failure (unclaimed-hair.ts:237), which stringifies
 *    details specific to that option's own source texture bytes (e.g. dimensions) — genuinely
 *    different failures on the two options normally produce different messages, breaking the tie.
 *
 * Residual case, and why it's harmless rather than "STOP, need more data": if `gamePath`, `code`
 * AND `message` are ALL equal, no field on today's `Diagnostic` (src/util/diagnostic.ts) can
 * distinguish the two — `severity`/`provenance` are constant per code, and `cause`/`option` are
 * either non-serializable or, for this exact diagnostic, never populated (spec §4.3: `option` can
 * only be annotated by `upgradeModpack`'s own loop, which `partials` never does for this
 * collector). But `idOf` does not read `detail` (the field `message` becomes on `FileDiff`), only
 * `kind`/`gamePath`/`index`/`status`/`code` — so for a same-(gamePath,code,message) pair, EVERY
 * assignment of {index, index+1} to the two diagnostics yields the exact same PAIR of identity
 * strings (`...#index:added@code`, `...#index+1:added@code`); which physical diagnostic backs
 * which index is unobservable to the ratchet. So an unbroken final tie is provably inert for
 * baseline correctness, not a gap — widening `Diagnostic`'s shape (e.g. carrying `option`) to chase
 * it further is exactly the design change this comment declines to make unasked. */
export function diagnosticsToFileDiffs(diagnostics: Diagnostic[]): FileDiff[] {
  return [...diagnostics]
    .sort(
      (a, b) =>
        compareOrdinal(a.gamePath ?? "", b.gamePath ?? "") ||
        compareOrdinal(a.code, b.code) ||
        compareOrdinal(a.message, b.message),
    )
    .map((d, i) => ({
      kind: "diagnostic" as const,
      // `gamePath` is required on FileDiff but optional on Diagnostic (a diagnostic whose context
      // never reached an annotating frame has none) — supply an explicit sentinel rather than
      // letting it fall through as `undefined` (spec §7).
      gamePath: d.gamePath ?? "(no path)",
      index: i,
      status: "added" as const,
      code: d.code,
      detail: d.message,
    }));
}

/** One expected `"diagnostic"` FileDiff, identified by the two fields `idOf` (upgrade-baseline.ts)
 * keys on for this kind. `detail` (the diagnostic's `message`) is deliberately NOT asserted: it is
 * the raw wording of an underlying parse failure, which is free to change (spec §3 pins only
 * `code`), and `idOf` never reads it. */
interface ExpectedDiagnostic {
  code: DiagnosticCode;
  gamePath: string;
}

/** Total order on a diagnostic's `(gamePath, code)` identity — the two fields `idOf`
 * (upgrade-baseline.ts) keys on for this kind. Hoisted so BOTH sides of
 * `assertExpectedDiagnostics`' comparison sort by it. Sorting only `actual` would be correct today
 * (one entry), but the EXPECTED table is hand-authored: a second entry written out of order would
 * fail the `toEqual` and the message would blame the emitter for what is really a table-ordering
 * artifact. */
function compareDiagnosticIdentity(
  a: { gamePath: string; code?: string },
  b: { gamePath: string; code?: string },
): number {
  return (
    compareOrdinal(a.gamePath, b.gamePath) ||
    compareOrdinal(a.code ?? "", b.code ?? "")
  );
}

/**
 * Packs whose `"diagnostic"` diff set is asserted EXACTLY — and, having been confirmed, is then
 * CONSUMED rather than ratcheted (see `assertExpectedDiagnostics`' return value and its use in
 * `registerUpgradeCheck`).
 *
 * WHY THIS EXISTS, and why the ratchet alone is not enough. `compareToBaseline` passes when
 * `actual ⊆ baseline` — a diff that DISAPPEARS is deliberately read as an improvement. That is the
 * right semantics for a burn-down ratchet of byte divergences, but it makes a blessed baseline
 * useless as a pin on the machinery that PRODUCES the entry: bless the diagnostic in, then delete
 * `...diagnostics` from `registerUpgradeCheck`'s `diff.files` spread, and `actual` becomes empty —
 * still a subset, still green. The `"diagnostic"` kind would go back to having zero live coverage
 * without a single test turning red. See
 * docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md §7.
 *
 * So this table is an EXACT-match expectation, not a subset one, and `assertExpectedDiagnostics`
 * reads it off `diff.files` — the assembled array the ratchet scores — rather than off the local
 * `diagnostics` variable. That is what makes dropping the spread a failure rather than a silent
 * downgrade.
 *
 * WHAT IT PINS (and what it does not): emitter -> `diagnosticsToFileDiffs` -> `diff.files`. It does
 * NOT pin the last hop, `diff.files` -> `compareToBaseline`/`saveBaseline`; that stays covered by
 * `test/helpers/upgrade-baseline.test.ts` plus the two-line locality at the call site below.
 *
 * AND IT REPLACES A BASELINE ENTRY. Once confirmed here, these entries are dropped from what
 * `registerUpgradeCheck` ratchets — the same "confirm, don't merely tolerate" shape DIVERGENCE_RULES
 * (upgrade-compare.ts) uses for payload bytes. The alternative (bless the diagnostic into the
 * gitignored baseline) was rejected: this pack's ONLY diff is its diagnostic, so that entry would be
 * permanent and un-burn-down-able, AGENTS.md is explicit that a divergence recorded only in a
 * gitignored baseline is not documented, and any fresh setup that ran `npm run synthetics` without
 * blessing would go red with a regression naming a gamePath and no cause. Consuming it here means
 * the pack needs no baseline file at all. See the diagnostics-channel spec §7.2.
 *
 * Keyed by pack file name (lowercased). A pack listed here must be present in the corpus — enforced
 * by test/corpus-guard.test.ts, so deleting the pack cannot silently retire the pin either.
 */
export const EXPECTED_PACK_DIAGNOSTICS: ReadonlyMap<
  string,
  readonly ExpectedDiagnostic[]
> = new Map([
  [
    // scripts/generate-synthetics/build-synthetic-hair-transform-failure.ts — one loose hair
    // normal/specular pair whose normal is a well-formed 40x40 A8R8G8B8 texture. The NPOT pre-resize
    // (EndwalkerUpgrade.cs:1195-1198) rounds 40 down to 32 (IOUtil.cs:905-911), so MergePixelData's
    // post-resize `< 64` size guard (Tex.cs:656-660) throws and EndwalkerUpgrade.cs:1498-1501's
    // swallow fires exactly once. (NOT a truncated .tex — see that builder's header.) ConsoleTools
    // /upgrade swallows identically (verified 2026-08-02), so the pack's BYTES match the golden and
    // this diagnostic is its only recorded diff.
    "hair-transform-failure.pmp",
    [
      {
        code: DiagnosticCode.HairTransformFailed,
        // The hair table's Dx11 normal destination for c0101 h0001 (src/upgrade/reference/
        // hair-materials.ts), which unclaimed-hair.ts:238 reports as the diagnostic's gamePath.
        gamePath:
          "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_norm.tex",
      },
    ],
  ],
]);

/** Assert a listed pack's `"diagnostic"` entries in `files` are EXACTLY the expected set (see
 * EXPECTED_PACK_DIAGNOSTICS), and RETURN those entries as CONFIRMED — the caller drops them from
 * what it ratchets, so a pack whose only diff is its committed diagnostic needs no baseline file.
 *
 * Returns `[]` for an unlisted pack: nothing confirms its diagnostics, so nothing is consumed and
 * they reach the ratchet as regressions exactly as before. Returning `[]` on the throwing path is
 * moot — `expect.fail` never returns.
 *
 * Note the return is the ORIGINAL FileDiff objects out of `files` (identity, not copies), which is
 * what lets the caller subtract them by reference without re-deriving an identity. Exported for unit
 * testing (test/helpers/corpus-upgrade.test.ts). */
export function assertExpectedDiagnostics(
  name: string,
  files: FileDiff[],
): FileDiff[] {
  const expected = EXPECTED_PACK_DIAGNOSTICS.get(name.toLowerCase());
  if (expected === undefined) return [];
  const confirmed = files.filter((f) => f.kind === "diagnostic");
  const actual = confirmed
    .map((f) => ({ code: f.code, gamePath: f.gamePath }))
    .sort(compareDiagnosticIdentity);
  expect(
    actual,
    `${name}: the pack's "diagnostic" diffs must match EXACTLY. A MISSING one means either the ` +
      `emitting site stopped emitting or the diagnostics wiring no longer reaches diff.files — ` +
      `neither of which the subset-based ratchet can see. An EXTRA one is a new swallowed failure.`,
  ).toEqual([...expected].sort(compareDiagnosticIdentity));
  // Only reached when the assertion held, so every entry here is one the table confirms.
  return confirmed;
}

// End-to-end golden check: our upgrade pipeline vs the cached ConsoleTools /upgrade output,
// diffed per gamePath on decompressed content, exact-byte except for confirmed intentional
// divergences, ratcheted against a gitignored per-pack baseline (see the harness design spec).
export function registerUpgradeCheck(pack: string): void {
  const name = basename(pack);
  describe(`upgrade golden: ${name}`, () => {
    it("matches ConsoleTools /upgrade within the ratchet baseline", () => {
      const bytes = new Uint8Array(readFileSync(pack));
      const golden = upgradeGoldenCached(name, bytes);
      if (golden === null) {
        throw new Error(
          `No /upgrade golden for ${name}: uncached and no oracle (TexTools) available. ` +
            `Run with ConsoleTools installed to populate test/corpus/.upgrade-cache.`,
        );
      }
      // The oracle itself errored on this pack (e.g. ModpackUpgrader's Highlight/Visibility
      // "unresolveable" throw). A MATCHED failure is a PASS: our port must refuse exactly the packs
      // TexTools refuses. Our upgrade SUCCEEDING here is a divergence -> loud fail. (Deliberately
      // unlike corpus-resave.ts's loud-skip: a /resave oracle error is environmental — a TexTools
      // CMP-read crash unrelated to our port — whereas a /upgrade oracle error is transform logic
      // our port is expected to reproduce. See spec §3 + docs/backlog/2026-07-11-expected-failure-golden.md.)
      //
      // `loadModpack` runs INSIDE the assertion, not before it. ConsoleTools' /upgrade covers
      // load+transform in one call (HandleUpgrade -> WizardData.FromModpack -> UpgradeModpack), so a
      // pack the oracle refuses at LOAD is refused just as legitimately by our loader — e.g. an
      // unrecognized PMP group `Type`, which throws inside `PMP.LoadPMP` (see parsePmpGroup). Loading
      // outside this branch made such a throw escape the assertion and fail the test as an error
      // instead of passing as the matched failure it is.
      if (golden.kind === "error") {
        assertMatchedUpgradeFailure(name, golden.message, () =>
          upgradeModpack(loadModpack(name, bytes)),
        );
        // This branch returns BEFORE `assertExpectedDiagnostics` runs, so a pack with a committed
        // expectation landing here would silently stop being pinned — and nothing else would notice:
        // corpus-guard.test.ts only checks the pack is PRESENT, and it is; it is just no longer
        // exercised. Reachable without anyone touching this file (a future ConsoleTools that refuses
        // the pack, or a stale/spurious `.error` marker left in the cache), so say so loudly.
        if (EXPECTED_PACK_DIAGNOSTICS.has(name.toLowerCase())) {
          expect.fail(
            `${name}: carries an exact diagnostic expectation but the ORACLE errored on it, so the ` +
              `pin never runs. Delete its .upgrade-cache .error marker and re-run, or retire the entry.`,
          );
        }
        return;
      }
      // ONE load of the source, reused three ways below (upgrade input, no-op reference, and the
      // source ExtraFiles key set). Safe because upgradeModpack cloneModpack()s and never mutates
      // its argument (src/upgrade/upgrade.ts). Re-loading cost ~3s per big PMP, three times over.
      const source = loadModpack(name, bytes);
      const oursResult = upgradeModpack(source);
      // The oracle produced a pack and we did not — a divergence, and the corpus-wide net under spec
      // §4.2 catching a fatal site quietly downgraded. `writeModpack` would reject a null anyway (it
      // takes ModpackData, not ModpackData | null), but a type error names no pack and gives no
      // reasons; this does. It also forecloses a careless `.data!` here later.
      if (!oursResult.ok) {
        expect.fail(
          `${name}: ConsoleTools /upgrade produced a pack but OUR upgrade failed — divergence.\n` +
            oursResult.diagnostics
              .map((d) => `  [${d.code}] ${d.message}`)
              .join("\n"),
        );
      }
      const diagnostics = diagnosticsToFileDiffs(oursResult.diagnostics);
      const oursModel = oursResult.data;
      // A no-op upgrade writes no golden; the correct reference is the original input, so this
      // still exercises our whole load->upgrade->reduce->serialize pipeline end to end.
      const reference = golden.kind === "noop" ? source : golden.data;

      // Exercise the real writer on the oracle path (audit blind spot #5): the archive it produces
      // now feeds BOTH the structure/manifest diff below AND the payload diff (see next comment) —
      // the payload diff used to run on the in-memory model and so was blind to the writer entirely.
      // See the parity design spec.
      const target = name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
      // store: the archive we write here is only ever re-READ (below, and by diffArchives /
      // pmpSelfConsistency), and nothing compares its compressed bytes — so DEFLATE-ing it is work
      // whose only consumer immediately inflates it again. See writePmp's doc comment.
      const oursArchive = writeModpack(oursModel, target, { store: true });
      // Diff the ARTIFACT WE SHIP, not the in-memory model. Feeding `oursModel` here made every
      // writer bug invisible by construction: a file the writer emits with no `Files` key naming it
      // is a perfectly good file in the model and an unreachable orphan in the pack. Re-reading
      // closes that gap — such a file comes back as an ExtraFile, drops out of `allFiles`, and its
      // gamePath shows as `added` against the golden. (It also puts the whole write->read round-trip
      // under the golden oracle for free.)
      // Re-read under the WRITTEN format (`target`), NOT the source `name`: our writer folds the
      // whole TTMP family to ttmp2 (there is no legacy-.ttmp writer), so a legacy `.ttmp` source is
      // written as ttmp2. Re-reading it under the `.ttmp` name would send the ttmp2 zip to
      // readLegacyTtmp, which silently yields an EMPTY pack — making every file show as `added`
      // against the golden (a whole-pack phantom divergence). The golden side already folds this way
      // (upgrade-golden.ts goldenExt). See docs/backlog/2026-07-17-harness-legacy-ttmp-reread-format.md.
      const oursReRead = loadModpack(`ours.${target}`, oursArchive);

      const payload = diffUpgrade(
        name,
        oursReRead,
        reference,
        confirmDivergence,
      );
      // A NO-OP golden means ConsoleTools wrote NO ARCHIVE, so `reference` above is the UNTOUCHED
      // INPUT PACK — a Penumbra export whose layout and manifest spelling TexTools'
      // writer never produced. Comparing our member NAMES or manifest JSON against it asserts "our
      // writer reproduces this author's arbitrary choices", which has no oracle behind it and takes
      // our own writer as ground truth. So on this branch we do NOT call diffArchives at all.
      //
      // What replaces it:
      //  - CONTENT is still compared, by `diffUpgrade` above, keyed by gamePath — the assertion the
      //    harness spec designed for this branch (2026-07-04-upgrade-golden-harness-design.md §4.3).
      //  - The TRANSFORM is asserted directly below, mirroring the very predicate the oracle
      //    branches on when it declines to write (ModpackUpgrader.cs · AnyChanges · 25-49). This is
      //    STRICTER than diffUpgrade in one way that matters: it is keyed per OPTION, so a file
      //    moving between options is caught where diffUpgrade's whole-pack multiset flattens it away.
      //  - WRITER PARITY is covered by registerResaveCheck (corpus-resave.ts) against a real
      //    ConsoleTools /resave golden. /upgrade and /resave are the same call minus the transform
      //    (Program.cs:204-211 vs ModpackUpgrader.cs:58 + :212-219), so when /upgrade no-ops the
      //    /resave golden IS what /upgrade would have written. The two harnesses stay INDEPENDENT:
      //    this branch deliberately does not consult /resave's cache or its error markers.
      //
      // See docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md.
      const noopReference = golden.kind === "noop";
      const transform = noopReference
        ? transformChanges(source, oursModel)
        : [];

      // Payload member NAMES are now comparable on the real-golden branch too: our writer
      // regenerates them the TexTools way (optionPrefix + gamePath, content-deduped into
      // common/N). This is strictly stronger than the payload diff: a member name IS
      // `<optionPrefix><gamePath>`, so it catches a file landing in the WRONG OPTION -- which
      // diffUpgrade's whole-pack, gamePath-keyed multiset flattens away entirely. Scoped to PMP
      // only: a TTMP's single opaque "TTMPD.mpd" blob is not a PMP-shaped payload member (see
      // diffArchives' doc comment).
      //
      // `layoutEquivalent` (and the `readZip` it costs — a full zip parse, up to 457 MB for the
      // biggest corpus pack) is only computed on THIS branch, because it is only ever consumed by
      // the `diffArchives` call below: on the no-op branch `diffArchives` does not run at all (see
      // the comment above), so there is nothing here for it to gate. Gated on the INPUT pack
      // carrying FileSwaps, not on `ours` or the golden — PopulatePmpStandardOption (PMP.cs:873-875)
      // has already destroyed the golden's swaps by the time we'd read it here, so gating on the
      // golden would never fire. See the FileSwap-preservation spec, §5.2.
      let archive: FileDiff[] = [];
      if (!noopReference) {
        const layoutEquivalent = packHasFileSwaps(readZip(bytes));
        if (layoutEquivalent) {
          console.log(
            `[upgrade] ${name}: input carries FileSwaps -> payload compared SEMANTICALLY ` +
              `(redirect table, not member names). See the FileSwap-preservation spec, §5.2.`,
          );
        }
        archive = diffArchives(
          oursArchive,
          golden.bytes,
          target === "pmp",
          confirmDivergence,
          layoutEquivalent,
        );
      }
      // Oracle-free invariant on OUR OWN artifact: no dangling `Files` key, no orphan member.
      // Independent of the golden, so it still guards a pack ConsoleTools cannot upgrade or that
      // has no golden at all. PMP-only: a TTMP has no per-file zip members to orphan.
      const selfDiffs =
        target === "pmp"
          ? pmpSelfConsistency(
              oursArchive,
              new Set(source.extraFiles?.keys() ?? []),
            )
          : [];

      const diff = {
        ...payload,
        files: [
          ...payload.files,
          ...archive,
          ...selfDiffs,
          ...transform,
          ...diagnostics,
        ],
      };
      // Runs on BOTH branches (before the bless early-return): blessing must not be able to record
      // a diagnostic set that differs from the one this pack is committed to produce. And it runs
      // against the ASSEMBLED `diff.files`, BEFORE the filtering below — that is what makes deleting
      // `...diagnostics` from the spread above a red test rather than a silent downgrade.
      const confirmedDiagnostics = new Set(
        assertExpectedDiagnostics(name, diff.files),
      );
      // A CONFIRMED diagnostic is consumed by that expectation and never ratcheted — the same shape
      // DIVERGENCE_RULES (upgrade-compare.ts) gives a confirmed payload divergence. It is a stronger
      // assertion than a baseline entry (exact match, committed, versus a gitignored subset), so
      // ratcheting it too would only add a permanent baseline file that no one can burn down and
      // that fails a fresh, unblessed setup for no legible reason. An UNCONFIRMED diagnostic — any
      // diagnostic on a pack with no table entry — is untouched here and still reaches the ratchet
      // as a regression. See the diagnostics-channel spec §7.2.
      const ratcheted =
        confirmedDiagnostics.size === 0
          ? diff.files
          : diff.files.filter((f) => !confirmedDiagnostics.has(f));
      const key = oracleKey(bytes);

      if (BLESS) {
        saveBaseline(key, ratcheted);
        console.log(
          `[upgrade] blessed ${name}: ${diff.matched} matched, ${ratcheted.length} recorded` +
            (confirmedDiagnostics.size > 0
              ? ` (${confirmedDiagnostics.size} confirmed diagnostic(s) not ratcheted)`
              : ""),
        );
        return;
      }

      const baseline = loadBaseline(key) ?? [];
      const { ok, regressions } = compareToBaseline(ratcheted, baseline);
      console.log(
        `[upgrade] ${name}: ${diff.matched} matched, ${ratcheted.length} diffs, ` +
          `${regressions.length} regressions (baseline ${baseline.length})` +
          (confirmedDiagnostics.size > 0
            ? `, ${confirmedDiagnostics.size} confirmed diagnostic(s)`
            : ""),
      );
      if (!ok) {
        expect.fail(
          `upgrade regressions in ${name}: ` +
            regressions
              .map((r) => `${r.gamePath}#${r.index}:${r.status}`)
              .join(", "),
        );
      }
      // 20 min: a cold cache spawns ConsoleTools /upgrade once for this pack (seconds for a big
      // pack); generous so the first, cache-populating run never times out. Warm runs are ~instant.
    }, 1_200_000);
  });
}
