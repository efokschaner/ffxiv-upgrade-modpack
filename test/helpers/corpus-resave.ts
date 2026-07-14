import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { applyLoadFixes, loadModpack, writeModpack } from "../../src/index";
import { oracleKey } from "./oracle";
import { DEFAULT_RESAVE_BASELINE, resaveGoldenCached } from "./resave-golden";
import { diffArchives } from "./upgrade-archive-diff";
import {
  compareToBaseline,
  loadBaseline,
  saveBaseline,
} from "./upgrade-baseline";
import { confirmDivergence } from "./upgrade-compare";
import { diffUpgrade } from "./upgrade-diff";

const BLESS = process.env.UPDATE_UPGRADE_BASELINE === "1";

/**
 * WRITE-SIDE golden check: load + load-time fixes + write, vs ConsoleTools /resave — the same
 * load path /upgrade takes (Program.cs:204 -> WizardData.FromModpack), minus the transform. This is
 * the first thing in the suite to AB-test our WRITERS against TexTools at all; the /upgrade harness
 * oracles the transform and, on its no-op branch, silently takes our own writer as ground truth.
 *
 * Ratcheted against its own baseline dir (the key is sha256(input pack) for both harnesses, so a
 * shared dir would collide).
 */
export function registerResaveCheck(pack: string): void {
  const name = basename(pack);
  describe(`resave golden: ${name}`, () => {
    it("matches ConsoleTools /resave within the ratchet baseline", (ctx) => {
      const bytes = new Uint8Array(readFileSync(pack));
      const ours = loadModpack(name, bytes);
      applyLoadFixes(ours); // TexTools' load is not inert for old packs — see applyLoadFixes
      const target = name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
      // store: only the archive's member names and DECOMPRESSED content are diffed against the
      // golden (diffArchives / diffUpgrade), never its deflated bytes. See writePmp's doc comment.
      const oursArchive = writeModpack(ours, target, { store: true });

      const result = resaveGoldenCached(name, bytes);
      if (result === null) {
        throw new Error(
          `No /resave golden for ${name}: uncached and no oracle (TexTools) available. ` +
            `Run with ConsoleTools installed to populate test/corpus/.resave-cache.`,
        );
      }
      if (result.kind === "error") {
        // The ORACLE errors on this input — ConsoleTools cannot resave it at all (e.g. its
        // RSP-manipulation write path reads the installed game's human.cmp and throws "CMP
        // Format Changed"). There is nothing to diff our writer against, so this is neither a
        // pass nor a generic skip: log it loudly and mark the writer explicitly UNVERIFIED for
        // this pack, rather than letting the suite go quietly green as if it had matched.
        const message =
          `ConsoleTools /resave CANNOT round-trip ${name} — the oracle itself errors, so our ` +
          `writer is UNVERIFIED (not matched, not passing) for this pack. See ` +
          `docs/backlog/2026-07-11-expected-failure-golden.md. Oracle error:\n` +
          result.message;
        console.error(`[resave] UNVERIFIED: ${message}`);
        ctx.skip(message);
        return;
      }
      const goldenBytes = result.bytes;
      const golden = loadModpack(`golden.${target}`, goldenBytes);

      const payload = diffUpgrade(
        name,
        loadModpack(name, oursArchive), // re-read: compare the ARTIFACT, same as corpus-upgrade
        golden,
        confirmDivergence,
      );
      // Payload MEMBER NAMES are compared here from the start (unlike the /upgrade harness, which
      // has to keep them off until the writer regenerates them): that is the whole point of this
      // check — the names are what the writer decides.
      const archive = diffArchives(oursArchive, goldenBytes, target === "pmp");
      const diff = { ...payload, files: [...payload.files, ...archive] };
      const key = oracleKey(bytes);

      if (BLESS) {
        saveBaseline(key, diff.files, DEFAULT_RESAVE_BASELINE);
        console.log(
          `[resave] blessed ${name}: ${diff.matched} matched, ${diff.files.length} recorded`,
        );
        return;
      }

      const baseline = loadBaseline(key, DEFAULT_RESAVE_BASELINE) ?? [];
      const { ok, regressions } = compareToBaseline(diff.files, baseline);
      console.log(
        `[resave] ${name}: ${diff.matched} matched, ${diff.files.length} diffs, ` +
          `${regressions.length} regressions (baseline ${baseline.length})`,
      );
      if (!ok) {
        expect.fail(
          `resave regressions in ${name}: ` +
            regressions
              .map((r) => `${r.gamePath}#${r.index}:${r.status}`)
              .join(", "),
        );
      }
    }, 1_200_000);
  });
}
