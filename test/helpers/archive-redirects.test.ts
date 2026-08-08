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
      [redirectKey("group_001_g.json", "0", "chara/a.tex"), bytes(1, 2, 3)],
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
        redirectKey("group_001_g.json", "0", "chara/a.tex"),
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
        redirectKey("group_001_g.json", "0", "chara/a.tex"),
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

      const keyA = redirectKey("group_001_g.json", "0", "chara/a.tex");
      const keyB = redirectKey("group_001_g.json", "1", "chara/a.tex");

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

const encJson = (v: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(v));

/** A v4 archive: meta.json carrying Groups + DefaultData inline, plus payload members.
 *  Mirrors what PMP.WritePmp (PMP.cs:908-962) emits — no default_mod.json, no group_NNN.json. */
function v4Members(): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  m.set(
    "meta.json",
    encJson({
      FileVersion: 4,
      Name: "t",
      Identifier: "5ffd6e85-ae4c-4446-8ed3-ca556ad6bcf3",
      LastWrite: "2026-08-06T04:41:11.0160172-07:00",
      ModTags: [],
      Groups: [
        {
          Name: "G0",
          Type: "Single",
          Options: [
            { Name: "A", Files: { "chara/a.tex": "g0a\\chara\\a.tex" } },
            { Name: "B", Files: { "chara/a.tex": "g0b\\chara\\a.tex" } },
          ],
        },
        {
          Name: "G1",
          Type: "Single",
          Options: [
            {
              Name: "A",
              Files: { "chara/a.tex": "g1a\\chara\\a.tex" },
              FileSwaps: { "chara/x.tex": "chara/y.tex" },
            },
          ],
        },
      ],
      DefaultData: {
        Version: 0,
        Files: { "chara/d.tex": "def\\chara\\d.tex" },
      },
    }),
  );
  m.set("g0a/chara/a.tex", new Uint8Array([1]));
  m.set("g0b/chara/a.tex", new Uint8Array([2]));
  m.set("g1a/chara/a.tex", new Uint8Array([3]));
  m.set("def/chara/d.tex", new Uint8Array([4]));
  return m;
}

describe("archive-redirects v4 (PMP.cs · PMPMetaJson · 1484/1487)", () => {
  it("resolves every inline group option and DefaultData", () => {
    const r = resolveRedirects(v4Members());
    expect(r.get(redirectKey("meta.json", "0/0", "chara/a.tex"))).toEqual(
      new Uint8Array([1]),
    );
    expect(r.get(redirectKey("meta.json", "0/1", "chara/a.tex"))).toEqual(
      new Uint8Array([2]),
    );
    expect(r.get(redirectKey("meta.json", "1/0", "chara/a.tex"))).toEqual(
      new Uint8Array([3]),
    );
    expect(r.get(redirectKey("meta.json", "default", "chara/d.tex"))).toEqual(
      new Uint8Array([4]),
    );
  });

  it("does not collide two groups' options onto one key — under v4 every option lives in meta.json, so a bare option index would merge G0[0] and G1[0]", () => {
    expect(resolveRedirects(v4Members()).size).toBe(4);
  });

  it("sees a FileSwap on an inline group option", () => {
    expect(packHasFileSwaps(v4Members())).toBe(true);
  });

  it("FAILS LOUD on a meta.json with no recognizable option container, instead of comparing empty maps", () => {
    const m = new Map<string, Uint8Array>();
    m.set("meta.json", encJson({ FileVersion: 4, Name: "t" }));
    m.set("payload/a.tex", new Uint8Array([1]));
    expect(() => resolveRedirects(m)).toThrow(
      /no recognizable option container/,
    );
  });
});

// The guard above discriminates "I did not recognize this archive's shape" (fail-open risk) from
// "this archive genuinely has no options" (legal, and an empty redirect map is the right answer).
// The discriminator is payload members no option container explains. See archive-redirects.ts.
describe("archive-redirects: optionless vs unrecognized (PMP.cs · LoadPMP · 181-189)", () => {
  /** A legal, genuinely optionless Penumbra pack: meta.json and nothing else. `File.Exists` guards
   *  the default_mod.json read (PMP.cs · LoadPMP · 182) and the group scan (:191-208) finds nothing,
   *  so TexTools loads this with zero options — and so do we. Built for real as a corpus pack by
   *  scripts/generate-synthetics/build-synthetic-pmp-absent-manifests.ts. */
  const metaOnly = (fileVersion: number): Map<string, Uint8Array> =>
    new Map([
      ["meta.json", encJson({ FileVersion: fileVersion, Name: "t" })],
    ]) as Map<string, Uint8Array>;

  it.each([
    3, 4,
  ])("does NOT throw on a v%i meta.json-only pack — no payload, so nothing can pass vacuously", (fileVersion) => {
    const m = metaOnly(fileVersion);
    expect(() => resolveRedirects(m)).not.toThrow();
    expect(resolveRedirects(m).size).toBe(0);
    // packHasFileSwaps runs on EVERY PMP /resave input (corpus-resave.ts); this is the call that
    // used to throw and turn the suite red on a legal empty pack.
    expect(() => packHasFileSwaps(m)).not.toThrow();
    expect(packHasFileSwaps(m)).toBe(false);
  });

  it(
    "STILL throws on the original fail-open: an unrecognized-shape meta.json over payload — " +
      "REGRESSION guard, the v4 archive that motivated the throw differs from an empty pack " +
      "ONLY by carrying payload members",
    () => {
      // Same meta.json as the passing case above, plus one payload member. If narrowing the guard
      // had made this pass, the bug it exists for would be back and no corpus pack would catch it.
      const m = metaOnly(4);
      m.set("v4 payload/chara/a.tex", new Uint8Array([1]));
      expect(() => resolveRedirects(m)).toThrow(
        /no recognizable option container/,
      );
      expect(() => resolveRedirects(m)).toThrow(
        /payload member\(s\) nothing accounts for/,
      );
      expect(() => packHasFileSwaps(m)).toThrow();
    },
  );

  it("a v3 pack with a group but NO default_mod.json is recognized (File.Exists, PMP.cs · LoadPMP · 182)", () => {
    const m = new Map<string, Uint8Array>();
    m.set("meta.json", encJson({ FileVersion: 3, Name: "t" }));
    m.set(
      "group_001_g.json",
      encJson({
        Name: "G",
        Type: "Single",
        Options: [{ Name: "On", Files: { "chara/a.tex": "g\\on\\a.tex" } }],
      }),
    );
    m.set("g/on/a.tex", new Uint8Array([7]));
    expect(
      resolveRedirects(m).get(
        redirectKey("group_001_g.json", "0", "chara/a.tex"),
      ),
    ).toEqual(new Uint8Array([7]));
  });
});
