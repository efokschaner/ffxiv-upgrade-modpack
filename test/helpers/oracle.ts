import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

const CONSOLE_TOOLS = "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";
const CORPUS_INPUTS = join(__dirname, "..", "corpus", "inputs");
const GOLDEN_UPGRADE = join(__dirname, "..", "corpus", "golden-upgrade");

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
