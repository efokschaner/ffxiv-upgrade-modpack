import { afterAll, beforeAll, describe } from "vitest";
import { decodePack, newPackContext } from "./corpus-decode";
import { registerGeometryChecks } from "./corpus-geometry";
import { registerMdlChecks } from "./corpus-mdl";
import { registerMtrlChecks } from "./corpus-mtrl";
import { registerSqpackChecks } from "./corpus-sqpack";
import { registerTexChecks } from "./corpus-tex";

/**
 * The `assets` work unit: every ASSET-LEVEL check for one pack, over ONE shared load + decode.
 *
 * These five check families (sqpack, mtrl, tex, mdl, geometry) used to be five separate units, each
 * in its own worker process, each re-running `readFileSync -> loadModpack -> decodeSqPackFile` from
 * scratch. That made the per-filetype checks ~95% redundant inflate: on the biggest pack the `tex`
 * check spent 3951 ms re-decoding and 189 ms asserting (mdl 110/3, mtrl 64/3). Sharing one decode
 * keeps every assertion and drops the duplication.
 *
 * Each family still lives in its OWN module with its own `describe`, so a failure still names the
 * check that found it and the port's file-per-concern shape is preserved — only the decode is shared.
 *
 * The pack-level checks (golden, upgrade, resave) stay separate units: they exercise the WRITE path
 * and the ConsoleTools oracles, they do not want this decode, and keeping them apart preserves the
 * scheduling granularity that lets the forks pool fill all cores.
 */
export function registerAssetChecks(pack: string): void {
  const ctx = newPackContext(pack);
  describe(`assets corpus: ${ctx.name}`, () => {
    // ONE load + decode for all five families below. Registration runs at collect time, so the
    // checks close over `ctx` and read `ctx.entries` when their `it` actually executes.
    beforeAll(() => {
      decodePack(ctx);
    }, 1_200_000);

    // Release the decoded payloads so per-worker memory stays at ~one pack.
    afterAll(() => {
      ctx.entries = [];
    });

    registerSqpackChecks(ctx);
    registerMtrlChecks(ctx);
    registerTexChecks(ctx);
    registerMdlChecks(ctx);
    registerGeometryChecks(ctx);
  });
}
