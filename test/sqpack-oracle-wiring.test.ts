import { describe, expect, it } from "vitest";
import { extractGameFile, gameAvailable, unwrap, wrap } from "./helpers/oracle";

describe("oracle sqpack wrappers", () => {
  it("expose callable functions and a boolean gameAvailable", () => {
    expect(typeof unwrap).toBe("function");
    expect(typeof wrap).toBe("function");
    expect(typeof extractGameFile).toBe("function");
    expect(typeof gameAvailable()).toBe("boolean");
  });
});
