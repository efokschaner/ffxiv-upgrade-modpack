import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

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
  const tmpPath = join(dir, `${key}.bin.tmp`);
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, finalPath);
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
