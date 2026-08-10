import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModpack, writeModpack } from "../../src/index";
import { readZip } from "../../src/zip/zip";
import { packHasFileSwaps } from "./archive-redirects";
import { oracleKey } from "./oracle";
import { makeV4ExtraFileDuplicateConfirmation } from "./pmp-v4-extrafile-divergence";
import {
  matchResaveFailure,
  normalizeFailureText,
  type ResaveMatchedFailureRule,
} from "./resave-compare";
import { DEFAULT_RESAVE_BASELINE, resaveGoldenCached } from "./resave-golden";
import { diffArchives } from "./upgrade-archive-diff";
import {
  compareToBaseline,
  loadBaseline,
  saveBaseline,
} from "./upgrade-baseline";
import { confirmDivergence } from "./upgrade-compare";
import { diffUpgrade } from "./upgrade-diff";

const BLESS = process.env.UPDATE_UPGRADE_BASELINE === "1";

/**
 * Assert our port matches a ConsoleTools /resave oracle error that a `RESAVE_MATCHED_FAILURE_RULES`
 * entry has already declared to be a SEMANTIC REFUSAL (test/helpers/resave-compare.ts — the caller
 * does the rule lookup, so reaching this function already means "not environmental"). A matched
 * failure is a PASS: our port must refuse exactly the packs TexTools refuses, for the declared
 * reason. Our load+write SUCCEEDING here is a divergence -> loud fail.
 *
 * Mirrors `assertMatchedUpgradeFailure` (test/helpers/corpus-upgrade.ts) with one deliberate
 * difference: that function verifies a matched REASON by containment alone (our thrown text must
 * appear somewhere in the oracle's trace), because a /upgrade refusal can surface from any of a
 * dozen ported sites. Here the rule names the exact refusal, so this asserts BOTH
 *   (a) our message is EXACTLY the rule's `ourRefusal` — which refusal, not just that we refused; and
 *   (b) that same string appears in the oracle's trace — proving the two halves are the SAME refusal
 *       rather than two independently-declared ones the table happens to pair.
 * (b) is near-implied by the rule's own `matchesOracle` today, and kept anyway: `matchesOracle` is
 * free to key purely on a stack frame, and this check is what keeps the pairing honest if it ever
 * does. See spec §2.1.
 *
 * `runResave` spans load + write, because ConsoleTools' /resave does (Program.cs:191-221 ->
 * WizardData.FromModpack then WriteModpack): a pack the oracle refuses at LOAD is refused just as
 * legitimately by our loader, and one it refuses at WRITE (the live case — the Combining group) can
 * only be matched if our writer runs inside the assertion. Both seams THROW; neither has a
 * diagnostics channel, so unlike the /upgrade side there is no ok:false result to inspect.
 *
 * Exported for unit testing (test/helpers/resave-compare.test.ts).
 */
export function assertMatchedResaveFailure(
  name: string,
  oracleMessage: string,
  rule: ResaveMatchedFailureRule,
  runResave: () => void,
): void {
  let ourMessage: string | undefined;
  try {
    runResave();
  } catch (e) {
    ourMessage = e instanceof Error ? e.message : String(e);
  }
  if (ourMessage === undefined) {
    expect.fail(
      `${name}: ConsoleTools /resave REFUSED this pack (${rule.csharp}) but our load+write ` +
        `SUCCEEDED — divergence. We must reproduce the refusal at ${rule.port}.\n` +
        `Rule: ${rule.reason}\nOracle error was:\n${oracleMessage}`,
    );
  }
  if (
    normalizeFailureText(ourMessage) !== normalizeFailureText(rule.ourRefusal)
  ) {
    expect.fail(
      `${name}: our /resave threw, but not the refusal this rule declares — a matched failure must ` +
        `be the SAME refusal our port reproduces from ${rule.csharp}.\n` +
        `Expected (rule.ourRefusal):\n${rule.ourRefusal}\n\nOur error:\n${ourMessage}\n\n` +
        `Oracle error:\n${oracleMessage}`,
    );
  }
  if (
    !normalizeFailureText(oracleMessage).includes(
      normalizeFailureText(rule.ourRefusal),
    )
  ) {
    expect.fail(
      `${name}: the rule's declared refusal text does not appear in the ORACLE's trace, so the two ` +
        `sides are not demonstrably the same refusal — the rule pairs a C# throw with a port message ` +
        `that TexTools never emitted.\nRule (${rule.csharp}) declares:\n${rule.ourRefusal}\n\n` +
        `Oracle error:\n${oracleMessage}`,
    );
  }
  console.log(
    `[resave] ${name}: matched expected refusal (oracle + our port both refuse — ${rule.csharp}).`,
  );
}

/**
 * WRITE-SIDE golden check: load + load-time fixes + write, vs ConsoleTools /resave — the same
 * load path /upgrade takes (Program.cs:204 -> WizardData.FromModpack), minus the transform. This is
 * the first thing in the suite to AB-test our WRITERS against TexTools at all, and — since the
 * /upgrade harness's no-op branch no longer compares member names or manifest JSON against anything
 * (see docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md) — the SOLE
 * writer-parity oracle for a pack that no-ops under /upgrade.
 *
 * Ratcheted against its own baseline dir (the key is sha256(input pack) for both harnesses, so a
 * shared dir would collide).
 */
export function registerResaveCheck(pack: string): void {
  const name = basename(pack);
  describe(`resave golden: ${name}`, () => {
    it("matches ConsoleTools /resave within the ratchet baseline", (ctx) => {
      const bytes = new Uint8Array(readFileSync(pack));
      const target = name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";

      // The GOLDEN IS FETCHED FIRST, before our own load/write runs. Until 2026-08-09 this file
      // called loadModpack + writeModpack up here, ABOVE this fetch — which meant a pack our writer
      // deliberately REFUSES (a ported throw, e.g. the PMP Combining refusal) escaped the it() as a
      // test error and never reached the `kind === "error"` branch below at all, so the refusal
      // could not be asserted against the oracle's matching refusal. Same seam, same reason, as
      // registerUpgradeCheck's `runUpgrade` closure (corpus-upgrade.ts): a pack the oracle refuses
      // at LOAD or at WRITE is refused just as legitimately by our loader or writer, so both must
      // run INSIDE the assertion that knows what the oracle did.
      const result = resaveGoldenCached(name, bytes);
      if (result === null) {
        throw new Error(
          `No /resave golden for ${name}: uncached and no oracle (TexTools) available. ` +
            `Run with ConsoleTools installed to populate test/corpus/.resave-cache.`,
        );
      }
      if (result.kind === "error") {
        // The ORACLE errors on this input. TWO KINDS, wanting opposite outcomes (spec §1.1) —
        // separated by a DECLARED rule, never inferred:
        //
        //  1. SEMANTIC REFUSAL (a rule matches): TexTools declined the pack on its BYTES, at a seam
        //     this port reproduces — e.g. WizardGroupEntry.ToPmpGroup's Combining refusal
        //     (WizardData.cs:897-900). Both implementations refuse for the same reason on any
        //     machine, so this is a MATCHED FAILURE and therefore a PASS, exactly as on the
        //     /upgrade side. Nothing is ratcheted and nothing is suppressed.
        //  2. ENVIRONMENTAL (no rule matches): TexTools failed at work whose inputs come from the
        //     MACHINE, not the pack — its RSP-manipulation write path reading the installed game's
        //     human.cmp and throwing "CMP Format Changed". There is nothing to diff our writer
        //     against and nothing meaningful to assert, so this stays neither a pass nor a generic
        //     skip: log loudly and mark the writer explicitly UNVERIFIED, rather than letting the
        //     suite go quietly green as if it had matched.
        //
        // Case 2 is the pre-existing behaviour and is UNCHANGED. See
        // docs/backlog/2026-07-19-resave-oracle-error-skips-all-assertions.md, which is explicit
        // that the environmental case must NOT become a matched-failure assertion — and
        // test/helpers/resave-compare.test.ts, which pins that the recorded Milktruck CMP trace
        // matches no rule.
        const rule = matchResaveFailure(result.message);
        if (rule !== undefined) {
          assertMatchedResaveFailure(name, result.message, rule, () => {
            writeModpack(loadModpack(name, bytes), target, { store: true });
          });
          return;
        }
        const message =
          `ConsoleTools /resave CANNOT round-trip ${name} — the oracle itself errors, so our ` +
          `writer is UNVERIFIED (not matched, not passing) for this pack. See ` +
          `docs/backlog/2026-07-11-expected-failure-golden.md. Oracle error:\n` +
          result.message;
        console.error(`[resave] UNVERIFIED: ${message}`);
        ctx.skip(message);
        return;
      }

      // loadModpack returns already-load-fixed data (FixOldTexData/FixOldModel fused into the read
      // seam, matching WizardData.FromModpack) — the same fixes this line used to apply via
      // applyLoadFixes(), now upstream. TexTools' load is not inert for old packs.
      const ours = loadModpack(name, bytes);
      // store: only the archive's member names and DECOMPRESSED content are diffed against the
      // golden (diffArchives / diffUpgrade), never its deflated bytes. See writePmp's doc comment.
      const oursArchive = writeModpack(ours, target, { store: true });
      const goldenBytes = result.bytes;
      const golden = loadModpack(`golden.${target}`, goldenBytes);

      const payload = diffUpgrade(
        name,
        // Re-read under the WRITTEN format (`target`), NOT the source `name` — a legacy `.ttmp` is
        // written as ttmp2, and re-reading it as `.ttmp` sends the zip to readLegacyTtmp and yields
        // an empty pack. Same seam as corpus-upgrade.ts; see
        // docs/backlog/2026-07-17-harness-legacy-ttmp-reread-format.md.
        loadModpack(`ours.${target}`, oursArchive), // compare the ARTIFACT, same as corpus-upgrade
        golden,
        confirmDivergence,
      );
      // ONE readZip of the input, used by both the FileSwaps gate and the v4 ExtraFile-duplication
      // confirmation below. Both are properties of the INPUT pack — the cause — not of the diff.
      const inputMembers = readZip(bytes);
      // The gate comes from the INPUT pack, not `ours` or the golden — PopulatePmpStandardOption
      // (PMP.cs:966-968) has already destroyed the golden's swaps by the time we'd read it here, so
      // gating on the golden would never fire. See the FileSwap-preservation spec, §5.2.
      const layoutEquivalent = packHasFileSwaps(inputMembers);
      if (layoutEquivalent) {
        console.log(
          `[resave] ${name}: input carries FileSwaps -> payload compared SEMANTICALLY ` +
            `(redirect table, not member names). See the FileSwap-preservation spec, §5.2.`,
        );
      }
      // docs/TEXTOOLS_BUGS.md #23 — our one deliberate divergence on the v4 read path. `undefined`
      // for every non-v4 input, so no other pack is affected at all.
      const confirmGoldenOnlyMember =
        makeV4ExtraFileDuplicateConfirmation(inputMembers);
      if (confirmGoldenOnlyMember !== undefined) {
        console.log(
          `[resave] ${name}: v4 input -> golden-only payload members are checked against the ` +
            `ExtraFile-duplication confirmation (docs/TEXTOOLS_BUGS.md #23).`,
        );
      }
      // Payload MEMBER NAMES are compared here from the start (unlike the /upgrade harness, which
      // has to keep them off until the writer regenerates them): that is the whole point of this
      // check — the names are what the writer decides.
      const archive = diffArchives(
        oursArchive,
        goldenBytes,
        target === "pmp",
        undefined,
        layoutEquivalent,
        confirmGoldenOnlyMember,
      );
      const diff = { ...payload, files: [...payload.files, ...archive] };
      const key = oracleKey(bytes);

      if (BLESS) {
        saveBaseline(key, diff.files, DEFAULT_RESAVE_BASELINE);
        console.log(
          `[resave] blessed ${name}: ${diff.matched} matched, ${diff.files.length} recorded`,
        );
        return;
      }

      const baseline = loadBaseline(key, DEFAULT_RESAVE_BASELINE) ?? [];
      const { ok, regressions } = compareToBaseline(diff.files, baseline);
      console.log(
        `[resave] ${name}: ${diff.matched} matched, ${diff.files.length} diffs, ` +
          `${regressions.length} regressions (baseline ${baseline.length})`,
      );
      if (!ok) {
        expect.fail(
          `resave regressions in ${name}: ` +
            regressions
              .map((r) => `${r.gamePath}#${r.index}:${r.status}`)
              .join(", "),
        );
      }
    }, 1_200_000);
  });
}
