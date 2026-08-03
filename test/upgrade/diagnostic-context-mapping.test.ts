// upgrade.ts's `toDiagnostic` (the merge of accumulated GapContextFrames into the fatal
// Diagnostic) is not exported -- it's the boundary conversion, not a port of any C# symbol, so
// there's nothing to cite by exporting it. Per the task brief this is tested THROUGH the public
// `upgradeModpack` entry point instead of exporting an internal solely for the test.
//
// Today's two real annotation sites only ever produce a `material`-only frame (materialRound's
// catch, upgrade.ts) and an always-BOTH `group`+`option` frame (upgradeModpack's per-option loop,
// upgrade.ts) -- ModpackGroup.name/ModpackOption.name are non-optional, so the real pipeline can
// never produce a `gamePath` frame, a `provenance` frame, or a group-without-option frame to
// exercise toDiagnostic's full mapping (gamePath ?? material precedence, the all-or-nothing
// option guard, the provenance fallback). To reach those shapes anyway without exporting
// toDiagnostic, this mocks `resolveHighlightOptionsAndMashupHair` -- the first call inside
// upgradeModpack's try, wrapped by no catch of its own (upgrade.ts's pre-round comment) -- so a
// throw from it reaches the boundary with EXACTLY the frames a test constructs, and nothing else
// in the pipeline runs. Kept in its own file because `vi.mock` is file-scoped (same reasoning as
// unclaimed-hair-port-gap.test.ts).
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/upgrade/resolve-highlight", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/upgrade/resolve-highlight")
  >()),
  resolveHighlightOptionsAndMashupHair: vi.fn(),
}));

import { DiagnosticCode, emptyMeta, upgradeModpack } from "../../src/index";
import { type ModpackData, ModpackFormat } from "../../src/model/modpack";
import { resolveHighlightOptionsAndMashupHair } from "../../src/upgrade/resolve-highlight";
import { UnportedGapError } from "../../src/util/errors";

function emptyModpack(): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: emptyMeta(),
    groups: [],
  };
}

describe("toDiagnostic's context-frame merge (upgrade.ts boundary conversion)", () => {
  it("prefers an annotated gamePath over material, populates option only when BOTH group and option are present, and prefers an annotated provenance over the boundary default", () => {
    vi.mocked(resolveHighlightOptionsAndMashupHair).mockImplementationOnce(
      () => {
        const err = new UnportedGapError(
          "synthetic gap for context-mapping test",
        );
        // Innermost frame (pushed first, deepest in the unwind). Carries BOTH gamePath and
        // material so the assertion below actually proves toDiagnostic's `ctx.gamePath ??
        // ctx.material` precedence, not merely that gamePath survives when material is absent.
        err.context.push({
          gamePath: "inner/path.tex",
          material: "chara/foo/material/mt_foo.mtrl",
        });
        // Outermost frame -- wins on any overlapping key, and is the only one carrying
        // group/option/provenance here.
        err.context.push({
          group: "G",
          option: "O",
          provenance: "Some.cs · SomeMethod · 1-2",
        });
        throw err;
      },
    );

    const r = upgradeModpack(emptyModpack());

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.code).toBe(DiagnosticCode.UnportedGap);
    expect(d.cause).toBeInstanceOf(UnportedGapError);
    expect(d.gamePath).toBe("inner/path.tex");
    expect(d.option).toEqual({ group: "G", option: "O" });
    expect(d.provenance).toBe("Some.cs · SomeMethod · 1-2");
  });

  it("falls back to material when no frame carries gamePath, and to the boundary default provenance when no frame carries provenance", () => {
    vi.mocked(resolveHighlightOptionsAndMashupHair).mockImplementationOnce(
      () => {
        const err = new UnportedGapError("synthetic gap, material-only frame");
        err.context.push({ material: "chara/foo/material/mt_foo.mtrl" });
        throw err;
      },
    );

    const r = upgradeModpack(emptyModpack());

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    const d = r.diagnostics[0]!;
    expect(d.gamePath).toBe("chara/foo/material/mt_foo.mtrl");
    expect(d.provenance).toBe(
      "src/upgrade/upgrade.ts · upgradeModpack · boundary",
    );
  });

  it("half-populated: a frame with group but no option yields option: undefined, not a half-built object", () => {
    vi.mocked(resolveHighlightOptionsAndMashupHair).mockImplementationOnce(
      () => {
        const err = new UnportedGapError("synthetic half-populated gap");
        err.context.push({ group: "G" });
        throw err;
      },
    );

    const r = upgradeModpack(emptyModpack());

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.diagnostics[0]!.option).toBeUndefined();
  });
});
