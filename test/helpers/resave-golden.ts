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

/**
 * Outcome of a cached /resave: a produced golden `pack`, or a cached record that the ORACLE
 * ITSELF errors on this input (`error`) — e.g. ConsoleTools' write path throwing on a pack it
 * cannot resave. Mirrors `upgrade-golden.ts`'s `GoldenResult`, minus the `noop` kind: /resave has
 * no no-op case (Program.cs:191-221 always writes), but unlike /upgrade it CAN error on a pack
 * whose /upgrade is a no-op (see docs/backlog/2026-07-11-expected-failure-golden.md for the case that
 * forced this — Milktruck Bust Scaling Tweaks, a CMP-format oracle crash on write).
 */
export type ResaveGoldenResult =
  | { kind: "pack"; bytes: Uint8Array }
  | { kind: "error"; message: string };

/** Marker file recording that ConsoleTools /resave ERRORED on this input (content-addressed,
 * analogous to upgrade-golden.ts's `.noop` marker) — so the outcome is recorded once and never
 * re-spawns ConsoleTools only to throw again. Stores the error text for later loud reporting. */
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
 * for our writers — and, for a pack whose /upgrade no-ops, the SOLE one: that branch no longer
 * compares member names or manifest JSON against anything (see
 * docs/superpowers/specs/2026-07-19-upgrade-noop-branch-oracle-design.md).
 *
 * Unlike /upgrade there is no no-op case: /resave always writes — but it CAN error: TexTools
 * cannot round-trip every pack it can load (e.g. its RSP-manipulation write path reads the
 * installed game's `human.cmp` and can throw "CMP Format Changed" on a bust-scaling pack). Such a
 * failure is cached as `{ kind: "error" }` (a `<key>.error` marker) so it is recorded once and
 * never re-spawns ConsoleTools only to throw again — the caller decides how to report it (see
 * `corpus-resave.ts`: log loudly, mark the writer UNVERIFIED, do not silently pass).
 *
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
): ResaveGoldenResult | null {
  const dir = opts.dir ?? DEFAULT_RESAVE_CACHE;
  const key = oracleKey(bytes);

  const errPath = errorMarker(key, dir);
  if (existsSync(errPath)) {
    return { kind: "error", message: readFileSync(errPath, "utf8") };
  }
  const hit = oracleCacheGet(key, dir);
  if (hit !== null) return { kind: "pack", bytes: hit };

  const available = opts.available ?? oracleAvailable();
  if (!available) return null;

  const produce = opts.produce ?? resaveViaConsoleTools;
  try {
    const out = produce(name, bytes);
    oracleCachePut(key, out, dir);
    return { kind: "pack", bytes: out };
  } catch (err) {
    // Only a genuine ConsoleTools PROCESS failure (execFileSync's non-zero-exit / signal-kill
    // error, carrying `status`/`signal`) may be cached as "the oracle errors on this pack" — see
    // isConsoleToolsProcessError's doc comment. Anything else (our own writeFileSync/rmSync/
    // readFileSync in resaveViaConsoleTools throwing, a bad path, a permissions error) is a bug
    // in THIS harness, not TexTools, and must propagate and fail the test loudly rather than be
    // cached forever as a false "oracle errors" verdict that is never retried.
    if (!isConsoleToolsProcessError(err)) throw err;
    // A lock-race kill (see oracle.ts's `withConsoleToolsLock` doc comment: the accepted residual
    // race's failure mode is exactly "two ConsoleTools processes running concurrently -> a loud
    // non-zero exit -> a spurious red a re-run clears") carries NO stdout/stderr — it is not
    // ConsoleTools reporting a reason, just an abrupt kill. A GENUINE ConsoleTools failure
    // (Program.cs:94-138's generic -1) always prints something describing what went wrong (see the
    // Milktruck "CMP Format Changed" stack trace this same cache stores). Persisting a marker built
    // from an EMPTY capture would misfile a transient race as a permanent, content-addressed
    // "TexTools cannot resave this pack" verdict that is never retried — exactly the failure mode
    // this finding exists to close. So: refuse to cache when stdout+stderr are BOTH empty and
    // propagate instead, exactly like a harness bug (see the `isConsoleToolsProcessError` branch
    // above) — the run goes red once, and a re-run (this being a race) is expected to clear it.
    if (processOutputText(err).trim().length === 0) throw err;
    const message = describeProduceError(err);
    mkdirSync(dir, { recursive: true });
    writeFileSync(errPath, message);
    return { kind: "error", message };
  }
}
