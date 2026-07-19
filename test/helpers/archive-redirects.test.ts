import { describe, expect, it } from "vitest";
import {
  packHasFileSwaps,
  payloadMemberNames,
  redirectKey,
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
    expect([...resolveRedirects(m)]).toEqual([
      [redirectKey("group_001_g.json", 0, "chara/a.tex"), bytes(1, 2, 3)],
    ]);
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
    expect(
      resolveRedirects(m).get(
        redirectKey("group_001_g.json", 0, "chara/a.tex"),
      ),
    ).toEqual(bytes(4));
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
    expect(
      resolveRedirects(m).has(
        redirectKey("group_001_g.json", 0, "chara/a.tex"),
      ),
    ).toBe(false);
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

  it(
    "keys each option separately, so two options that redirect the SAME gamePath to " +
      "DIFFERENT content (the ordinary shape of a Single-select group) do not collide — " +
      "REGRESSION for the archive-wide last-write-wins merge this replaces",
    () => {
      // Two mutually exclusive options in one Single-select group both redirect chara/a.tex,
      // to different payload members. An archive-wide `Map<gamePath, bytes>` with unconditional
      // `out.set(...)` would let the second option's entry silently overwrite the first's,
      // masking a real content divergence in whichever option a caller compares against a
      // golden that differs only in the OTHER option. Per-option keying (this test) keeps both.
      const groupA = {
        Options: [
          { Name: "A", Files: { "chara/a.tex": "opt\\a.tex" }, FileSwaps: {} },
          { Name: "B", Files: { "chara/a.tex": "opt\\b.tex" }, FileSwaps: {} },
        ],
      };
      const membersLeft = pack(groupA, {
        "opt/a.tex": bytes(1),
        "opt/b.tex": bytes(2),
      });
      // The "golden" differs from "ours" only in option B's content — option A is identical.
      const membersRight = pack(groupA, {
        "opt/a.tex": bytes(1),
        "opt/b.tex": bytes(9),
      });

      const left = resolveRedirects(membersLeft);
      const right = resolveRedirects(membersRight);

      const keyA = redirectKey("group_001_g.json", 0, "chara/a.tex");
      const keyB = redirectKey("group_001_g.json", 1, "chara/a.tex");

      // Option A (index 0) is untouched by the divergence and must still compare equal.
      expect(left.get(keyA)).toEqual(right.get(keyA));
      // Option B (index 1) carries the real divergence and must NOT be masked by option A's
      // entry for the same gamePath — this is exactly what an archive-wide merge would hide.
      expect(left.get(keyB)).toEqual(bytes(2));
      expect(right.get(keyB)).toEqual(bytes(9));
      expect(left.get(keyB)).not.toEqual(right.get(keyB));
    },
  );
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
