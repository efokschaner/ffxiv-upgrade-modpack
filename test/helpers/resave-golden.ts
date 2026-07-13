import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  oracleAvailable,
  oracleCacheGet,
  oracleCachePut,
  oracleKey,
  resave,
} from "./oracle";

/** Content-addressed cache of ConsoleTools /resave outputs. Under the gitignored test/corpus/ tree.
 *  Separate dir from .upgrade-cache: the key is sha256(input pack) for BOTH, so they would collide. */
export const DEFAULT_RESAVE_CACHE = join(
  __dirname,
  "..",
  "corpus",
  ".resave-cache",
);

/** Ratchet baseline for the resave check. Separate dir from the upgrade baseline: both are keyed by
 *  sha256(input pack), so one dir would make the two harnesses overwrite each other. */
export const DEFAULT_RESAVE_BASELINE = join(
  __dirname,
  "..",
  "corpus",
  ".resave-baseline",
);

let RESAVE_TMP: string | null = null;
function resaveTmpDir(): string {
  if (RESAVE_TMP === null) RESAVE_TMP = mkdtempSync(join(tmpdir(), "resave-"));
  return RESAVE_TMP;
}

/** Source extension drives BOTH sides: WriteModpack dispatches on the DESTINATION extension
 *  (WizardData.cs:1312-1326), so resaving to the same extension is what exercises the writer we are
 *  testing. A legacy `.ttmp` resaves to `.ttmp2` — TexTools has no legacy writer, and our
 *  writeModpack targets ttmp2 for the whole TTMP family. */
function resaveExt(name: string): "pmp" | "ttmp2" {
  return name.toLowerCase().endsWith(".pmp") ? "pmp" : "ttmp2";
}

function resaveViaConsoleTools(name: string, bytes: Uint8Array): Uint8Array {
  const dir = resaveTmpDir();
  const lower = name.toLowerCase();
  const srcExt = lower.endsWith(".pmp")
    ? "pmp"
    : lower.endsWith(".ttmp")
      ? "ttmp"
      : "ttmp2";
  const src = join(dir, `in.${srcExt}`);
  const dest = join(dir, `out.${resaveExt(name)}`);
  writeFileSync(src, bytes);
  rmSync(dest, { force: true }); // a silent no-write must surface as ENOENT, not a stale read
  resave(src, dest);
  return new Uint8Array(readFileSync(dest));
}

/**
 * Cached ConsoleTools /resave golden for `bytes`, spawning ConsoleTools at most once per distinct
 * input. /resave is load-then-write (Program.cs:191-221) with NO transform, so it is a pure oracle
 * for our writers — the one thing the /upgrade harness has never covered (it compares our writer to
 * the INPUT archive on the no-op branch, i.e. it takes our own writer as ground truth).
 *
 * Unlike /upgrade there is no no-op case: /resave always writes.
 * Returns null only when uncached AND no oracle is available (caller fails per policy).
 */
export function resaveGoldenCached(
  name: string,
  bytes: Uint8Array,
  opts: {
    dir?: string;
    available?: boolean;
    produce?: (name: string, bytes: Uint8Array) => Uint8Array;
  } = {},
): Uint8Array | null {
  const dir = opts.dir ?? DEFAULT_RESAVE_CACHE;
  const key = oracleKey(bytes);
  const hit = oracleCacheGet(key, dir);
  if (hit !== null) return hit;
  const available = opts.available ?? oracleAvailable();
  if (!available) return null;
  const out = (opts.produce ?? resaveViaConsoleTools)(name, bytes);
  oracleCachePut(key, out, dir);
  return out;
}
