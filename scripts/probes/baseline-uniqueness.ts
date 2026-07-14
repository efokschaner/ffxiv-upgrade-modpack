/**
 * CORPUS VALUE ANALYSIS, SECOND AXIS — "which known divergences does this pack UNIQUELY pin?"
 *
 * WHEN TO USE THIS
 * Alongside `corpus-fingerprint.ts`, before pruning the corpus. The fingerprint scores a pack by
 * the input features it CARRIES; this scores it by the known divergences it RECORDS. A pack can be
 * unremarkable on inputs and still be the last thing guarding a known bug.
 *
 * WHY IT MATTERS
 * Each pack's ratchet baseline (`.upgrade-baseline/` + `.resave-baseline/`, keyed by
 * sha256(input pack)) is the list of divergences we currently tolerate. The suite fails only on a
 * REGRESSION past that list — so if a pack is the sole recorder of some divergence class, deleting
 * it silently removes the guard that would catch that bug coming back. Coverage cannot see this at
 * all: the lines are covered either way.
 *
 * METHODOLOGY — AND THE TRAP
 * The signature must describe the DEFECT, not the pack. Get it wrong and the answer INVERTS. A
 * first cut that kept the raw `gamePath` reported the biggest PMP as the sole pinner of 21
 * divergences and therefore "must keep" — but every one of them was
 * `group_<N>_<GROUP NAME>.json#/Options/<i>/Image`, unique only because that pack's group happens
 * to be named "cute heels". The defect is the FIELD (`/Options/#/Image`, the unported
 * `WizardHelpers.WriteImage` re-encode), which many packs share. Normalizing the pack-specific
 * tokens out (see `signature`) collapsed it from 21 to 0.
 *
 * So: treat every "unique" hit here as guilty until proven innocent — read the signature and ask
 * whether it names a DEFECT CLASS or merely echoes the pack's own group/option/file names.
 *
 * Investigation tool — not part of the test gate.
 * Run: npx tsx scripts/probes/baseline-uniqueness.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
(globalThis as Record<string, unknown>).__dirname = join(
  here,
  "..",
  "..",
  "test",
  "helpers",
);
const { corpusPacks } = await import("../../test/helpers/corpus-roots");

const CORPUS = join(here, "..", "..", "test", "corpus");
const DIRS = [
  ["upgrade", join(CORPUS, ".upgrade-baseline")],
  ["resave", join(CORPUS, ".resave-baseline")],
] as const;

interface FileDiff {
  kind: string;
  gamePath: string;
  status: string;
  detail?: string;
}

/** Collapse a diff to a signature that is about the DEFECT, not the pack it happened to appear in.
 *
 * For a `manifest`/`structure` diff the gamePath is a JSON pointer whose FIELD NAME is the defect
 * ("…/OptionList/0/IsChecked") — so we keep the pointer but normalize its indices to `#`, rather
 * than dropping it (which would erase the only signal) or keeping it verbatim (which would make
 * every pack trivially unique via its own group/option counts).
 *
 * For a `payload` diff the gamePath is a pack-specific game path, so only its extension carries
 * cross-pack meaning. A numeric detail is bucketed to its shape either way. */
function signature(harness: string, d: FileDiff): string {
  let where: string;
  if (d.kind === "manifest") {
    // "group_1_cute heels.json#/Options/0/Image" -> "group_#.json#/Options/#/Image".
    // The group NAME in the member filename is pack-specific by construction; leaving it in makes
    // every pack trivially the "sole carrier" of its own group names. The defect is the FIELD.
    const [member = "", ptr = ""] = d.gamePath.split("#");
    const m = member
      .replace(/^group_\d+.*\.json$/i, "group_#.json")
      .replace(/\d+/g, "#");
    where = `${m}#${ptr.replace(/\/\d+/g, "/#")}`;
  } else {
    // payload/structure gamePaths are pack-specific content paths (incl. the content-deduped
    // common/N members) — only the extension carries cross-pack meaning.
    where = d.gamePath.slice(d.gamePath.lastIndexOf(".")) || "-";
  }
  const detail = (d.detail ?? "")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, 70);
  return `${harness}|${d.kind}|${where}|${d.status}|${detail}`;
}

const packs = corpusPacks().filter((p) => p.includes("real"));
const sigsOf = new Map<string, Set<string>>();
const sizeOf = new Map<string, number>();

for (const p of packs) {
  const name = basename(p);
  sizeOf.set(name, statSync(p).size);
  const key = createHash("sha256").update(readFileSync(p)).digest("hex");
  const sigs = new Set<string>();
  for (const [harness, dir] of DIRS) {
    const f = join(dir, `${key}.json`);
    if (!existsSync(f)) continue;
    const diffs: FileDiff[] = JSON.parse(readFileSync(f, "utf8"));
    for (const d of diffs) sigs.add(signature(harness, d));
  }
  sigsOf.set(name, sigs);
}

const carriers = new Map<string, string[]>();
for (const [name, sigs] of sigsOf) {
  for (const s of sigs) {
    const l = carriers.get(s) ?? [];
    l.push(name);
    carriers.set(s, l);
  }
}

const rows = [...sigsOf]
  .map(([name, sigs]) => ({
    name,
    mb: (sizeOf.get(name) ?? 0) / 1e6,
    n: sigs.size,
    unique: [...sigs].filter((s) => carriers.get(s)!.length === 1),
  }))
  .sort((a, b) => b.mb - a.mb);

console.log(
  `\n${"pack".padEnd(50)} ${"MB".padStart(6)} ${"sigs".padStart(5)} ${"UNIQ".padStart(4)}  uniquely-pinned divergence`,
);
for (const r of rows.slice(0, 25)) {
  console.log(
    `${r.name.slice(0, 50).padEnd(50)} ${r.mb.toFixed(1).padStart(6)} ${String(r.n).padStart(5)} ${String(r.unique.length).padStart(4)}  ${r.unique[0] ?? "—"}`,
  );
}
console.log(`\n=== packs (>=20MB) pinning NO unique divergence ===`);
for (const r of rows.filter((r) => r.mb >= 20 && r.unique.length === 0)) {
  console.log(`  ${r.name.padEnd(50)} ${r.mb.toFixed(1).padStart(6)} MB`);
}
console.log("");
