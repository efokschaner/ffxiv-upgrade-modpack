import { describe, expect, it } from "vitest";
import { sha1Hex } from "../../src/util/sha1";

const enc = new TextEncoder();

describe("sha1Hex", () => {
  it("hashes the empty input", () => {
    expect(sha1Hex(new Uint8Array(0))).toBe(
      "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    );
  });
  it("hashes 'abc'", () => {
    expect(sha1Hex(enc.encode("abc"))).toBe(
      "a9993e364706816aba3e25717850c26c9cd0d89d",
    );
  });
  it("hashes the 56-byte vector (two-block, length-padding boundary)", () => {
    expect(
      sha1Hex(
        enc.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      ),
    ).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
  });
  it("hashes a million 'a's", () => {
    expect(sha1Hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      "34aa973cd4c4daa4f61eeb2bdbad27316534016f",
    );
  });
});
