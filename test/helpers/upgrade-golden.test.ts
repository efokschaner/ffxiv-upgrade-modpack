import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { oracleKey } from "./oracle";
import { upgradeGoldenCached } from "./upgrade-golden";

function processError(message: string, stderr = message): Error {
  return Object.assign(new Error(message), {
    status: -1,
    signal: null,
    stderr,
  });
}

describe("upgradeGoldenCached — error marker", () => {
  it("caches a process throw with output as { kind: 'error' } and does not re-invoke the producer", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([1, 2, 3]);
    let calls = 0;
    const produce = (): Uint8Array | null => {
      calls++;
      throw processError("Highlight/Visibility options are unresolveable");
    };
    const first = upgradeGoldenCached("m.pmp", input, {
      dir,
      available: true,
      produce,
    });
    expect(first?.kind).toBe("error");
    expect(first).toMatchObject({
      message: expect.stringContaining("unresolveable"),
    });
    expect(calls).toBe(1);
    const second = upgradeGoldenCached("m.pmp", input, {
      dir,
      available: true,
      produce,
    });
    expect(second?.kind).toBe("error");
    expect(calls).toBe(1);
  });

  it("propagates a non-process error (no status/signal) instead of caching it", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([42]);
    const produce = (): Uint8Array | null => {
      throw new Error("ENOENT: our own bug");
    };
    expect(() =>
      upgradeGoldenCached("m.pmp", input, { dir, available: true, produce }),
    ).toThrow(/our own bug/);
    const key = oracleKey(input);
    expect(existsSync(join(dir, `${key}.error`))).toBe(false);
  });

  it("does not cache a process error with EMPTY output (lock-race signature) — propagates instead", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([7]);
    const produce = (): Uint8Array | null => {
      throw Object.assign(new Error("Command failed"), {
        status: -1,
        signal: null,
        stdout: "",
        stderr: "",
      });
    };
    expect(() =>
      upgradeGoldenCached("m.pmp", input, { dir, available: true, produce }),
    ).toThrow(/Command failed/);
    const key = oracleKey(input);
    expect(existsSync(join(dir, `${key}.error`))).toBe(false);
  });

  it("still returns pack / noop unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const noop = upgradeGoldenCached("m.pmp", new Uint8Array([9]), {
      dir,
      available: true,
      produce: () => null,
    });
    expect(noop?.kind).toBe("noop");
  });

  it("does not leave a .bin behind on the error path", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([1]);
    upgradeGoldenCached("m.pmp", input, {
      dir,
      available: true,
      produce: () => {
        throw processError("boom");
      },
    });
    const key = oracleKey(input);
    expect(readdirSync(dir).some((f) => f === `${key}.bin`)).toBe(false);
  });
});
