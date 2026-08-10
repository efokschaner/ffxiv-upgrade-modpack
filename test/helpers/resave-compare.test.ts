import { describe, expect, it } from "vitest";
import { assertMatchedResaveFailure } from "./corpus-resave";
import {
  declaredPortedRefusal,
  matchResaveFailure,
  RESAVE_MATCHED_FAILURE_RULES,
} from "./resave-compare";

/**
 * The REAL ConsoleTools v3.1.1.4 /resave trace for `Parent Settings.pmp`, verbatim from the cached
 * marker (test/corpus/.resave-cache/c41612a6….error, captured 2026-08-09). Inlined rather than read
 * from the cache: the corpus tree is gitignored, so a fresh clone has neither the pack nor the
 * marker, and this pin must hold everywhere.
 */
const COMBINING_TRACE =
  "Command failed: ConsoleTools.exe /resave in.pmp out.pmp\n" +
  "Loading Modpack: in.pmp\n" +
  "System.IO.InvalidDataException: Editing or exporting PMP Combining groups is not supported.\n" +
  "   at xivModdingFramework.Mods.WizardGroupEntry.<ToPmpGroup>d__18.MoveNext()\n" +
  "--- End of stack trace from previous location where exception was thrown ---\n" +
  "   at System.Runtime.ExceptionServices.ExceptionDispatchInfo.Throw()\n" +
  "   at xivModdingFramework.Mods.WizardData.<WritePmp>d__21.MoveNext()\n" +
  "   at xivModdingFramework.Mods.WizardData.<WriteModpack>d__15.MoveNext()\n" +
  "   at ConsoleTools.ConsoleTools.<HandleResaveModpack>d__8.MoveNext()";

/**
 * The REAL /resave trace for `Milktruck Bust Scaling Tweaks v1.0.0.ttmp2` — the ENVIRONMENTAL case,
 * quoted from docs/backlog/2026-07-11-expected-failure-golden.md (captured under the former v3.1.0.2
 * pin). TexTools' write path converts each `.rgsp` into an RSP manipulation, which reads the
 * INSTALLED GAME's `human.cmp`; that build could not read the patch-7.5 layout.
 *
 * It has to be inlined here rather than taken from the corpus cache for a reason worth stating: at
 * the current v3.1.1.4 pin this pack NO LONGER ERRORS (upstream back-anchored the CMP offset fix), so
 * `.resave-cache` holds no marker for it and the live corpus cannot supply the negative case at all.
 * A committed test is the only thing that can keep the guarantee — see spec §5.
 */
const MILKTRUCK_CMP_TRACE =
  "Command failed: ConsoleTools.exe /resave in.ttmp2 out.ttmp2\n" +
  "System.Exception: CMP Format Changed - Unable to read all CMP data.\n" +
  "   at xivModdingFramework.General.DataContainers.CharaMakeParameterSet..ctor(Byte[] data)\n" +
  "   at xivModdingFramework.General.CMP.GetScalingParameter(...)\n" +
  "   at xivModdingFramework.Mods.FileTypes.PMP.PMP.ManipulationsToMetadata(...)\n" +
  "   at xivModdingFramework.Mods.WizardOptionEntry.ToModOption(...)\n" +
  "   at xivModdingFramework.Mods.WizardData.WriteModpack(...)\n" +
  "   at ConsoleTools.ConsoleTools.HandleResaveModpack(...)";

const COMBINING_REFUSAL =
  "Editing or exporting PMP Combining groups is not supported.";

describe("matchResaveFailure", () => {
  it("selects the Combining rule for the real ConsoleTools /resave trace", () => {
    const rule = matchResaveFailure(COMBINING_TRACE);
    expect(rule).toBeDefined();
    expect(rule?.ourRefusal).toBe(COMBINING_REFUSAL);
    expect(rule?.csharp).toMatch(/WizardData\.cs/);
  });

  // THE GUARD THIS FILE EXISTS FOR. An environmental oracle failure must never select a rule: the
  // /resave harness's loud skip (writer UNVERIFIED) is the correct outcome for it, and
  // docs/backlog/2026-07-19-resave-oracle-error-skips-all-assertions.md is explicit that turning
  // that branch into a matched-failure assertion would be wrong. If a future rule is written loosely
  // enough to swallow this trace, this test is what catches it.
  it("selects NO rule for the environmental Milktruck CMP trace", () => {
    expect(matchResaveFailure(MILKTRUCK_CMP_TRACE)).toBeUndefined();
  });

  it("selects no rule for an unrelated oracle failure", () => {
    expect(
      matchResaveFailure(
        "System.IO.IOException: The process cannot access the file.",
      ),
    ).toBeUndefined();
  });

  // The message text alone is not the signature: both halves of matchesOracle must hold, so a trace
  // quoting the message from somewhere other than ToPmpGroup does not select the rule.
  it("requires the throwing frame, not just the message text", () => {
    expect(
      matchResaveFailure(
        "System.IO.InvalidDataException: Editing or exporting PMP Combining groups is not " +
          "supported.\n   at SomeOther.Frame.MoveNext()",
      ),
    ).toBeUndefined();
  });
});

describe("declaredPortedRefusal", () => {
  it("recognizes our writer's own Combining refusal message", () => {
    expect(declaredPortedRefusal(COMBINING_REFUSAL)?.ourRefusal).toBe(
      COMBINING_REFUSAL,
    );
  });

  it("does not recognize a decorated or partial message", () => {
    // Exact-match on purpose (spec §2.1): our ported refusals are byte-identical to the C# strings,
    // so a prefixed/suffixed variant means the port site changed and should be a red, not a pass.
    expect(
      declaredPortedRefusal(`pmp: ${COMBINING_REFUSAL} (src/container/pmp.ts)`),
    ).toBeUndefined();
    expect(declaredPortedRefusal("Editing or exporting PMP")).toBeUndefined();
  });

  it("does not recognize an unrelated writer error", () => {
    expect(
      declaredPortedRefusal("Cannot convert v4+ Penumbra modpack to ttmp/pmp."),
    ).toBeUndefined();
  });
});

describe("RESAVE_MATCHED_FAILURE_RULES", () => {
  // Every rule must carry its provenance — AGENTS.md's citation rule, enforced rather than trusted,
  // because a rule with no cited C# is exactly the "tolerated, not confirmed" shape the registry
  // exists to prevent.
  it("cites a C# symbol and a port site for every entry", () => {
    for (const r of RESAVE_MATCHED_FAILURE_RULES) {
      expect(r.csharp, `rule "${r.ourRefusal}" must cite its C#`).toMatch(
        /\.cs .*·.*\d/,
      );
      expect(r.port, `rule "${r.ourRefusal}" must cite its port site`).toMatch(
        /^src\//,
      );
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.ourRefusal.length).toBeGreaterThan(0);
    }
  });
});

describe("assertMatchedResaveFailure", () => {
  const rule = matchResaveFailure(COMBINING_TRACE)!;

  it("passes when our writer refuses with exactly the declared refusal", () => {
    expect(() =>
      assertMatchedResaveFailure("p.pmp", COMBINING_TRACE, rule, () => {
        throw new Error(COMBINING_REFUSAL);
      }),
    ).not.toThrow();
  });

  it("fails when our load+write SUCCEEDS where the oracle refused — divergence", () => {
    expect(() =>
      assertMatchedResaveFailure("p.pmp", COMBINING_TRACE, rule, () => {
        /* succeeds */
      }),
    ).toThrow(/our load\+write SUCCEEDED/);
  });

  it("fails when our writer throws a DIFFERENT error", () => {
    expect(() =>
      assertMatchedResaveFailure("p.pmp", COMBINING_TRACE, rule, () => {
        throw new Error("some unrelated writer crash");
      }),
    ).toThrow(/not the refusal this rule declares/);
  });

  // Guards the pairing itself: a rule whose ourRefusal never appears in the oracle's own trace is
  // pairing a C# throw with a message TexTools does not emit, even if both sides "refuse".
  it("fails when the declared refusal is absent from the oracle's trace", () => {
    const mispaired = {
      ...rule,
      ourRefusal: "A refusal ConsoleTools never printed.",
    };
    expect(() =>
      assertMatchedResaveFailure("p.pmp", COMBINING_TRACE, mispaired, () => {
        throw new Error("A refusal ConsoleTools never printed.");
      }),
    ).toThrow(/does not appear in the ORACLE's trace/);
  });

  it("tolerates a non-Error throw by stringifying it (still a mismatch)", () => {
    expect(() =>
      assertMatchedResaveFailure("p.pmp", COMBINING_TRACE, rule, () => {
        throw "a bare string, not an Error";
      }),
    ).toThrow(/not the refusal this rule declares/);
  });
});
