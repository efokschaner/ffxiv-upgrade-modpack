/**
 * Declared-rule registry for the `/resave` harness — the resave-side counterpart to
 * `upgrade-compare.ts`'s `ORACLE_ERROR_DIVERGENCE_RULES`.
 *
 * WHAT IT IS FOR. A `/resave` oracle error is not one thing, and the two kinds want OPPOSITE
 * outcomes:
 *
 *  - ENVIRONMENTAL — TexTools failing at work whose inputs come from the MACHINE, not the pack. The
 *    canonical case is `Milktruck Bust Scaling Tweaks v1.0.0.ttmp2`, whose `.rgsp` files send
 *    TexTools' write path into `CMP.GetScalingParameter` -> the INSTALLED GAME's `human.cmp`, which
 *    the (then-)pinned build could not read: `System.Exception: CMP Format Changed - Unable to read
 *    all CMP data.` Nothing about that is a property of the pack — it evaporated when upstream fixed
 *    the offset — so asserting our port must fail too would pin a failure with no modpack-semantic
 *    meaning, and would invert the day the environment changes. The correct outcome is the loud skip
 *    `registerResaveCheck` already performs (writer explicitly UNVERIFIED). See
 *    docs/backlog/2026-07-19-resave-oracle-error-skips-all-assertions.md, which is explicit that the
 *    item must NOT be closed by making that branch a blanket matched-failure assertion.
 *
 *  - SEMANTIC REFUSAL — TexTools declining the pack on its BYTES, at a seam this port reproduces.
 *    Both implementations refuse for the same reason, deterministically, on any machine. That is a
 *    MATCHED FAILURE and therefore a PASS, exactly as on the `/upgrade` side
 *    (`assertMatchedUpgradeFailure`, test/helpers/corpus-upgrade.ts).
 *
 * This registry is what separates them, and it does so by DECLARATION, never by inference. There is
 * no "an InvalidDataException looks semantic" heuristic: a refusal is matched only when a committed
 * entry below names the C# that throws it and the port site that reproduces it. An oracle error
 * matching no rule falls through to the unchanged environmental branch.
 *
 * KEYED ON THE FAILURE SIGNATURE, NEVER ON A PACK NAME — same discipline as
 * ORACLE_ERROR_DIVERGENCE_RULES. One rule then covers every pack that trips the same TexTools
 * refusal, today's corpus fixture and tomorrow's user upload alike, with nothing blessed per-pack.
 * A matched failure records NO ratchet baseline entry.
 *
 * See docs/superpowers/specs/2026-08-09-resave-matched-failure-design.md.
 */

/** One refusal BOTH implementations perform, for the same reason, decided by the pack's bytes.
 *
 * Three fields do three different jobs, and it is the combination that makes the pairing sound
 * rather than merely plausible (spec §2.1):
 *  - `matchesOracle` SELECTS the rule off the oracle's captured trace. It keys on the exception
 *    SIGNATURE — message text AND throwing frame — not on the message alone; that is what keeps an
 *    environmental failure from ever selecting a rule.
 *  - `ourRefusal` CONFIRMS our own side refused for the DECLARED reason, not merely that it refused.
 *    Compared by exact (whitespace-normalized) equality, which is stricter than the `/upgrade`
 *    side's containment test and deliberately brittle: the string is a ported constant, byte-identical
 *    to the C# message, so drift should be a red.
 *  - the caller additionally checks `ourRefusal` appears WITHIN the oracle trace, proving the two
 *    halves are the SAME refusal rather than two independently-declared ones the table happens to
 *    pair (`assertMatchedResaveFailure`, test/helpers/corpus-resave.ts).
 */
export interface ResaveMatchedFailureRule {
  /** Why this refusal is one we reproduce rather than one we should have avoided. */
  reason: string;
  /** The C# that throws it, cited `file · symbol · lines`. */
  csharp: string;
  /** The site in `src/` that reproduces it. */
  port: string;
  /** Matches the ORACLE's captured trace. Key on the failure signature, never on a pack name. */
  matchesOracle: (oracleTrace: string) => boolean;
  /** The EXACT message our port throws for this refusal. */
  ourRefusal: string;
}

export const RESAVE_MATCHED_FAILURE_RULES: ResaveMatchedFailureRule[] = [
  {
    reason:
      "PMP Combining group on the WRITE path. TexTools accepts a Combining group at LOAD as of the " +
      "v3.1.1.4 pin (upstream 76535f4 registered the subtype, PMP.cs:1494 + :1565) and then refuses " +
      "to write one back out, one stage later. The refusal is decided entirely by the pack's own " +
      "`Type` discriminator — no game data, no machine state — so it is reproducible everywhere, and " +
      "this port performs it at the same seam with a byte-identical message. Supporting Combining " +
      "groups is deliberately unported (docs/backlog/2026-08-09-pmp-combining-group-support.md); " +
      "reproducing the refusal is the faithful behaviour, not a gap.",
    csharp:
      "WizardData.cs · WizardGroupEntry.ToPmpGroup · 897-900 (via WritePmp · 1613)",
    port: "src/container/pmp.ts · writePmp · group-assembly loop",
    // TWO independent signals, deliberately: the message text AND the throwing frame. The message
    // alone would already be specific, but keying on the frame too is what makes it structurally
    // impossible for an environmental failure that merely quotes similar words to select this rule.
    // Measured verbatim from ConsoleTools v3.1.1.4 on `Parent Settings.pmp`, 2026-08-09 (the trace
    // cached at test/corpus/.resave-cache/c41612a6….error).
    matchesOracle: (trace) =>
      /System\.IO\.InvalidDataException: Editing or exporting PMP Combining groups is not supported\./.test(
        trace,
      ) && /WizardGroupEntry\.<ToPmpGroup>/.test(trace),
    // Byte-identical to the C# string — src/container/pmp.ts throws it undecorated for exactly this
    // reason (see the comment on that throw).
    ourRefusal: "Editing or exporting PMP Combining groups is not supported.",
  },
];

/** Whitespace-normalized comparison form. A captured .NET trace is full of newlines and leading
 *  indentation; our thrown message is a single line. Same normalization
 *  `assertMatchedUpgradeFailure` uses (test/helpers/corpus-upgrade.ts). */
export function normalizeFailureText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The rule the ORACLE's captured trace selects, or `undefined` — in which case the error is NOT a
 *  declared semantic refusal and the caller must keep treating it as environmental (loud skip,
 *  writer UNVERIFIED). Consumed by `registerResaveCheck`. */
export function matchResaveFailure(
  oracleTrace: string,
  rules: readonly ResaveMatchedFailureRule[] = RESAVE_MATCHED_FAILURE_RULES,
): ResaveMatchedFailureRule | undefined {
  return rules.find((r) => r.matchesOracle(oracleTrace));
}

/**
 * The rule declaring `message` as a refusal OUR OWN writer deliberately performs, or `undefined`.
 *
 * Reads only the `ourRefusal` half, which is a statement about our port and needs no oracle at all —
 * which is what lets `registerGoldenCheck` (test/helpers/corpus-golden.ts) use it. That check is a
 * pure SELF round-trip (load -> write -> load) with no ConsoleTools anywhere in it, and for a pack
 * our writer deliberately refuses there is no artifact to round-trip: the assertion is inapplicable,
 * not failing. It must still not swallow write throws in general, so it asks this function whether
 * the throw is a DECLARED refusal and re-throws anything else.
 *
 * NOT a coupling of the two harnesses in the sense the 2026-07-19 operator ruling forbids: that
 * ruling is about one check reading ANOTHER CHECK'S ORACLE CACHE (a runtime dependency that would let
 * a cached verdict decide an unrelated outcome). This is a committed declaration in source, and the
 * half read here never consults an oracle. The alternative — a second table listing the same ported
 * refusals, kept in agreement by hand — is strictly worse. See spec §3.
 */
export function declaredPortedRefusal(
  message: string,
  rules: readonly ResaveMatchedFailureRule[] = RESAVE_MATCHED_FAILURE_RULES,
): ResaveMatchedFailureRule | undefined {
  const norm = normalizeFailureText(message);
  return rules.find((r) => normalizeFailureText(r.ourRefusal) === norm);
}
