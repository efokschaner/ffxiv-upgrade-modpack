import { describe, expect, it } from "vitest";
import {
  type Diagnostic,
  DiagnosticCode,
  type ModpackData,
  type UpgradeResult,
} from "../../src/index";
import {
  assertExpectedDiagnostics,
  assertMatchedUpgradeFailure,
  diagnosticsToFileDiffs,
  EXPECTED_PACK_DIAGNOSTICS,
} from "./corpus-upgrade";
import type { FileDiff } from "./upgrade-diff";

const okResult = (): UpgradeResult<ModpackData> => ({
  ok: true,
  data: {} as ModpackData,
  diagnostics: [],
});
const failedWith = (message: string): UpgradeResult<ModpackData> => ({
  ok: false,
  data: null,
  diagnostics: [
    {
      severity: "error",
      code: DiagnosticCode.UpgradeFailed,
      message,
      provenance: "test",
    },
  ],
});

describe("assertMatchedUpgradeFailure", () => {
  it("passes (does not throw) when our error is the SAME reason as the oracle's", () => {
    const oracleMessage =
      "System.IO.InvalidDataException: Cannot upgrade modpack - Highlight/Visibility options are " +
      "unresolveable either due to missing files or too much complexity.\nTry installing the modpack " +
      "and creating an updated pack from the desired options.";
    expect(() =>
      assertMatchedUpgradeFailure("m.pmp", oracleMessage, () => {
        throw new Error(
          "Highlight/Visibility options are unresolveable either due to missing files or too much complexity.",
        );
      }),
    ).not.toThrow();
  });

  it("passes when our upgrade returns ok:false whose fatal diagnostic matches the oracle", () => {
    const oracleMessage =
      "System.IO.InvalidDataException: Cannot upgrade modpack - Highlight/Visibility options are " +
      "unresolveable either due to missing files or too much complexity.";
    expect(() =>
      assertMatchedUpgradeFailure("m.pmp", oracleMessage, () =>
        failedWith(
          "Highlight/Visibility options are unresolveable either due to missing files or too much complexity.",
        ),
      ),
    ).not.toThrow();
  });

  it("fails when our upgrade SUCCEEDS where the oracle errored — divergence", () => {
    // expect.fail throws an assertion error, so the mismatch branch surfaces as a throw here.
    expect(() =>
      assertMatchedUpgradeFailure("m.pmp", "oracle: unresolveable", () =>
        okResult(),
      ),
    ).toThrow(/errored but our upgrade SUCCEEDED/);
  });

  it("fails when our upgrade throws an UNRELATED error not present in the oracle message", () => {
    expect(() =>
      assertMatchedUpgradeFailure("m.pmp", "oracle: unresolveable", () => {
        throw new Error("totally different failure reason");
      }),
    ).toThrow(/does not match the oracle/);
  });
});

describe("diagnosticsToFileDiffs", () => {
  // Two diagnostics sharing BOTH `gamePath` and `code` — the reachable collision from
  // src/upgrade/unclaimed-hair.ts:234-242 (HairTransformFailed carries a destination gamePath and a
  // fixed code, but no `option`, and that destination is unique within an option but NOT across
  // options — unclaimed-hair.ts:180-187). Without a further tiebreak, `idOf` (upgrade-baseline.ts)
  // keys on `index`, and which diagnostic gets index 0 vs 1 would depend on array push order alone.
  const base: Omit<Diagnostic, "message"> = {
    severity: "error",
    code: DiagnosticCode.HairTransformFailed,
    gamePath:
      "chara/human/c0101/obj/hair/h0001/texture/mt_c0101h0001_hir_n.tex",
    provenance: "EndwalkerUpgrade.cs · UpdateUnclaimedHairTextures · 1498-1501",
  };

  it("assigns a stable, deterministic index to two diagnostics colliding on gamePath AND code", () => {
    const a: Diagnostic = {
      ...base,
      message: "size mismatch: 64x64 vs 128x128",
    };
    const b: Diagnostic = { ...base, message: "size mismatch: 32x32 vs 64x64" };

    const forward = diagnosticsToFileDiffs([a, b]);
    const reversed = diagnosticsToFileDiffs([b, a]);

    // The assignment must be a function of diagnostic CONTENT (here, `message`, the tiebreak this
    // round adds), not of push/insertion order — so feeding the same two diagnostics in either
    // order must produce the exact same result.
    expect(forward).toEqual(reversed);
    // "3" < "6" ordinally, so b's message sorts first regardless of which argument position it
    // appeared in.
    expect(forward[0]?.detail).toBe(b.message);
    expect(forward[1]?.detail).toBe(a.message);
  });

  it("is order-independent at the RATCHET IDENTITY level even when gamePath, code AND message all collide", () => {
    // The residual case the tiebreak cannot resolve (no field left to discriminate on today's
    // Diagnostic shape). Provably harmless: idOf never reads `detail`, so for a fully-tied pair
    // every assignment of {index, index+1} produces the same PAIR of identity strings.
    const dup: Diagnostic = { ...base, message: "identical failure" };
    const forward = diagnosticsToFileDiffs([dup, { ...dup }]);
    const reversed = diagnosticsToFileDiffs([{ ...dup }, dup]);
    const idsOf = (fds: ReturnType<typeof diagnosticsToFileDiffs>) =>
      fds
        .map((f) => `${f.kind}|${f.gamePath}#${f.index}:${f.status}@${f.code}`)
        .sort();
    expect(idsOf(forward)).toEqual(idsOf(reversed));
  });

  it("supplies the FileDiff sentinel gamePath for a diagnostic with none", () => {
    const noPath: Diagnostic = {
      severity: "error",
      code: DiagnosticCode.UnportedGap,
      message: "no path known",
      provenance: "test",
    };
    const [fd] = diagnosticsToFileDiffs([noPath]);
    expect(fd?.gamePath).toBe("(no path)");
  });
});

// The exact-match pin the subset ratchet cannot provide (see EXPECTED_PACK_DIAGNOSTICS' doc
// comment). These tests use the REAL table entry rather than a fixture one, so they also assert the
// committed expectation is well-formed.
describe("assertExpectedDiagnostics", () => {
  const PACK = "hair-transform-failure.pmp";
  const expected = EXPECTED_PACK_DIAGNOSTICS.get(PACK);

  /** A `diff.files` array as registerUpgradeCheck assembles it: some unrelated byte diffs plus the
   *  diagnostics the upgrade produced. */
  const filesWith = (diagnostics: FileDiff[]): FileDiff[] => [
    {
      kind: "payload",
      gamePath: "chara/other/x.tex",
      index: 0,
      status: "mismatch",
    },
    ...diagnostics,
  ];
  const asDiff = (e: { code: DiagnosticCode; gamePath: string }): FileDiff => ({
    kind: "diagnostic",
    gamePath: e.gamePath,
    index: 0,
    status: "added",
    code: e.code,
    detail: "some parse failure wording that is free to change",
  });

  it("is a no-op for a pack with no expectation recorded", () => {
    expect(() =>
      assertExpectedDiagnostics("some-real-mod.pmp", filesWith([])),
    ).not.toThrow();
  });

  it("passes when the pack's diagnostic diffs are exactly the expected set", () => {
    expect(expected).toBeDefined();
    expect(() =>
      assertExpectedDiagnostics(PACK, filesWith(expected!.map(asDiff))),
    ).not.toThrow();
  });

  it("FAILS when the diagnostics never reached diff.files — the regression the ratchet cannot see", () => {
    // Exactly what deleting `...diagnostics` from registerUpgradeCheck's spread looks like: the byte
    // diffs are still there, the diagnostic entries are gone. compareToBaseline would call this an
    // improvement (empty ⊆ baseline); this must call it a failure.
    expect(() => assertExpectedDiagnostics(PACK, filesWith([]))).toThrow(
      /must match EXACTLY/,
    );
  });

  it("FAILS when an unexpected extra diagnostic appears", () => {
    expect(() =>
      assertExpectedDiagnostics(
        PACK,
        filesWith([
          ...expected!.map(asDiff),
          asDiff({
            code: DiagnosticCode.HairTransformFailed,
            gamePath: "chara/human/c0101/obj/hair/h0002/texture/x_norm.tex",
          }),
        ]),
      ),
    ).toThrow(/must match EXACTLY/);
  });

  it("FAILS when the diagnostic's code changes", () => {
    expect(() =>
      assertExpectedDiagnostics(
        PACK,
        filesWith(
          expected!.map((e) =>
            asDiff({ ...e, code: DiagnosticCode.UpgradeFailed }),
          ),
        ),
      ),
    ).toThrow(/must match EXACTLY/);
  });

  it("ignores `detail`, which is free-form wording idOf never reads", () => {
    const withOtherDetail = expected!
      .map(asDiff)
      .map((f) => ({ ...f, detail: "completely different wording" }));
    expect(() =>
      assertExpectedDiagnostics(PACK, filesWith(withOtherDetail)),
    ).not.toThrow();
  });

  // The RETURN value is what registerUpgradeCheck subtracts from the set it ratchets, so a pack
  // whose only diff is its committed diagnostic needs no baseline file (spec §7.2). These pin the
  // two halves of that contract.
  describe("returns the CONFIRMED entries, for the caller to consume", () => {
    it("returns exactly the diagnostic FileDiffs (by identity), not the byte diffs", () => {
      const diagnostics = expected!.map(asDiff);
      const files = filesWith(diagnostics);
      const confirmed = assertExpectedDiagnostics(PACK, files);
      // Identity, not deep equality: the caller subtracts by reference (`Set.has`), so returning
      // copies would silently subtract nothing and quietly re-introduce the baseline entry.
      expect(confirmed).toHaveLength(diagnostics.length);
      for (const d of diagnostics) expect(confirmed).toContain(d);
      // Reproduce the call site's subtraction and assert what the ratchet would actually see.
      const set = new Set(confirmed);
      const ratcheted = files.filter((f) => !set.has(f));
      expect(ratcheted.every((f) => f.kind !== "diagnostic")).toBe(true);
      expect(ratcheted).toHaveLength(files.length - diagnostics.length);
    });

    it("returns NOTHING for an unlisted pack, so its diagnostics still reach the ratchet", () => {
      const stray = asDiff({
        code: DiagnosticCode.HairTransformFailed,
        gamePath: "chara/human/c9999/obj/hair/h0001/texture/x_norm.tex",
      });
      const files = filesWith([stray]);
      const confirmed = assertExpectedDiagnostics("some-real-mod.pmp", files);
      expect(confirmed).toEqual([]);
      // Nothing subtracted => the unconfirmed diagnostic is still scored as a regression.
      const set = new Set(confirmed);
      expect(files.filter((f) => !set.has(f))).toContain(stray);
    });
  });
});
