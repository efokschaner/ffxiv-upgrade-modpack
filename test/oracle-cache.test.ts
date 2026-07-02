import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oracleKey, oracleCacheGet, oracleCachePut, unwrapCached } from "./helpers/oracle";

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

describe("unwrapCached", () => {
  it("returns null on a cache miss when no oracle is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-"));
    const entry = new Uint8Array([1, 1, 2, 3, 5]);
    expect(unwrapCached(entry, { dir, available: false })).toBeNull();
  });

  it("produces once on miss, stores it, then serves from cache without re-producing", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-"));
    const entry = new Uint8Array([10, 20, 30]);
    const out = new Uint8Array([42, 42]);
    let calls = 0;
    const produce = () => { calls++; return out; };

    const first = unwrapCached(entry, { dir, available: true, produce });
    expect(Array.from(first!)).toEqual([42, 42]);
    expect(calls).toBe(1);

    // Second call: cache hit, producer must NOT run again (even if still "available").
    const second = unwrapCached(entry, { dir, available: true, produce });
    expect(Array.from(second!)).toEqual([42, 42]);
    expect(calls).toBe(1);
  });
});
