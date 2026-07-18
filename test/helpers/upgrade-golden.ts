import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModpack, type ModpackData } from "../../src/index";
import {
  OracleUpgradeError,
  oracleAvailable,
  oracleCacheGet,
  oracleCachePut,
  oracleKey,
  upgradeWithTraceCapture,
} from "./oracle";

/** Content-addressed cache of ConsoleTools /upgrade outputs. Under the gitignored
 * test/corpus/ tree (see .gitignore) so it is never committed. Keyed by sha256(input pack). */
export const DEFAULT_UPGRADE_CACHE = join(
  __dirname,
  "..",
  "corpus",
  ".upgrade-cache",
);

export type GoldenResult =
  | { kind: "pack"; data: ModpackData; bytes: Uint8Array }
  | { kind: "noop" }
  | { kind: "error"; message: string };

/** Golden container extension implied by the source name. Format is preserved: pmp->pmp; every
 * TTMP-family input (.ttmp2 AND legacy .ttmp) folds to ttmp2 because ConsoleTools /upgrade always
 * emits a Dawntrail .ttmp2 for those, never legacy .ttmp. Comparison is decompressed-by-gamePath,
 * so the container format is not load-bearing anyway — this only keeps the cached golden tidy. */
function goldenExt(name: string): "pmp" | "ttmp2" {
  return name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
}

/** Marker file recording that /upgrade produced no output (a no-op upgrade). */
function noopMarker(key: string, dir: string): string {
  return join(dir, `${key}.noop`);
}

/** Marker recording that ConsoleTools /upgrade ERRORED on this input (content-addressed, like the
 * `.noop` marker). Stores the error text for later loud reporting. Mirrors resave-golden.ts. */
function errorMarker(key: string, dir: string): string {
  return join(dir, `${key}.error`);
}

let UPGRADE_TMP: string | null = null;
function upgradeTmpDir(): string {
  if (UPGRADE_TMP === null)
    UPGRADE_TMP = mkdtempSync(join(tmpdir(), "upgrade-"));
  return UPGRADE_TMP;
}

/** Run ConsoleTools /upgrade on in-memory bytes; returns golden bytes, or null on a no-op
 * (ConsoleTools writes NO output file when there are no changes — ModpackUpgrader.cs:212). */
function upgradeViaConsoleTools(
  name: string,
  bytes: Uint8Array,
): Uint8Array | null {
  const dir = upgradeTmpDir();
  const lower = name.toLowerCase();
  const srcExt = lower.endsWith(".pmp")
    ? "pmp"
    : lower.endsWith(".ttmp")
      ? "ttmp"
      : "ttmp2";
  const src = join(dir, `in.${srcExt}`);
  const dest = join(dir, `out.${goldenExt(name)}`);
  writeFileSync(src, bytes);
  rmSync(dest, { force: true }); // a no-op leaves NO file — surface that as null, not a stale read
  upgradeWithTraceCapture(src, dest);
  return existsSync(dest) ? new Uint8Array(readFileSync(dest)) : null;
}

/**
 * Cached /upgrade golden for `bytes`, spawning ConsoleTools at most once per distinct input.
 * Returns { kind: "pack" } (golden parsed), { kind: "noop" } (upgrade changed nothing), or
 * { kind: "error" } (a GENUINE ConsoleTools /upgrade failure — cached as a `.error` marker,
 * mirroring resave-golden.ts's ResaveGoldenResult), or null only when uncached AND no oracle is
 * available (caller fails per policy). The "error" outcome is captured from ConsoleTools' Trace
 * channel, not stdout/stderr: HandleUpgrade (Program.cs:185) reports /upgrade exceptions via
 * Trace.WriteLine (not Console), so upgradeViaConsoleTools's call to upgradeWithTraceCapture reads
 * ConsoleTools' configured trace log and classifies the failure as an OracleUpgradeError.
 */
export function upgradeGoldenCached(
  name: string,
  bytes: Uint8Array,
  opts: {
    dir?: string;
    available?: boolean;
    produce?: (name: string, bytes: Uint8Array) => Uint8Array | null;
  } = {},
): GoldenResult | null {
  const dir = opts.dir ?? DEFAULT_UPGRADE_CACHE;
  const key = oracleKey(bytes);

  const errPath = errorMarker(key, dir);
  if (existsSync(errPath)) {
    return { kind: "error", message: readFileSync(errPath, "utf8") };
  }
  if (existsSync(noopMarker(key, dir))) return { kind: "noop" };
  const hit = oracleCacheGet(key, dir);
  if (hit !== null) {
    return {
      kind: "pack",
      data: loadModpack(`golden.${goldenExt(name)}`, hit),
      bytes: hit,
    };
  }

  const available = opts.available ?? oracleAvailable();
  if (!available) return null;

  const produce = opts.produce ?? upgradeViaConsoleTools;
  let out: Uint8Array | null;
  try {
    out = produce(name, bytes);
  } catch (err) {
    // A genuine ConsoleTools /upgrade error (its exception is on the Trace channel, captured by
    // upgradeWithTraceCapture as an OracleUpgradeError) is cached as {kind:"error"}. Anything else
    // (harness bug, lock-race, unexplained non-zero exit) propagates — never silently recorded as an
    // oracle verdict.
    if (err instanceof OracleUpgradeError) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(errPath, err.message);
      return { kind: "error", message: err.message };
    }
    throw err;
  }
  if (out === null) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(noopMarker(key, dir), new Uint8Array(0));
    return { kind: "noop" };
  }
  oracleCachePut(key, out, dir);
  return {
    kind: "pack",
    data: loadModpack(`golden.${goldenExt(name)}`, out),
    bytes: out,
  };
}
