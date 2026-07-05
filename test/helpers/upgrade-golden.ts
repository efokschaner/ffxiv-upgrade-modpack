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
  oracleAvailable,
  oracleCacheGet,
  oracleCachePut,
  oracleKey,
  upgrade,
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
  | { kind: "pack"; data: ModpackData }
  | { kind: "noop" };

/** Golden container extension implied by the source name (format preserved: pmp->pmp, else ttmp2). */
function goldenExt(name: string): "pmp" | "ttmp2" {
  return name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
}

/** Marker file recording that /upgrade produced no output (a no-op upgrade). */
function noopMarker(key: string, dir: string): string {
  return join(dir, `${key}.noop`);
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
  upgrade(src, dest);
  return existsSync(dest) ? new Uint8Array(readFileSync(dest)) : null;
}

/**
 * Cached /upgrade golden for `bytes`, spawning ConsoleTools at most once per distinct input.
 * Returns { kind: "pack" } (golden parsed) or { kind: "noop" } (upgrade changed nothing), or
 * null only when uncached AND no oracle is available (caller fails per policy).
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

  if (existsSync(noopMarker(key, dir))) return { kind: "noop" };
  const hit = oracleCacheGet(key, dir);
  if (hit !== null) {
    return {
      kind: "pack",
      data: loadModpack(`golden.${goldenExt(name)}`, hit),
    };
  }

  const available = opts.available ?? oracleAvailable();
  if (!available) return null;

  const produce = opts.produce ?? upgradeViaConsoleTools;
  const out = produce(name, bytes);
  if (out === null) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(noopMarker(key, dir), new Uint8Array(0));
    return { kind: "noop" };
  }
  oracleCachePut(key, out, dir);
  return { kind: "pack", data: loadModpack(`golden.${goldenExt(name)}`, out) };
}
