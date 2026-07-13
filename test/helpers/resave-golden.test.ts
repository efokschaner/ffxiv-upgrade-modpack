import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oracleKey } from "./oracle";
import { resaveGoldenCached } from "./resave-golden";

// Focused test for the "oracle itself errors" marker (BACKLOG.md, "Expected-failure golden
// capability for the upgrade harness"): ConsoleTools /resave can throw on an input it CAN load
// but cannot write back out (e.g. the Milktruck Bust Scaling Tweaks CMP crash). Uses the
// opts.produce injection seam — never spawns real ConsoleTools in a unit test.
describe("resaveGoldenCached — error marker", () => {
  it("caches a producer throw as a { kind: 'error' } result and never re-invokes the producer", () => {
    const dir = mkdtempSync(join(tmpdir(), "rg-"));
    const input = new Uint8Array([1, 2, 3]);
    let calls = 0;
    const produce = () => {
      calls++;
      throw new Error("CMP Format Changed - Unable to read all CMP data.");
    };

    const first = resaveGoldenCached("m.ttmp2", input, {
      dir,
      available: true,
      produce,
    });
    expect(first?.kind).toBe("error");
    expect(first).toMatchObject({
      message: expect.stringContaining("CMP Format Changed"),
    });
    expect(calls).toBe(1);

    // Second call: marker hit, producer must NOT run again.
    const second = resaveGoldenCached("m.ttmp2", input, {
      dir,
      available: true,
      produce,
    });
    expect(second?.kind).toBe("error");
    expect(second).toMatchObject({
      message: expect.stringContaining("CMP Format Changed"),
    });
    expect(calls).toBe(1);
  });

  it("still fails loud (returns null) on an uncached miss with no oracle available", () => {
    const dir = mkdtempSync(join(tmpdir(), "rg-"));
    expect(
      resaveGoldenCached("m.ttmp2", new Uint8Array([9]), {
        dir,
        available: false,
      }),
    ).toBeNull();
  });

  it("a successful produce is cached and served without re-invoking the producer", () => {
    const dir = mkdtempSync(join(tmpdir(), "rg-"));
    const input = new Uint8Array([4, 5, 6]);
    const golden = new Uint8Array([7, 8, 9]);
    let calls = 0;
    const produce = () => {
      calls++;
      return golden;
    };

    const first = resaveGoldenCached("m.pmp", input, {
      dir,
      available: true,
      produce,
    });
    expect(first).toEqual({ kind: "pack", bytes: golden });
    expect(calls).toBe(1);

    const second = resaveGoldenCached("m.pmp", input, {
      dir,
      available: true,
      produce,
    });
    expect(second).toEqual({ kind: "pack", bytes: golden });
    expect(calls).toBe(1);
  });

  it("does not leave a cached .bin AND a stray temp behind when the producer throws", () => {
    // Regression guard for the write order: the error path must not call oracleCachePut.
    const dir = mkdtempSync(join(tmpdir(), "rg-"));
    const input = new Uint8Array([1]);
    const produce = (): Uint8Array => {
      throw new Error("boom");
    };
    resaveGoldenCached("m.ttmp2", input, { dir, available: true, produce });
    // Reading the error marker back directly confirms it was persisted (not just in-memory).
    const marker = join(dir, `${oracleKey(input)}.error`);
    expect(readFileSync(marker, "utf8")).toContain("boom");
  });
});
