import { describe, expect, it } from "vitest";
import { makeV4ExtraFileDuplicateConfirmation } from "./pmp-v4-extrafile-divergence";

const enc = (v: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(v));

const PAYLOAD = new Uint8Array([1, 2, 3]);
const OTHER = new Uint8Array([9, 9, 9]);

/** A v4 INPUT pack: meta.json with an inline group whose one file lives at a zip path unlike the
 *  regenerated one ("files/a.bin", not "g/chara/a.bin") — the shape that lets bug #23's duplication
 *  be observed at all (see build-synthetic-pmp-v4.ts's own header on why identically-named input
 *  and regenerated paths would hide the bug). */
function v4Input(): Map<string, Uint8Array> {
  return new Map<string, Uint8Array>([
    [
      "meta.json",
      enc({
        FileVersion: 4,
        Name: "in",
        ModTags: [],
        Groups: [
          {
            Name: "G",
            Type: "Single",
            Options: [{ Name: "On", Files: { "chara/a.bin": "files\\a.bin" } }],
          },
        ],
        DefaultData: { Version: 0 },
      }),
    ],
    ["files/a.bin", PAYLOAD],
  ]);
}

/** The GOLDEN shape bug #23 actually produces (matching build-synthetic-pmp-v4.ts's OBSERVED
 *  OUTPUT): the input's own zip path re-emitted verbatim ("files/a.bin", golden-only — what this
 *  rule exists to confirm) AND the regenerated dedup path ("g/chara/a.bin", the ONE the manifest's
 *  `Files` value actually points at). `overrides` lets a test perturb exactly one piece while
 *  leaving the rest of the true-positive shape intact, so each rejection test isolates the ONE
 *  criterion it names. */
function goldenTrueShape(
  overrides: Partial<{
    metaFiles: Record<string, string>;
    members: Record<string, Uint8Array>;
  }> = {},
): Map<string, Uint8Array> {
  const metaFiles = overrides.metaFiles ?? { "chara/a.bin": "g\\chara\\a.bin" };
  const members = overrides.members ?? {
    "files/a.bin": PAYLOAD,
    "g/chara/a.bin": PAYLOAD,
  };
  const m = new Map<string, Uint8Array>([
    [
      "meta.json",
      enc({
        FileVersion: 4,
        Name: "in",
        Groups: [
          {
            Name: "G",
            Type: "Single",
            Options: [{ Name: "On", Files: metaFiles }],
          },
        ],
        DefaultData: { Version: 0 },
      }),
    ],
  ]);
  for (const [k, v] of Object.entries(members)) m.set(k, v);
  return m;
}

/** OUR archive for the true-positive case: we kept the twin ("g/chara/a.bin") and never wrote the
 *  duplicate ("files/a.bin") at all. */
const oursTrueShape = new Map<string, Uint8Array>([
  ["meta.json", enc({ FileVersion: 4 })],
  ["g/chara/a.bin", PAYLOAD],
]);

describe("makeV4ExtraFileDuplicateConfirmation gate", () => {
  it("is undefined for a v3 input — the divergence cannot arise, so the arm must not exist", () => {
    const v3 = new Map<string, Uint8Array>([
      ["meta.json", enc({ FileVersion: 3, Name: "in" })],
      ["default_mod.json", enc({ Version: 0 })],
      ["files/a.bin", PAYLOAD],
    ]);
    expect(makeV4ExtraFileDuplicateConfirmation(v3)).toBeUndefined();
  });

  // Mutation-sensitive companion to the test above: that fixture's meta.json has no `Groups` at
  // all, so it is ALSO caught by the "no inline groups" gate below — deleting just the
  // `FileVersion <= 3` check would not turn it red. This fixture carries a real inline group so
  // ONLY the FileVersion check can be the reason it returns undefined.
  it("is undefined for a v3 input that DOES carry an inline group (FileVersion alone must gate it)", () => {
    const v3WithGroups = v4Input();
    v3WithGroups.set(
      "meta.json",
      enc({
        FileVersion: 3,
        Name: "in",
        Groups: [
          {
            Name: "G",
            Type: "Single",
            Options: [{ Name: "On", Files: { "chara/a.bin": "files\\a.bin" } }],
          },
        ],
        DefaultData: { Version: 0 },
      }),
    );
    expect(makeV4ExtraFileDuplicateConfirmation(v3WithGroups)).toBeUndefined();
  });

  it("is undefined for a v4-numbered input with no inline groups (nothing to misclassify)", () => {
    const m = v4Input();
    m.set(
      "meta.json",
      enc({ FileVersion: 4, Name: "in", Groups: [], DefaultData: null }),
    );
    expect(makeV4ExtraFileDuplicateConfirmation(m)).toBeUndefined();
  });
});

describe("makeV4ExtraFileDuplicateConfirmation predicate", () => {
  it("confirms the true bug #23 shape: golden-only verbatim copy, twin present in golden AND ours, unreferenced by Files", () => {
    const confirm = makeV4ExtraFileDuplicateConfirmation(v4Input())!;
    expect(confirm("files/a.bin", goldenTrueShape(), oursTrueShape)).toBe(true);
  });

  // Criterion (a): the golden-only name must correspond to SOME input member.
  it("REJECTS (a): a golden-only name absent from the INPUT pack entirely", () => {
    const confirm = makeV4ExtraFileDuplicateConfirmation(v4Input())!;
    const golden = goldenTrueShape({
      // "invented/b.bin" replaces "files/a.bin" as the duplicate under test; the twin/reference
      // shape around it is otherwise the true-positive one, so (b)/(c)/(d) would all pass if
      // reached — isolating (a) as the actual rejecting criterion.
      members: { "invented/b.bin": PAYLOAD, "g/chara/a.bin": PAYLOAD },
    });
    expect(confirm("invented/b.bin", golden, oursTrueShape)).toBe(false);
  });

  // Criterion (b): the golden-only member's bytes must equal the SAME-NAMED input member's bytes.
  // Mutation-sensitive per the 2026-08-07 review: OTHER is placed in a SECOND golden member
  // ("g/chara/a.bin") and in `ours`, so criteria (c) and (d) would both be SATISFIED if reached —
  // only (b) (input's "files/a.bin" is PAYLOAD, not OTHER) can be the reason this returns false.
  // Deleting the (b) check line, and nothing else, turns this test red.
  it("REJECTS (b): golden-only bytes differ from the SAME-NAMED input member's bytes", () => {
    const confirm = makeV4ExtraFileDuplicateConfirmation(v4Input())!;
    const golden = goldenTrueShape({
      members: { "files/a.bin": OTHER, "g/chara/a.bin": OTHER },
    });
    const ours = new Map<string, Uint8Array>([
      ["meta.json", enc({ FileVersion: 4 })],
      ["g/chara/a.bin", OTHER],
    ]);
    expect(confirm("files/a.bin", golden, ours)).toBe(false);
  });

  // Criterion (c): the golden-only name must NOT be referenced by any Files value in the golden's
  // OWN manifest. Only the manifest's Files map differs from the true-positive fixture (it now
  // points straight at "files/a.bin", the duplicate's own name, instead of the regenerated twin) —
  // (a), (b), and (d) all still hold, isolating (c).
  it("REJECTS (c): the golden-only name IS referenced by a Files value in the golden's manifest", () => {
    const confirm = makeV4ExtraFileDuplicateConfirmation(v4Input())!;
    const golden = goldenTrueShape({
      metaFiles: { "chara/a.bin": "files\\a.bin" }, // points at the duplicate itself, not the twin
    });
    expect(confirm("files/a.bin", golden, oursTrueShape)).toBe(false);
  });

  // Criterion (d), no-twin-in-golden variant: this is the reviewer's demonstration 1 — a genuinely
  // DROPPED file, unrelated to bug #23, that happens to share content with something `ours` kept.
  // "our writer drops b" (a file legitimately regenerated under ONE name only): golden has "files
  // /b.bin" as a lone, unreferenced member (no second golden member shares its bytes), while ours
  // still carries UNRELATED content ("g/chara/a.bin") with the exact same bytes purely by
  // coincidence. The pre-review rule (a global "do these bytes appear anywhere in ours" scan) would
  // have wrongly confirmed this; requiring a GOLDEN-side twin closes it.
  it("REJECTS (d) — reviewer demonstration 1: a genuinely dropped file that coincidentally shares bytes with something ours kept", () => {
    const input = new Map<string, Uint8Array>([
      [
        "meta.json",
        enc({
          FileVersion: 4,
          Name: "in",
          Groups: [
            {
              Name: "G",
              Type: "Single",
              Options: [
                { Name: "On", Files: { "chara/b.bin": "files\\b.bin" } },
              ],
            },
          ],
          DefaultData: { Version: 0 },
        }),
      ],
      ["files/a.bin", PAYLOAD], // an unrelated input file, same bytes as b — never itself under test
      ["files/b.bin", PAYLOAD],
    ]);
    const golden = new Map<string, Uint8Array>([
      [
        "meta.json",
        enc({
          FileVersion: 4,
          Name: "in",
          // References something else entirely — "files/b.bin" is NOT pointed at, so (c) alone does
          // not explain the rejection; NOR is there a second golden member sharing PAYLOAD's bytes,
          // so (d) is the criterion doing the rejecting here.
          Groups: [
            {
              Name: "G",
              Type: "Single",
              Options: [
                { Name: "On", Files: { "chara/other.bin": "g\\other.bin" } },
              ],
            },
          ],
          DefaultData: { Version: 0 },
        }),
      ],
      ["g/other.bin", OTHER],
      ["files/b.bin", PAYLOAD], // the lone golden-only member under test — no twin anywhere in golden
    ]);
    const ours = new Map<string, Uint8Array>([
      ["meta.json", enc({ FileVersion: 4 })],
      ["g/chara/a.bin", PAYLOAD], // "ours still has a" — coincidental byte match, not the twin
    ]);
    const confirm = makeV4ExtraFileDuplicateConfirmation(input)!;
    expect(confirm("files/b.bin", golden, ours)).toBe(false);
  });

  // Criterion (d), twin-not-in-ours variant: golden DOES carry a second, differently-named member
  // with the same bytes (the shape bug #23 predicts), but OUR archive never wrote it — a genuine
  // writer bug dropping the file we were actually supposed to keep, not this divergence.
  it("REJECTS (d): golden has a differently-named twin, but OUR archive doesn't carry it", () => {
    const confirm = makeV4ExtraFileDuplicateConfirmation(v4Input())!;
    const golden = goldenTrueShape(); // has both "files/a.bin" and its twin "g/chara/a.bin"
    const oursWithoutTwin = new Map<string, Uint8Array>([
      ["meta.json", enc({ FileVersion: 4 })],
      // no "g/chara/a.bin" at all: we dropped the ONE copy we were meant to keep.
    ]);
    expect(confirm("files/a.bin", golden, oursWithoutTwin)).toBe(false);
  });

  // Reviewer demonstration 2: an input pack whose OWN member names already are the regenerated
  // names (so the duplicate and its twin would collapse onto one name if bug #23 fired — it can't
  // be observed at all here), with a golden-only member that IS directly referenced by Files. This
  // is not bug #23's shape in any respect; criterion (c) must reject it.
  //
  // Deliberately gives golden AND ours a real, differently-named twin ("other/twin.bin") that would
  // satisfy (d) if this test relied on it — so this specifically isolates (c) as the ONLY rejecting
  // criterion. (Without the twin, (d) would independently reject too — a correct but WEAKER
  // demonstration, verified by mutation-testing the first draft of this fixture: with (c) disabled,
  // that draft stayed green because (d) alone still rejected it. This shape does not.)
  it("REJECTS (c) — reviewer demonstration 2: a referenced golden-only member from an unrelated writer bug", () => {
    const filesValue = { "chara/shared.bin": "shared/dup.bin" };
    const input = new Map<string, Uint8Array>([
      [
        "meta.json",
        enc({
          FileVersion: 4,
          Name: "in",
          Groups: [
            {
              Name: "G",
              Type: "Single",
              Options: [{ Name: "On", Files: filesValue }],
            },
          ],
          DefaultData: { Version: 0 },
        }),
      ],
      ["shared/dup.bin", PAYLOAD],
    ]);
    const golden = new Map<string, Uint8Array>([
      [
        "meta.json",
        enc({
          FileVersion: 4,
          Name: "in",
          // Points DIRECTLY at "shared/dup.bin" — the golden-only member under test — unlike the
          // true bug #23 shape, where the referenced Files value always names the TWIN, never the
          // duplicate itself.
          Groups: [
            {
              Name: "G",
              Type: "Single",
              Options: [{ Name: "On", Files: filesValue }],
            },
          ],
          DefaultData: { Version: 0 },
        }),
      ],
      ["shared/dup.bin", PAYLOAD], // golden-only: our writer dropped this entirely
      ["other/twin.bin", PAYLOAD], // a real (d)-satisfying twin, present on both sides
    ]);
    const ours = new Map<string, Uint8Array>([
      ["meta.json", enc({ FileVersion: 4 })],
      ["other/twin.bin", PAYLOAD],
      // no "shared/dup.bin" — genuinely lost.
    ]);
    const confirm = makeV4ExtraFileDuplicateConfirmation(input)!;
    expect(confirm("shared/dup.bin", golden, ours)).toBe(false);
  });

  // Guards against the review's "addendum" note: `diffPayloadMembers`/`diffPayloadSemantic` pass
  // this predicate the FULL member map (manifests included), so the (d) byte-scan must not treat a
  // manifest document as a candidate "twin" merely because its serialized bytes happen to collide
  // with the duplicate's. Contrived (real manifest JSON and a 4-byte binary payload essentially
  // never collide) so BOTH sides' "meta.json" share `sharedBytes` with the duplicate — this is what
  // makes the test load-bearing: with either `isManifest` guard alone still in place (golden-side,
  // in the (d) scan's candidate loop, or ours-side, in `byLooseKey(oursMembers, true)`), the OTHER
  // guard is enough to keep this rejected, so both must hold for the assertion to mean anything.
  // Only if manifest documents were treated as ordinary payload candidates on BOTH sides would
  // "meta.json" wrongly serve as the (d) twin here and flip this to `true`.
  it("does not treat a manifest member as a valid (d) twin, even if its bytes happen to collide on both sides", () => {
    const sharedBytes = PAYLOAD; // stands in for "coincidentally identical to meta.json's bytes"
    const input = new Map<string, Uint8Array>([
      [
        "meta.json",
        enc({
          FileVersion: 4,
          Name: "in",
          Groups: [
            {
              Name: "G",
              Type: "Single",
              Options: [
                { Name: "On", Files: { "chara/a.bin": "files\\a.bin" } },
              ],
            },
          ],
          DefaultData: { Version: 0 },
        }),
      ],
      ["files/a.bin", sharedBytes],
    ]);
    const golden = new Map<string, Uint8Array>([
      ["meta.json", sharedBytes], // golden's OWN manifest bytes happen to equal the duplicate's
      ["files/a.bin", sharedBytes], // the duplicate under test — no REAL payload twin exists
    ]);
    const ours = new Map<string, Uint8Array>([
      ["meta.json", sharedBytes], // ours' manifest ALSO happens to hold the same bytes
    ]);
    const confirm = makeV4ExtraFileDuplicateConfirmation(input)!;
    expect(confirm("files/a.bin", golden, ours)).toBe(false);
  });
});
