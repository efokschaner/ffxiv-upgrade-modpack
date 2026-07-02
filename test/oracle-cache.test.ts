import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oracleKey, oracleCacheGet, oracleCachePut } from "./helpers/oracle";

describe("oracle cache primitives", () => {
  it("oracleKey is a stable 64-char hex sha256 that differs by content", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    const c = new Uint8Array([1, 2, 4]);
    expect(oracleKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(oracleKey(a)).toBe(oracleKey(b));
    expect(oracleKey(a)).not.toBe(oracleKey(c));
  });

  it("get returns null on miss and the exact bytes after put", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-"));
    const key = "deadbeef";
    expect(oracleCacheGet(key, dir)).toBeNull();
    const data = new Uint8Array([9, 8, 7, 6]);
    oracleCachePut(key, data, dir);
    const got = oracleCacheGet(key, dir);
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual([9, 8, 7, 6]);
  });
});
