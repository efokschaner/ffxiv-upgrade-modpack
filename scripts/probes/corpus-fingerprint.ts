/**
 * CORPUS VALUE ANALYSIS — "is this pack worth its runtime?"
 *
 * WHEN TO USE THIS
 * Before pruning the corpus (a few big packs dominate the suite's wall clock), and before assuming
 * a newly added pack pulls its weight. Pair it with `baseline-uniqueness.ts` (which asks the same
 * question of the ratchet baselines) and with an A/B `npm run test:coverage`.
 *
 * WHY NOT JUST USE SIZE, OR COVERAGE?
 * Both mislead, in opposite directions:
 *
 *  - SIZE says cut the biggest packs. But when this was first run, the sole carriers of unique
 *    features were mostly TINY (Milktruck, 0.03 MB, is the only `.rgsp` in the corpus), while the
 *    two biggest packs carried nothing unique at all. Size is uncorrelated with value.
 *
 *  - LINE COVERAGE of today's `src` says cut anything that adds no covered lines. But this port is
 *    UNFINISHED and deliberately THROWS on structures it has not reproduced yet (AGENTS.md, "fail
 *    loud"). A pack carrying an exotic structure therefore lights up almost NO lines today while
 *    being the only input that will exercise code we have not written. docs/BACKLOG.md names the
 *    trap outright: T3's ImageSharp resampler is driven by `Misty_Hairstyle_Female`, and the
 *    Partials round (hair/eye/skin) has NO corpus coverage yet. A coverage-led cull would delete
 *    exactly the packs the next round needs.
 *
 * WHAT THIS DOES INSTEAD
 * Fingerprints each pack by the INPUT FEATURES it carries — tex formats, NPOT dimensions, mdl
 * versions, shader packs + keys, manipulation kinds, container quirks, and the asset categories the
 * unported rounds will need — then reports which features each pack is the SOLE CARRIER of. Feature
 * names are tagged with the BACKLOG item they feed, so a future reader can see what a cut costs.
 *
 * HOW TO READ THE OUTPUT
 * A pack is a safe cut only if its feature set is a SUBSET of the union of the others (UNIQUE = 0).
 * That is NECESSARY, NOT SUFFICIENT: this is a byte-parity harness, so two packs can carry the same
 * features and still differ in payload DATA, with only one tripping a divergence. Treat UNIQUE = 0
 * as "no known reason to keep it", confirm with baseline-uniqueness + a coverage A/B, and keep in
 * mind all three are proxies for "would this pack ever catch something the others miss".
 *
 * A parse THROW is recorded as a feature, not an error: it means the pack carries a structure the
 * port does not yet reproduce — precisely the input a future round needs. Never a reason to cut.
 *
 * Investigation tool — not part of the test gate.
 * Run: npx tsx scripts/probes/corpus-fingerprint.ts
 */
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allFiles,
  decodeSqPackFile,
  FileStorageType,
  loadModpack,
  type ModpackData,
  parseMdl,
  parseMtrl,
  parseTex,
  SqPackType,
} from "../../src/index";
import { isEmptySampler } from "../../src/mtrl/types";

const here = dirname(fileURLToPath(import.meta.url));
(globalThis as Record<string, unknown>).__dirname = join(
  here,
  "..",
  "..",
  "test",
  "helpers",
);
const { corpusPacks } = await import("../../test/helpers/corpus-roots");

const isPow2 = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

/** Asset categories the unported rounds will need (BACKLOG: Partials round, NonSet IMC). */
function pathCategories(p: string): string[] {
  const out: string[] = [];
  const l = p.toLowerCase();
  if (/\/hair\/|_hir_|hair/.test(l)) out.push("path:hair"); // partials: UpdateUnclaimedHairTextures
  if (/_iri_|_etc_|iris|eye/.test(l)) out.push("path:eye"); // partials: UpdateEyeMask
  if (/_bibo|_skin|body|_top_|human/.test(l)) out.push("path:skin"); // partials: UpdateSkinPaths
  if (l.includes("weapon")) out.push("path:weapon"); // NonSet IMC
  if (l.includes("monster")) out.push("path:monster"); // NonSet IMC
  if (l.includes("demihuman")) out.push("path:demihuman"); // NonSet IMC
  return out;
}

function fingerprint(name: string, data: ModpackData): Set<string> {
  const f = new Set<string>();
  f.add(`format:${data.sourceFormat}`);
  f.add(`pack:${data.isSimple ? "simple" : "wizard"}`);
  if (data.extraFiles?.size) f.add("pmp:extraFiles");
  if (data.meta.description) f.add("meta:description");

  for (const g of data.groups) {
    f.add(`group:${g.selectionType}`);
    if (g.image) f.add("group:image");
    if (g.page > 0) f.add("group:multipage");
    for (const o of g.options) {
      if (o.image) f.add("option:image"); // BACKLOG: WriteImage re-encode unported
      if (Object.keys(o.fileSwaps).length) f.add("pmp:fileSwaps"); // BACKLOG: FileSwap handling
      for (const m of o.manipulations) {
        const kind = (m as { Type?: string })?.Type;
        if (kind) f.add(`manip:${kind}`);
      }
    }
  }

  for (const file of allFiles(data)) {
    const gp = file.gamePath.toLowerCase();
    for (const c of pathCategories(gp)) f.add(c);
    const ext = gp.slice(gp.lastIndexOf("."));
    f.add(`ext:${ext}`);
    if (!file.data) {
      f.add("pmp:absentFile");
      continue;
    }
    if (file.storage !== FileStorageType.SqPackCompressed) continue;

    let decoded: { type: number; data: Uint8Array };
    try {
      decoded = decodeSqPackFile(file.data);
    } catch {
      f.add("sqpack:undecodable-legacy"); // the tolerated block-spacing quirk
      continue;
    }
    f.add(`sqpack:type${decoded.type}`);

    try {
      if (decoded.type === SqPackType.Texture) {
        const t = parseTex(decoded.data, file.gamePath);
        f.add(`tex:format:0x${t.format.toString(16)}`);
        // BACKLOG T2/T3: the NPOT resize needs the ImageSharp resampler.
        if (!isPow2(t.width) || !isPow2(t.height)) f.add("tex:npot");
        if (t.arraySize > 1) f.add("tex:array");
        if (t.depth > 1) f.add("tex:volume");
        if (t.mipCount === 1) f.add("tex:single-mip");
      } else if (decoded.type === SqPackType.Model) {
        const m = parseMdl(decoded.data, file.gamePath);
        f.add(`mdl:v${m.header.version}`);
        if (m.modelData.boneSetCount > 0) f.add("mdl:boneSets");
        if (m.sections.trailing.length > 0) f.add("mdl:trailingBytes");
        if (m.header.lodCount > 1) f.add("mdl:multiLod");
      } else if (decoded.type === SqPackType.Standard && gp.endsWith(".mtrl")) {
        const mt = parseMtrl(decoded.data, file.gamePath);
        f.add(`mtrl:shpk:${mt.shaderPackRaw}`);
        for (const k of mt.shaderKeys)
          f.add(`mtrl:key:0x${k.keyId.toString(16)}=${k.value}`);
        // BACKLOG M1/M2: empty-sampler placeholder serialization throws today.
        if (mt.textures.some(isEmptySampler)) f.add("mtrl:emptySampler");
        if (mt.colorSetDyeData.length > 0)
          f.add(`mtrl:dye:${mt.colorSetDyeData.length}`);
        if (mt.colorSetData.length > 0) f.add("mtrl:colorset");
      }
    } catch (err) {
      // A parse throw IS a feature: it means this pack carries a structure the port does not yet
      // reproduce — exactly the input a future round will need. Never a reason to drop the pack.
      f.add(`parse-throw:${(err as Error).message.slice(0, 60)}`);
    }
  }
  void name;
  return f;
}

const packs = corpusPacks().filter((p) => p.includes("real"));
console.log(`\nFingerprinting ${packs.length} real corpus packs...\n`);

const prints = new Map<string, { size: number; feats: Set<string> }>();
for (const p of packs) {
  const name = basename(p);
  const size = statSync(p).size;
  try {
    const data = loadModpack(name, new Uint8Array(readFileSync(p)));
    prints.set(name, { size, feats: fingerprint(name, data) });
  } catch (err) {
    console.log(`  !! ${name}: LOAD THREW — ${(err as Error).message}`);
    prints.set(name, { size, feats: new Set(["load-throw"]) });
  }
}

// How many packs carry each feature?
const carriers = new Map<string, string[]>();
for (const [name, { feats }] of prints) {
  for (const feat of feats) {
    const list = carriers.get(feat) ?? [];
    list.push(name);
    carriers.set(feat, list);
  }
}

const rows = [...prints]
  .map(([name, { size, feats }]) => {
    const unique = [...feats].filter((f) => carriers.get(f)!.length === 1);
    return { name, mb: size / 1e6, nFeat: feats.size, unique };
  })
  .sort((a, b) => b.mb - a.mb);

console.log(
  `${"pack".padEnd(52)} ${"MB".padStart(6)} ${"feats".padStart(5)} ${"UNIQUE".padStart(6)}  sole-carrier of`,
);
for (const r of rows) {
  const u = r.unique.length ? r.unique.slice(0, 4).join(", ") : "—";
  console.log(
    `${r.name.slice(0, 52).padEnd(52)} ${r.mb.toFixed(1).padStart(6)} ${String(r.nFeat).padStart(5)} ${String(r.unique.length).padStart(6)}  ${u}${r.unique.length > 4 ? ` (+${r.unique.length - 4})` : ""}`,
  );
}

console.log("\n=== SAFE-CUT CANDIDATES (large, zero unique features) ===");
const cuts = rows.filter((r) => r.unique.length === 0 && r.mb >= 20);
if (!cuts.length) console.log("  (none)");
let saved = 0;
for (const r of cuts) {
  console.log(`  ${r.name.padEnd(52)} ${r.mb.toFixed(1).padStart(6)} MB`);
  saved += r.mb;
}
console.log(`\n  total reclaimable: ${saved.toFixed(0)} MB`);
console.log(
  `  (every feature these carry is also carried by at least one other pack)\n`,
);
