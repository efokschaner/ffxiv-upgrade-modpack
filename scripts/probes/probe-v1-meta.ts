// Probe (not wired into the suite; needs a local ConsoleTools install and the local corpus, and is
// slow): downgrade one equipment .meta in a real corpus pack to v1 (version=1, strip EST/GMP —
// segments v1 predates, ItemMetadata.cs version history), writeModpack it, run ConsoleTools
// /upgrade, and inspect what the golden does (v1->v2? EST/GMP default injection? or reject?).
//
// Backs the still-open docs/backlog/2026-07-11-v1-metadata-support.md — its whole purpose is to re-verify
// this probe's finding against a fresh ConsoleTools build if that work is ever picked up.
//
// Run: npx tsx scripts/probes/probe-v1-meta.ts
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModpack, writeModpack } from "../../src/index";
import { deserializeMeta } from "../../src/meta/deserialize";
import { serializeMeta } from "../../src/meta/serialize";
import {
  allFiles,
  FileStorageType,
  type ModpackFile,
} from "../../src/model/modpack";
import {
  decodeSqPackFile,
  encodeSqPackFile,
  SqPackType,
} from "../../src/sqpack/sqpack";

const CONSOLE =
  "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";
const REAL = "test\\corpus\\real";

function unc(f: { storage: FileStorageType; data?: Uint8Array }) {
  // TTMP2 corpus files always carry bytes (absent `data` is a PMP-only concept); fail loud rather
  // than silently mis-decoding if that assumption is ever wrong.
  if (!f.data) throw new Error("probe-v1-meta: file has no bytes");
  return f.storage === FileStorageType.SqPackCompressed
    ? decodeSqPackFile(f.data).data
    : f.data;
}
function metaSegs(b: Uint8Array) {
  const m = deserializeMeta(b);
  return `v${m.version} imc=${m.imc ? m.imc.length : "-"} eqp=${m.eqp ? m.eqp.length : "-"} eqdp=${m.eqdp ? m.eqdp.size : "-"} est=${m.est ? m.est.size : "-"} gmp=${m.gmp ? m.gmp.length : "-"}`;
}

// find a ttmp2 corpus pack with an equipment .meta that has EST (and ideally GMP)
const packs = readdirSync(REAL).filter((n) =>
  n.toLowerCase().endsWith(".ttmp2"),
);
let chosen: { pack: string; gamePath: string } | null = null;
for (const name of packs) {
  const bytes = new Uint8Array(readFileSync(join(REAL, name)));
  let d: ReturnType<typeof loadModpack>;
  try {
    d = loadModpack(name, bytes);
  } catch {
    continue;
  }
  for (const { gamePath, file } of allFiles(d)) {
    if (!/^chara\/equipment\/e\d+\/e\d+_\w+\.meta$/.test(gamePath)) continue;
    const m = deserializeMeta(unc(file));
    if (m.version === 2 && m.est && m.gmp) {
      chosen = { pack: name, gamePath };
      break;
    }
  }
  if (chosen) break;
}
if (!chosen) {
  // relax: any equipment meta with EST
  for (const name of packs) {
    const bytes = new Uint8Array(readFileSync(join(REAL, name)));
    let d: ReturnType<typeof loadModpack>;
    try {
      d = loadModpack(name, bytes);
    } catch {
      continue;
    }
    for (const { gamePath, file } of allFiles(d)) {
      if (!/^chara\/equipment\/e\d+\/e\d+_\w+\.meta$/.test(gamePath)) continue;
      const m = deserializeMeta(unc(file));
      if (m.version === 2 && m.est) {
        chosen = { pack: name, gamePath };
        break;
      }
    }
    if (chosen) break;
  }
}
if (!chosen) {
  console.log("no suitable equipment meta found in corpus");
  process.exit(0);
}
console.log(`chosen: ${chosen.pack} :: ${chosen.gamePath}`);

const bytes = new Uint8Array(readFileSync(join(REAL, chosen.pack)));
const model = loadModpack(chosen.pack, bytes);
// downgrade the chosen meta to v1: version=1, strip EST + GMP (v1 predates them)
let before = "";
for (const g of model.groups)
  for (const o of g.options) {
    const next = new Map<string, ModpackFile>();
    for (const [path, f] of o.files) {
      if (path !== chosen!.gamePath) {
        next.set(path, f);
        continue;
      }
      const orig = unc(f);
      before = metaSegs(orig);
      const m = deserializeMeta(orig);
      m.version = 1;
      m.est = null;
      m.gmp = null;
      const v1bytes = serializeMeta(m);
      const data =
        f.storage === FileStorageType.SqPackCompressed
          ? encodeSqPackFile(v1bytes, SqPackType.Standard)
          : v1bytes;
      next.set(path, { ...f, data });
    }
    o.files = next;
  }
console.log(`input meta (downgraded to v1): ${before}  ->  v1 form`);

const ttmp2 = writeModpack(model, "ttmp2");
const dir = mkdtempSync(join(tmpdir(), "v1probe-"));
const src = join(dir, "in.ttmp2"),
  dest = join(dir, "out.ttmp2");
writeFileSync(src, ttmp2);
rmSync(dest, { force: true });
try {
  execFileSync(CONSOLE, ["/upgrade", src, dest], { stdio: "pipe" });
  console.log("ConsoleTools /upgrade OK");
} catch (e) {
  console.log("ConsoleTools /upgrade FAILED (our writeModpack pack rejected):");
  console.log(
    String((e as { stderr?: Buffer }).stderr ?? (e as Error).message).slice(
      0,
      800,
    ),
  );
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
if (!existsSync(dest)) {
  console.log("no-op (no output) — /upgrade did not change the pack");
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
const golden = loadModpack("g.ttmp2", new Uint8Array(readFileSync(dest)));
for (const { gamePath, file } of allFiles(golden)) {
  if (gamePath !== chosen.gamePath) continue;
  console.log(`\nGOLDEN meta for ${gamePath}: ${metaSegs(unc(file))}`);
}
rmSync(dir, { recursive: true, force: true });
