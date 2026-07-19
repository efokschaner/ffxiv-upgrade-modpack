import { describe, expect, it } from "vitest";
import {
  packHasFileSwaps,
  payloadMemberNames,
  resolveRedirects,
} from "./archive-redirects";

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const bytes = (...v: number[]) => new Uint8Array(v);

/** A minimal PMP member map: default_mod.json + one group + payload members. */
function pack(
  group: unknown,
  payload: Record<string, Uint8Array>,
): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  m.set("meta.json", enc({ FileVersion: 3, Name: "t" }));
  m.set("default_mod.json", enc({ Name: "", Files: {}, FileSwaps: {} }));
  m.set("group_001_g.json", enc(group));
  for (const [k, v] of Object.entries(payload)) m.set(k, v);
  return m;
}

describe("packHasFileSwaps", () => {
  it("is false when every option's FileSwaps is empty", () => {
    const m = pack({ Options: [{ Name: "On", Files: {}, FileSwaps: {} }] }, {});
    expect(packHasFileSwaps(m)).toBe(false);
  });

  it("is true when any option carries a swap", () => {
    const m = pack(
      {
        Options: [
          { Name: "A", Files: {}, FileSwaps: {} },
          { Name: "B", Files: {}, FileSwaps: { "chara/d.tex": "chara/s.tex" } },
        ],
      },
      {},
    );
    expect(packHasFileSwaps(m)).toBe(true);
  });

  it("sees a swap on default_mod.json (the document IS the option)", () => {
    const m = new Map<string, Uint8Array>();
    m.set(
      "default_mod.json",
      enc({ Name: "", Files: {}, FileSwaps: { "chara/d.tex": "chara/s.tex" } }),
    );
    expect(packHasFileSwaps(m)).toBe(true);
  });
});

describe("resolveRedirects", () => {
  it("maps each gamePath to its member bytes, independent of member NAME", () => {
    const m = pack(
      {
        Options: [
          {
            Name: "On",
            Files: { "chara/a.tex": "common\\1\\a.tex" },
            FileSwaps: {},
          },
        ],
      },
      { "common/1/a.tex": bytes(1, 2, 3) },
    );
    expect([...resolveRedirects(m)]).toEqual([["chara/a.tex", bytes(1, 2, 3)]]);
  });

  it("resolves a member name that differs only by case or a trailing dot (looseKey)", () => {
    const m = pack(
      {
        Options: [
          {
            Name: "On",
            Files: { "chara/a.tex": "G\\On\\A.TEX" },
            FileSwaps: {},
          },
        ],
      },
      { "g/on/a.tex": bytes(4) },
    );
    expect(resolveRedirects(m).get("chara/a.tex")).toEqual(bytes(4));
  });

  it("omits a gamePath whose member is absent, rather than inventing bytes", () => {
    const m = pack(
      {
        Options: [
          {
            Name: "On",
            Files: { "chara/a.tex": "g\\on\\gone.tex" },
            FileSwaps: {},
          },
        ],
      },
      {},
    );
    expect(resolveRedirects(m).has("chara/a.tex")).toBe(false);
  });

  it("does NOT resolve FileSwaps — a swap value is a game path, not a member", () => {
    const m = pack(
      {
        Options: [
          {
            Name: "On",
            Files: {},
            FileSwaps: { "chara/d.tex": "chara\\src.tex" },
          },
        ],
      },
      {},
    );
    expect(resolveRedirects(m).size).toBe(0);
  });
});

describe("payloadMemberNames", () => {
  it("excludes manifests and returns the rest", () => {
    const m = pack(
      { Options: [{ Name: "On", Files: {}, FileSwaps: {} }] },
      { "g/on/a.tex": bytes(1), "common/1/b.tex": bytes(2) },
    );
    expect(payloadMemberNames(m).sort()).toEqual([
      "common/1/b.tex",
      "g/on/a.tex",
    ]);
  });
});
