import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, renameSync, mkdtempSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

const CONSOLE_TOOLS = "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";
const CORPUS_INPUTS = join(__dirname, "..", "corpus", "inputs");
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
export function oracleCacheGet(key: string, dir: string = DEFAULT_ORACLE_CACHE): Uint8Array | null {
  const p = join(dir, `${key}.bin`);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
}

/** Store `data` under `key`, atomically (temp file + rename) so an interrupted run never
 * leaves a half-written cache entry that a later run would trust. */
export function oracleCachePut(key: string, data: Uint8Array, dir: string = DEFAULT_ORACLE_CACHE): void {
  mkdirSync(dir, { recursive: true });
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
  if (!existsSync(CORPUS_INPUTS)) return [];
  return readdirSync(CORPUS_INPUTS)
    .filter((f) => /\.(ttmp2?|pmp)$/i.test(f))
    .map((f) => join(CORPUS_INPUTS, f));
}

/**
 * Policy guard for corpus-dependent tests: they FAIL (not skip) when the local corpus is absent,
 * so a missing test/corpus/inputs is a loud red signal rather than a silently-green no-op. Call
 * inside a dedicated `it(...)` in each corpus test file. `what` labels the required inputs in the
 * error (e.g. ".pmp corpus inputs" for the PMP-only tests).
 */
export function assertCorpusPresent(inputs: string[], what: string = "corpus inputs"): void {
  if (inputs.length === 0) {
    throw new Error(
      `No ${what} in test/corpus/inputs — corpus-dependent tests require the local ` +
      `(gitignored, user-provided) corpus. Populate test/corpus/inputs to run these tests.`,
    );
  }
}

function run(args: string[]): void {
  // execFileSync throws on non-zero exit; ConsoleTools returns -1 on error (Program.cs:94-138).
  execFileSync(CONSOLE_TOOLS, args, { stdio: "pipe" });
}

export function resave(src: string, dest: string): void { run(["/resave", src, dest]); }
export function upgrade(src: string, dest: string): void { run(["/upgrade", src, dest]); }

/** Runs /upgrade into test/corpus/golden-upgrade/ and returns the golden path. */
export function generateUpgradeGolden(inputPath: string): string {
  mkdirSync(GOLDEN_UPGRADE, { recursive: true });
  const out = join(GOLDEN_UPGRADE, basename(inputPath).replace(/\.[^.]+$/, ".ttmp2"));
  upgrade(inputPath, out);
  return out;
}

/** Unwraps a sqpack-compressed blob to raw bytes (Types 2 & 3 only). Use a neutral matching extension (e.g. `.bin`) for both paths. */
export function unwrap(src: string, dest: string): void { run(["/unwrap", src, dest]); }
/** Wraps raw bytes back into a sqpack-compressed blob. `ffPath` is the FFXIV game path used to select the compression scheme. */
export function wrap(src: string, dest: string, ffPath: string): void {
  run(["/wrap", src, dest, ffPath, "/sqpack"]);
}
/** Extracts a file directly from the game by its game path. `dest` extension should match `gamePath` to get raw uncompressed output. */
export function extractGameFile(gamePath: string, dest: string): void {
  run(["/extract", gamePath, dest]);
}
/** ConsoleTools present (game-path resolution is validated lazily by extract calls). */
export function gameAvailable(): boolean { return oracleAvailable(); }

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
  opts: { dir?: string; available?: boolean; produce?: (entry: Uint8Array) => Uint8Array } = {},
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
