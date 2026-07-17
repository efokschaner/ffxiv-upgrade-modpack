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

function describeProduceError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      message?: unknown;
      stdout?: Uint8Array | string;
      stderr?: Uint8Array | string;
    };
    const parts: string[] = [];
    if (typeof e.message === "string") parts.push(e.message);
    if (e.stdout && e.stdout.length > 0) parts.push(String(e.stdout));
    if (e.stderr && e.stderr.length > 0) parts.push(String(e.stderr));
    if (parts.length > 0) return parts.join("\n");
  }
  return String(err);
}

/** The captured child-process OUTPUT only (stdout+stderr) — deliberately excluding `.message`,
 * which execFileSync always populates with a generic "Command failed: ..." even when the process
 * printed nothing at all. Used to distinguish a genuine ConsoleTools failure (which always prints
 * something describing what went wrong, e.g. the Milktruck "CMP Format Changed" stack trace) from
 * a bare non-zero exit with no diagnostic output — see `resaveGoldenCached`'s catch block. */
function processOutputText(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const e = err as {
    stdout?: Uint8Array | string;
    stderr?: Uint8Array | string;
  };
  const parts: string[] = [];
  if (e.stdout && e.stdout.length > 0) parts.push(String(e.stdout));
  if (e.stderr && e.stderr.length > 0) parts.push(String(e.stderr));
  return parts.join("\n");
}

/**
 * True only for a throw shaped like `execFileSync`'s non-zero-exit / signal-kill error (see
 * oracle.ts's `run()`): Node sets BOTH `status` (the exit code, or `null` if killed by signal)
 * and `signal` (the signal name, or `null` if exited normally) on that error object. A throw
 * that reaches here without either field did NOT come from the ConsoleTools child process — it
 * is a bug in our own harness code (a path typo, a permissions error, a missing temp dir) and
 * must never be classified as "the oracle errors on this pack" (see Finding 1: caching an
 * arbitrary throw here masqueraded a harness bug as a permanent TexTools limitation, forever,
 * with no retry).
 */
function isConsoleToolsProcessError(
  err: unknown,
): err is { status: number | null; signal: string | null } {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; signal?: unknown };
  const statusShapeOk = typeof e.status === "number" || e.status === null;
  const signalShapeOk = typeof e.signal === "string" || e.signal === null;
  if (!statusShapeOk || !signalShapeOk) return false;
  // Both fields present-but-null would mean neither actually carries process-exit info.
  return typeof e.status === "number" || typeof e.signal === "string";
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
    // Only a genuine ConsoleTools PROCESS failure (execFileSync's non-zero-exit / signal-kill
    // error) may be cached as "the oracle errors on this pack" — see isConsoleToolsProcessError.
    // Anything else is a bug in THIS harness and must propagate. An empty-output process error is
    // oracle.ts's residual lock-race signature; propagate and let a re-run clear it. (Mirrors
    // resave-golden.ts.)
    if (!isConsoleToolsProcessError(err)) throw err;
    if (processOutputText(err).trim().length === 0) throw err;
    const message = describeProduceError(err);
    mkdirSync(dir, { recursive: true });
    writeFileSync(errPath, message);
    return { kind: "error", message };
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
