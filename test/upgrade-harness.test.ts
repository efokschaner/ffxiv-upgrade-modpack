import { describe, expect, it } from "vitest";
import {
  confirmDivergence,
  DIVERGENCE_RULES,
  type DivergenceRule,
} from "./helpers/upgrade-compare";

describe("confirmDivergence", () => {
  it("returns false with the empty live registry", () => {
    expect(DIVERGENCE_RULES).toEqual([]);
    expect(
      confirmDivergence("a/b_id.tex", new Uint8Array([1]), new Uint8Array([2])),
    ).toBe(false);
  });

  it("confirms only when a matching rule's confirm holds", () => {
    const rules: DivergenceRule[] = [
      {
        reason: "test: same length is the intended difference",
        predicate: (p) => p.endsWith("_id.tex"),
        confirm: (o, g) => o.length === g.length,
      },
    ];
    // predicate matches AND confirm holds -> accepted divergence
    expect(
      confirmDivergence(
        "x/y_id.tex",
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4]),
        rules,
      ),
    ).toBe(true);
    // predicate matches but confirm fails (unexpected divergence) -> not accepted
    expect(
      confirmDivergence(
        "x/y_id.tex",
        new Uint8Array([1, 2]),
        new Uint8Array([3]),
        rules,
      ),
    ).toBe(false);
    // predicate does not match -> not accepted
    expect(
      confirmDivergence(
        "x/y_n.tex",
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4]),
        rules,
      ),
    ).toBe(false);
  });
});
