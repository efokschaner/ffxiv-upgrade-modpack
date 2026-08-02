// Regression test for the port-gap escape at src/upgrade/unclaimed-hair.ts's hair/tail/ear
// transform catch (EndwalkerUpgrade.cs:1498-1501's swallow, mirrored faithfully for any
// C#-reachable failure but NOT for a signal that OUR PORT is incomplete). See AGENTS.md's
// "Port-gap errors vs. ported catches" and the confirmed instance recorded in
// docs/backlog/2026-07-31-unported-gap-error-sweep.md.
//
// This drives a full modpack through the REAL production seam, `upgradeModpack`, with a fixture
// that reaches the hair rescue path (src/upgrade/unclaimed-hair.ts's `partials` caller,
// src/upgrade/upgrade.ts), mocking `updateEndwalkerHairTextures` -- the transform called INSIDE
// the try at unclaimed-hair.ts:200 -- to throw a real `UnportedGapError`. Kept in its own file
// (rather than folded into unclaimed-hair.test.ts) because `vi.mock` is file-scoped and would
// otherwise defeat that file's genuine-corrupt-input coverage of the same catch.
//
// `updateEndwalkerHairTextures` is a direct named import into unclaimed-hair.ts from
// `./texture` (src/upgrade/texture.ts), so `vi.spyOn` on the imported binding cannot intercept
// it -- only `vi.mock` on the module itself can. The factory below keeps every OTHER export of
// `./texture` real (upgradeRemainingTextures et al. are unrelated to this seam and must not be
// stubbed).
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/upgrade/texture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/upgrade/texture")>()),
  updateEndwalkerHairTextures: vi.fn(),
}));

import { DiagnosticCode, upgradeModpack } from "../../src/index";
import {
  FileStorageType,
  type ModpackData,
  ModpackFormat,
} from "../../src/model/modpack";
import { updateEndwalkerHairTextures } from "../../src/upgrade/texture";
import { UnportedGapError } from "../../src/util/errors";
import { filesMap } from "../helpers/make-packs";
import { buildMinimalTex } from "../tex/make-tex";

// A real DT hair table entry (src/upgrade/reference/hair-materials.ts) with shaderPackRaw
// "hair.shpk", confirmed reachable by the existing unit test
// "copies a loose normal+mask to the canonical Dx11 destinations"
// (test/upgrade/unclaimed-hair.test.ts), which uses this SAME material path against the real,
// unmocked `fileExists` -- i.e. fileExists(HAIR_MAT) is true in-game.
const NORM_OLD =
  "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_n.tex";
const SPEC_OLD =
  "chara/human/c0101/obj/hair/h0001/texture/c0101h0001_hir_s.tex";

/** One group/option pack carrying only a loose hair normal+specular pair with no accompanying
 *  material -- reaches updateUnclaimedHairTextures' rescue path (src/upgrade/upgrade.ts's
 *  `partials`): both textures are untouched by the (materialless) material round, so they land in
 *  `allTextures`, are never a texture-upgrade target VALUE, and are therefore `contained`
 *  (globally-unused) for their own option -- the exact set the hair/tail/ear collector scans. */
function buildHairRescuePack(): ModpackData {
  return {
    sourceFormat: ModpackFormat.Ttmp2,
    isSimple: false,
    meta: {
      name: "M",
      author: "A",
      version: "1",
      description: "",
      url: "",
      image: "",
      tags: [],
      minimumFrameworkVersion: "1.0.0.0",
    },
    groups: [
      {
        name: "G",
        description: "",
        image: "",
        page: 0,
        priority: 0,
        selectionType: "Single",
        defaultSettings: 0,
        options: [
          {
            name: "O",
            description: "",
            image: "",
            priority: 0,
            selected: false,
            fileSwaps: {},
            manipulations: [],
            files: filesMap([
              [
                NORM_OLD,
                {
                  data: buildMinimalTex(),
                  storage: FileStorageType.RawUncompressed,
                },
              ],
              [
                SPEC_OLD,
                {
                  data: buildMinimalTex(),
                  storage: FileStorageType.RawUncompressed,
                },
              ],
            ]),
          },
        ],
      },
    ],
  };
}

describe("unclaimed-hair port-gap escape (e2e through upgradeModpack)", () => {
  it("propagates UnportedGapError from the hair transform rather than swallowing it as a hair-transform failure", () => {
    vi.mocked(updateEndwalkerHairTextures).mockImplementation(() => {
      throw new UnportedGapError(
        "simulated port gap beneath the hair transform",
      );
    });

    const r = upgradeModpack(buildHairRescuePack());

    // Without the `if (err instanceof UnportedGapError) throw err;` guard at
    // unclaimed-hair.ts:213, the bare catch swallows this, the raw pre-transform copies
    // (already written above the try) are left in place, and the pack "succeeds" (`ok: true`)
    // with no diagnostic -- the class-1 silent-wrong-output failure the guard exists to prevent.
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]!.code).toBe(DiagnosticCode.UnportedGap);
    expect(r.diagnostics[0]!.cause).toBeInstanceOf(UnportedGapError);
  });
});
