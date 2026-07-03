import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index";

describe("scaffolding", () => {
  it("exports a version string", () => {
    expect(VERSION).toBe("0.0.0");
  });
});
