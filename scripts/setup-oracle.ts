// Provisions a pinned TexTools ConsoleTools install as the /upgrade + /resave oracle.
//
//   npm run setup-oracle                     -- install the pinned tag
//   npm run setup-oracle -- v3.1.1.4         -- install a specific tag
//   npm run setup-oracle -- v3.1.1.4 --xiv-path "C:\...\sqpack\ffxiv"
//
// Writes ONLY under reference/oracle/<tag>/. reference/ is gitignored wholesale (.gitignore:5),
// so nothing here can be committed. See
// docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md §5.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { consoleConfigJson, withTraceListener } from "./lib/oracle-config";
import { ORACLE_RELEASES, PINNED_ORACLE_TAG } from "./lib/oracle-releases";

/** Must match test/helpers/oracle.ts's UPGRADE_TRACE_LOG exactly — that module builds it from
 *  homedir() and substring-matches it against the config we write here. */
const UPGRADE_TRACE_LOG = join(homedir(), ".ffxiv-consoletools-trace.log");

// __dirname isn't defined here: this file runs as a plain `tsx` ESM script (no Vite SSR
// runner to inject the CJS global, unlike test/helpers/oracle.ts), so derive it from
// import.meta.url the same way scripts/run-tests.ts and the generate-synthetics builders do.
const here = dirname(fileURLToPath(import.meta.url));
const ORACLE_ROOT = join(here, "..", "reference", "oracle");

function parseArgs(argv: string[]): { tag: string; xivPath?: string } {
  const rest = argv.slice(2);
  const i = rest.indexOf("--xiv-path");
  const xivPath = i >= 0 ? rest[i + 1] : undefined;
  const tag = rest.find((a) => !a.startsWith("--") && a !== xivPath);
  return { tag: tag ?? PINNED_ORACLE_TAG, xivPath };
}

/** Reuse the XivPath from any sibling install rather than making the operator retype it. */
function discoverXivPath(): string | undefined {
  if (!existsSync(ORACLE_ROOT)) return undefined;
  for (const d of readdirSync(ORACLE_ROOT)) {
    const p = join(ORACLE_ROOT, d, "console_config.json");
    if (!existsSync(p)) continue;
    try {
      const cfg = JSON.parse(readFileSync(p, "utf8")) as { XivPath?: string };
      if (cfg.XivPath) return cfg.XivPath;
    } catch {
      // Unreadable sibling config — keep looking.
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const { tag, xivPath: xivArg } = parseArgs(process.argv);
  const release = ORACLE_RELEASES[tag];
  if (!release) {
    throw new Error(
      `setup-oracle: unknown tag "${tag}". Known: ${Object.keys(ORACLE_RELEASES).join(", ")}. ` +
        `Add it to scripts/lib/oracle-releases.ts with a verified sha256 first.`,
    );
  }

  const xivPath = xivArg ?? discoverXivPath();
  if (!xivPath) {
    throw new Error(
      'setup-oracle: no XivPath. Pass --xiv-path "<game>\\game\\sqpack\\ffxiv" ' +
        "(no sibling install to copy it from).",
    );
  }

  const dest = join(ORACLE_ROOT, tag);
  if (existsSync(dest)) {
    throw new Error(
      `setup-oracle: ${dest} already exists. Remove it first to reinstall.`,
    );
  }

  console.log(`Downloading ${release.asset} …`);
  const res = await fetch(release.url);
  if (!res.ok) {
    throw new Error(
      `setup-oracle: download failed: ${res.status} ${res.statusText}`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  if (bytes.length !== release.size) {
    throw new Error(
      `setup-oracle: size mismatch for ${release.asset}: got ${bytes.length}, expected ${release.size}`,
    );
  }
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== release.sha256) {
    throw new Error(
      `setup-oracle: sha256 mismatch for ${release.asset}:\n  got      ${got}\n  expected ${release.sha256}`,
    );
  }
  console.log(`Verified sha256 ${got}`);

  // Extract. Node has no zip reader, and the repo's only zip dependency (fflate) is a src/ dep;
  // Expand-Archive is already available on this platform and avoids adding a devDependency.
  mkdirSync(ORACLE_ROOT, { recursive: true });
  const tmpZip = join(ORACLE_ROOT, `${tag}.download.zip`);
  writeFileSync(tmpZip, bytes);
  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${dest}' -Force`,
      ],
      { stdio: "inherit" },
    );
  } finally {
    rmSync(tmpZip, { force: true });
  }

  const exe = join(dest, "ConsoleTools.exe");
  if (!existsSync(exe)) {
    throw new Error(
      `setup-oracle: ${release.asset} contained no ConsoleTools.exe`,
    );
  }

  const cfgPath = `${exe}.config`;
  writeFileSync(
    cfgPath,
    withTraceListener(readFileSync(cfgPath, "utf8"), UPGRADE_TRACE_LOG),
  );
  writeFileSync(join(dest, "console_config.json"), consoleConfigJson(xivPath));

  console.log(`Installed ${tag} to ${dest}`);
  console.log(`  trace log : ${UPGRADE_TRACE_LOG}`);
  console.log(`  XivPath   : ${xivPath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
