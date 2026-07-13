import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { corpusPacks } from "./corpus-roots";

const CONSOLE_TOOLS =
  "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";
const GOLDEN_UPGRADE = join(__dirname, "..", "corpus", "golden-upgrade");

/** Content-addressed cache of ConsoleTools /unwrap outputs. Lives inside the gitignored
 * test/corpus/ tree (see .gitignore) so it is never committed. Keyed by sha256(entry). */
const DEFAULT_ORACLE_CACHE = join(__dirname, "..", "corpus", ".oracle-cache");

/** Lowercase hex sha256 of an entry blob. Same input ⇒ same key, so identical payloads
 * (common across multi-option packs) dedupe to one cache file and one ConsoleTools call. */
export function oracleKey(entry: Uint8Array): string {
  return createHash("sha256").update(entry).digest("hex");
}

/** Cached /unwrap output for `key`, or null on miss. */
export function oracleCacheGet(
  key: string,
  dir: string = DEFAULT_ORACLE_CACHE,
): Uint8Array | null {
  const p = join(dir, `${key}.bin`);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
}

// A crash between writeFileSync and the rename below leaves the unique-named .tmp behind, and (unlike
// the old fixed temp name) nothing overwrites it later. Reclaim such orphans by sweeping temps older
// than this window — far longer than any write→rename window, so a concurrent in-flight writer's temp
// (milliseconds old) is never touched. Swept once per cache dir per process (only cold runs write).
const TMP_STALE_MS = 60 * 60 * 1000; // 1 hour
const sweptTempDirs = new Set<string>();

function sweepStaleTemps(dir: string): void {
  const now = Date.now();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // dir vanished between mkdir and here — nothing to sweep
  }
  for (const f of entries) {
    if (!f.endsWith(".tmp")) continue;
    const p = join(dir, f);
    try {
      if (now - statSync(p).mtimeMs > TMP_STALE_MS) rmSync(p, { force: true });
    } catch {
      // Raced away by another sweeper/writer, or stat failed — best-effort cleanup, ignore.
    }
  }
}

/** Store `data` under `key`, atomically (temp file + rename) so an interrupted run never
 * leaves a half-written cache entry that a later run would trust. */
export function oracleCachePut(
  key: string,
  data: Uint8Array,
  dir: string = DEFAULT_ORACLE_CACHE,
): void {
  mkdirSync(dir, { recursive: true });
  if (!sweptTempDirs.has(dir)) {
    sweptTempDirs.add(dir);
    sweepStaleTemps(dir);
  }
  const finalPath = join(dir, `${key}.bin`);
  // Unique temp name per writer so concurrent shard workers writing the same key never race on a
  // shared temp path (each does its own write + atomic rename; last rename wins with identical bytes).
  const tmpPath = join(dir, `${key}.${randomUUID()}.tmp`);
  writeFileSync(tmpPath, data);
  try {
    renameSync(tmpPath, finalPath);
  } catch (err) {
    // Concurrent forks may write the SAME content-addressed key at once; on Windows a racing rename
    // can throw (EPERM/EBUSY/EEXIST) when another worker holds finalPath open or already replaced it.
    // The key is sha256(content), so an existing finalPath already holds the correct bytes — tolerate
    // it and drop our now-redundant temp. Anything else is a real error.
    if (existsSync(finalPath)) {
      rmSync(tmpPath, { force: true });
    } else {
      throw err;
    }
  }
}

export function oracleAvailable(): boolean {
  return existsSync(CONSOLE_TOOLS);
}

export function corpusInputs(): string[] {
  return corpusPacks();
}

/**
 * Policy guard for corpus-dependent tests: they FAIL (not skip) when the local corpus is absent,
 * so a missing test/corpus/real is a loud red signal rather than a silently-green no-op. Call
 * inside a dedicated `it(...)` in each corpus test file. `what` labels the required inputs in the
 * error (e.g. ".pmp corpus inputs" for the PMP-only tests).
 */
export function assertCorpusPresent(
  inputs: string[],
  what: string = "corpus inputs",
): void {
  if (inputs.length === 0) {
    throw new Error(
      `No ${what} in test/corpus/real — corpus-dependent tests require the local ` +
        `(gitignored, user-provided) corpus. Populate test/corpus/real to run these tests.`,
    );
  }
}

/** Cross-process mutex for ConsoleTools. The tool is not safe to run concurrently (shared
 *  config/lock/temp state — observed 2026-07-12: several cold /upgrade spawns fail together with
 *  exit -1, while the same inputs succeed one at a time). The corpus runner schedules units across
 *  Vitest's `forks` pool, so an in-process lock cannot help: the lock must be a filesystem object.
 *
 *  O_EXCL create is the acquire; unlink is the release. A holder that crashes leaves the file
 *  behind, so a lock older than `staleMs` is broken by force. Because breaking a stale lock is a
 *  guess (not a proof the old holder is dead — `staleMs` is an empirical bound, not a guarantee),
 *  each acquisition writes a random token into the lock file; release reads the file back and only
 *  unlinks if it still holds that same token — see the `finally` block below for exactly what that
 *  guarantees and the residual race it does NOT close (deliberately: closing it fully needs OS-level
 *  locking this harness does not justify).
 *  Sleeping is synchronous (Atomics.wait on a throwaway SharedArrayBuffer) because run() is
 *  execFileSync — there is no event loop to yield to. */
const LOCK_PATH = join(tmpdir(), "ffxiv-upgrade-modpack-consoletools.lock");
const LOCK_STALE_MS = 10 * 60 * 1000; // > the longest single ConsoleTools run we have seen
const LOCK_TIMEOUT_MS = 20 * 60 * 1000;
const LOCK_POLL_MS = 50;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withConsoleToolsLock<T>(
  body: () => T,
  opts: { lockPath?: string; staleMs?: number; timeoutMs?: number } = {},
): T {
  const lockPath = opts.lockPath ?? LOCK_PATH;
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  const timeoutMs = opts.timeoutMs ?? LOCK_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  let fd: number | null = null;

  for (;;) {
    try {
      fd = openSync(lockPath, "wx"); // O_CREAT | O_EXCL — atomic acquire
      writeFileSync(fd, token);
      break;
    } catch {
      if (fd !== null) {
        // openSync succeeded but writing our token failed (e.g. disk full) — don't leak the
        // fd; fall through and retry as if the acquire itself had failed.
        try {
          closeSync(fd);
        } catch {
          // best effort
        }
        fd = null;
        // The lock file we just created is empty (the token write never landed) with a
        // brand-new mtime, so the staleness check below won't break it for a full `staleMs`
        // — every process, including this one, would otherwise spin for up to `staleMs`
        // before anyone reclaims it. We just created it and own it outright, so clean up our
        // own mess immediately instead of waiting on the staleness path.
        try {
          unlinkSync(lockPath);
        } catch {
          // Best effort — if this fails, the normal staleness path still reclaims it, just
          // after the full staleMs wait.
        }
      }
      // Held by someone, or the file vanished mid-race (TOCTOU), or statSync failed for some
      // other transient reason (e.g. an AV sharing violation). Every path below reaches the
      // deadline check + sleepSync before looping back — a `continue` that skipped both would
      // busy-spin the CPU without ever timing out.
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > staleMs) {
          try {
            unlinkSync(lockPath);
          } catch {
            // Another waiter broke it first; either way the next acquire attempt decides.
          }
        }
      } catch {
        // statSync failed — vanished between open and stat, or some other transient error.
        // Can't determine staleness this iteration; fall through to the deadline/backoff below.
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for the ConsoleTools lock (${lockPath}). ` +
            `If no ConsoleTools is running, delete that file.`,
        );
      }
      sleepSync(LOCK_POLL_MS);
    }
  }

  try {
    return body();
  } finally {
    // Close and unlink are independent: one failing must not skip the other, or the fd/lock
    // file leaks until the next staleness break.
    try {
      closeSync(fd);
    } catch {
      // Already closed/broken — still attempt the unlink below.
    }
    try {
      // Release is read-then-unlink, not one atomic syscall. What the token guarantees:
      // release will not delete a lock that has already been broken and re-taken by another
      // waiter — EXCEPT in the narrow window between the readFileSync below and the
      // unlinkSync a few lines down. If a waiter breaks our lock as stale and re-creates it
      // with its own token inside that window, we still delete their fresh lock: the same
      // failure class the token was added to close, now needing a syscall-width race instead
      // of any staleness break at all.
      //
      // Accepted as a bounded, documented risk rather than eliminated:
      //  - Reaching the window at all requires OUR OWN ConsoleTools run to have already run
      //    past `staleMs` — i.e. we are already in crash-recovery territory, not steady state.
      //  - The worst case is two ConsoleTools processes running concurrently, whose observed
      //    failure mode is a loud non-zero exit (see the class doc comment above) that fails
      //    the test run — a spurious red a re-run clears, not silent corruption. The cache is
      //    content-addressed, so nothing wrong gets persisted either way.
      //  - Closing it for real needs OS-level locking (e.g. a Windows named mutex / flock),
      //    which this test harness does not justify building — no inode checks, no
      //    unique-per-holder filenames, no other machinery here.
      let owned = false;
      try {
        owned = readFileSync(lockPath, "utf8") === token;
      } catch {
        // Vanished already (e.g. broken as stale by another waiter) — nothing to unlink.
      }
      if (owned) unlinkSync(lockPath);
    } catch {
      // Best effort — if this fails, the file is left for the next staleness break.
    }
  }
}

function run(args: string[]): void {
  // execFileSync throws on non-zero exit; ConsoleTools returns -1 on error (Program.cs:94-138).
  // Serialized across processes: ConsoleTools is not concurrency-safe (see withConsoleToolsLock).
  withConsoleToolsLock(() => {
    execFileSync(CONSOLE_TOOLS, args, { stdio: "pipe" });
  });
}

export function resave(src: string, dest: string): void {
  run(["/resave", src, dest]);
}
export function upgrade(src: string, dest: string): void {
  run(["/upgrade", src, dest]);
}

/** Runs /upgrade into test/corpus/golden-upgrade/ and returns the golden path. */
export function generateUpgradeGolden(inputPath: string): string {
  mkdirSync(GOLDEN_UPGRADE, { recursive: true });
  const out = join(
    GOLDEN_UPGRADE,
    basename(inputPath).replace(/\.[^.]+$/, ".ttmp2"),
  );
  upgrade(inputPath, out);
  return out;
}

/** Unwraps a sqpack-compressed blob to raw bytes (Types 2 & 3 only). Use a neutral matching extension (e.g. `.bin`) for both paths. */
export function unwrap(src: string, dest: string): void {
  run(["/unwrap", src, dest]);
}
/** Wraps raw bytes back into a sqpack-compressed blob. `ffPath` is the FFXIV game path used to select the compression scheme. */
export function wrap(src: string, dest: string, ffPath: string): void {
  run(["/wrap", src, dest, ffPath, "/sqpack"]);
}
/** Extracts a file directly from the game by its game path. `dest` extension should match `gamePath` to get raw uncompressed output. */
export function extractGameFile(gamePath: string, dest: string): void {
  run(["/extract", gamePath, dest]);
}
/** ConsoleTools present (game-path resolution is validated lazily by extract calls). */
export function gameAvailable(): boolean {
  return oracleAvailable();
}

/** Per-process scratch dir for the /unwrap file dance. Each Vitest worker imports this module
 * separately, so each gets its own dir — no cross-worker collision. Created lazily. */
let ORACLE_TMP: string | null = null;
function oracleTmpDir(): string {
  if (ORACLE_TMP === null) ORACLE_TMP = mkdtempSync(join(tmpdir(), "oracle-"));
  return ORACLE_TMP;
}

/** Run the real ConsoleTools /unwrap on an in-memory entry, returning the raw bytes. */
function unwrapViaConsoleTools(entry: Uint8Array): Uint8Array {
  const dir = oracleTmpDir();
  const inPath = join(dir, "entry.bin");
  const outPath = join(dir, "unwrapped.bin");
  writeFileSync(inPath, entry);
  // Remove any prior output so a (hypothetical) ConsoleTools no-write surfaces as ENOENT on read
  // rather than silently caching the previous entry's bytes under this entry's key.
  rmSync(outPath, { force: true });
  unwrap(inPath, outPath);
  return new Uint8Array(readFileSync(outPath));
}

/**
 * Cached /unwrap: returns the decompressed bytes for `entry`, spawning ConsoleTools at most
 * once per distinct entry across all runs. Cache hits skip the process spawn entirely (~436ms
 * each). Returns null only when the entry is uncached AND no producer is available (no TexTools),
 * leaving it to the caller to decide how to handle an unverifiable sample (registerSqpackChecks
 * fails loudly per the fail-on-unavailable policy). `opts.available`/
 * `opts.produce` exist for unit testing.
 * DEFAULT_ORACLE_CACHE is written concurrently by parallel corpus shard workers; oracleCachePut is
 * concurrency-safe (content-addressed keys + unique per-writer temp name + atomic rename).
 */
export function unwrapCached(
  entry: Uint8Array,
  opts: {
    dir?: string;
    available?: boolean;
    produce?: (entry: Uint8Array) => Uint8Array;
  } = {},
): Uint8Array | null {
  const dir = opts.dir ?? DEFAULT_ORACLE_CACHE;
  const key = oracleKey(entry);
  const hit = oracleCacheGet(key, dir);
  if (hit !== null) return hit;
  const available = opts.available ?? oracleAvailable();
  if (!available) return null;
  const produce = opts.produce ?? unwrapViaConsoleTools;
  const out = produce(entry);
  oracleCachePut(key, out, dir);
  return out;
}
