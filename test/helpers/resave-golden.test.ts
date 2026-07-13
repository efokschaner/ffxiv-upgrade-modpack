import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oracleKey } from "./oracle";
import { resaveGoldenCached } from "./resave-golden";

/** Builds an Error shaped like what `execFileSync` throws when the CHILD PROCESS actually ran
 * and exited non-zero (or was killed by a signal) — see oracle.ts's `run()`: ConsoleTools
 * returns -1 on error. `status`/`signal` are the discriminating fields resave-golden.ts's
 * classifier keys on; a plain `new Error(...)` has neither and must NOT be mistaken for this.
 * `stderr` defaults to `message` so this reproduces a REAL ConsoleTools failure, which always
 * prints something (execFileSync's own `.message` is a generic "Command failed: ..." that carries
 * no diagnostic content on its own — see resave-golden.ts's `processOutputText`). Pass an empty
 * string explicitly to build the lock-race shape (a bare non-zero exit with nothing captured). */
function processError(
  message: string,
  status: number | null = -1,
  signal: string | null = null,
  stderr = message,
): Error {
  return Object.assign(new Error(message), { status, signal, stderr });
}

// Focused test for the "oracle itself errors" marker
// (docs/backlog/2026-07-11-expected-failure-golden.md): ConsoleTools /resave can throw on an input it CAN load
// but cannot write back out (e.g. the Milktruck Bust Scaling Tweaks CMP crash). Uses the
// opts.produce injection seam — never spawns real ConsoleTools in a unit test.
describe("resaveGoldenCached — error marker", () => {
  it("caches a producer throw as a { kind: 'error' } result and never re-invokes the producer", () => {
    const dir = mkdtempSync(join(tmpdir(), "rg-"));
    const input = new Uint8Array([1, 2, 3]);
    let calls = 0;
    const produce = () => {
      calls++;
      throw processError("CMP Format Changed - Unable to read all CMP data.");
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

  // Finding 1 regression guard: resaveGoldenCached wrapped ALL of produce() (our own file I/O,
  // the spawn, AND the readFileSync of the result) in one try/catch, so ANY throw — including a
  // bug in OUR harness code with nothing to do with ConsoleTools — got permanently cached as
  // "the oracle errors on this pack" and silently never retried. Only a throw shaped like a
  // genuine child-process failure (execFileSync sets `status`/`signal`) may be classified that
  // way; anything else must propagate and fail the test loudly instead of masquerading as a
  // TexTools limitation forever.
  it("propagates a non-process error (no status/signal) instead of caching it as an oracle error", () => {
    const dir = mkdtempSync(join(tmpdir(), "rg-"));
    const input = new Uint8Array([42]);
    let calls = 0;
    const produce = (): Uint8Array => {
      calls++;
      throw new Error("ENOENT: no such file or directory, our own bug");
    };

    expect(() =>
      resaveGoldenCached("m.ttmp2", input, { dir, available: true, produce }),
    ).toThrow(/our own bug/);
    expect(calls).toBe(1);

    // Not cached: neither an .error marker nor a .bin, and a retry re-invokes the producer.
    const key = oracleKey(input);
    expect(existsSync(join(dir, `${key}.error`))).toBe(false);
    expect(existsSync(join(dir, `${key}.bin`))).toBe(false);

    expect(() =>
      resaveGoldenCached("m.ttmp2", input, { dir, available: true, produce }),
    ).toThrow(/our own bug/);
    expect(calls).toBe(2);
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
    // Regression guard for the write order: the error path must not call oracleCachePut. Asserts
    // the ABSENCE of a .bin/.tmp directly (not just that the .error marker exists) — a prior
    // version of this test only checked the marker, so it would not have failed if a future
    // change started calling oracleCachePut on the error path too.
    const dir = mkdtempSync(join(tmpdir(), "rg-"));
    const input = new Uint8Array([1]);
    const produce = (): Uint8Array => {
      throw processError("boom");
    };
    resaveGoldenCached("m.ttmp2", input, { dir, available: true, produce });
    // Reading the error marker back directly confirms it was persisted (not just in-memory).
    const key = oracleKey(input);
    const marker = join(dir, `${key}.error`);
    expect(readFileSync(marker, "utf8")).toContain("boom");

    const entries = readdirSync(dir);
    expect(entries.some((f) => f === `${key}.bin`)).toBe(false);
    expect(entries.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  // Finding 4 regression guard: a process-shaped error (status/signal set, like a genuine
  // ConsoleTools failure) but with NO stdout/stderr captured is oracle.ts's documented residual
  // lock-race signature ("two ConsoleTools processes running concurrently -> a loud non-zero exit
  // -> a spurious red a re-run clears"), not a real TexTools verdict on this pack. Caching it would
  // permanently and silently remove the pack from the write-side oracle on the very next run.
  it("does not cache a process-shaped error with EMPTY stdout/stderr (lock-race signature) — propagates and retries instead", () => {
    const dir = mkdtempSync(join(tmpdir(), "rg-"));
    const input = new Uint8Array([7]);
    let calls = 0;
    const produce = (): Uint8Array => {
      calls++;
      // status/signal set (process-shaped) but stdout/stderr both empty — no message field either,
      // matching execFileSync's own generic "Command failed: ..." carrying nothing diagnostic.
      throw Object.assign(new Error("Command failed"), {
        status: -1,
        signal: null,
        stdout: "",
        stderr: "",
      });
    };

    expect(() =>
      resaveGoldenCached("m.ttmp2", input, { dir, available: true, produce }),
    ).toThrow(/Command failed/);
    expect(calls).toBe(1);

    const key = oracleKey(input);
    expect(existsSync(join(dir, `${key}.error`))).toBe(false);
    expect(existsSync(join(dir, `${key}.bin`))).toBe(false);

    // A retry re-invokes the producer rather than replaying a cached false verdict.
    expect(() =>
      resaveGoldenCached("m.ttmp2", input, { dir, available: true, produce }),
    ).toThrow(/Command failed/);
    expect(calls).toBe(2);
  });

  it("still caches a process-shaped error that DOES carry stdout/stderr (a genuine ConsoleTools failure, not a lock race)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rg-"));
    const input = new Uint8Array([8]);
    const produce = (): Uint8Array => {
      throw processError("CMP Format Changed - Unable to read all CMP data.");
    };

    const first = resaveGoldenCached("m.ttmp2", input, {
      dir,
      available: true,
      produce,
    });
    expect(first?.kind).toBe("error");

    const key = oracleKey(input);
    expect(existsSync(join(dir, `${key}.error`))).toBe(true);
  });
});
