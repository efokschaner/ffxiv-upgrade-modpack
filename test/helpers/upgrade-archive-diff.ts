import { readZip } from "../../src/zip/zip";
import type { FileDiff } from "./upgrade-diff";

const dec = new TextDecoder();

// A manifest member is a JSON document we compare semantically; everything else (game-file
// payloads, the TTMP .mpd blob) is compared by the payload byte-diff (diffUpgrade), not here.
function isManifest(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "meta.json" ||
    n === "default_mod.json" ||
    /^group_\d+.*\.json$/.test(n) ||
    n.endsWith(".mpl")
  );
}

function manifestNames(members: Map<string, Uint8Array>): string[] {
  return [...members.keys()].filter(isManifest);
}

/** Strip blob-layout artifacts before deep-equal. ModOffset/ModSize in a TTMPL.mpl are byproducts
 * of .mpd packing (our buildBlob dedup vs .NET's layout, src/container/ttmp2.ts:121); the bytes
 * they address are validated by the payload diff. See parity design spec §3. */
function normalize(name: string, json: unknown): unknown {
  if (!name.toLowerCase().endsWith(".mpl")) return json;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === "ModOffset" || k === "ModSize") continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  return strip(json);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

function parse(name: string, bytes: Uint8Array): unknown {
  return normalize(name, JSON.parse(dec.decode(bytes)));
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Deliberately NOT the reader's `windowsPathKey` (src/container/pmp.ts). A shared key function
 *  would make this confirmation agree with any regression IN the reader: a lost case-fold or
 *  trailing-dot strip would make the reader mark a resolvable file absent, the writer drop it, and
 *  this rule bless the drop — the corpus would go green while silently losing a file. This key is
 *  looser than any plausible resolution rule (it strips every '.'/' ', not just a trailing run per
 *  path segment), so it can only ever confirm FEWER drops than the reader made: it fails closed. A
 *  genuinely never-packed payload matches nothing under any spelling, so the intended confirmations
 *  are unaffected. */
function looseKey(path: string): string {
  return path.toLowerCase().replace(/[. ]/g, "");
}

/** The set of member names an archive actually contains, keyed by `looseKey` above — deliberately
 *  NOT the way the PMP reader resolves a `Files` value. */
export function memberKeys(members: Map<string, Uint8Array>): Set<string> {
  return new Set([...members.keys()].map((n) => looseKey(n)));
}

function safeParseJson(bytes: Uint8Array | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(dec.decode(bytes));
  } catch {
    return undefined;
  }
}

/** Every zip path a golden archive's OWN manifests point at: each option's `Files` values
 *  (gamePath -> zip path) and every `Image` field (meta/group/option each carry one, mirroring the
 *  fields `GetHeaderImage` walks — PMP.cs:1341-1364). Normalized under `looseKey` so it can be
 *  compared against payload member names the same way the drop confirmation below does. */
function referencedZipPaths(members: Map<string, Uint8Array>): Set<string> {
  const refs = new Set<string>();
  const addImage = (v: unknown): void => {
    if (typeof v === "string" && v.length > 0)
      refs.add(looseKey(v.replace(/\\/g, "/")));
  };
  const addFiles = (v: unknown): void => {
    if (!isObj(v)) return;
    for (const value of Object.values(v))
      if (typeof value === "string")
        refs.add(looseKey(value.replace(/\\/g, "/")));
  };
  const scanOption = (o: unknown): void => {
    if (!isObj(o)) return;
    addFiles(o.Files);
    addImage(o.Image);
  };
  const meta = safeParseJson(members.get("meta.json"));
  if (isObj(meta)) addImage(meta.Image);
  scanOption(safeParseJson(members.get("default_mod.json")));
  for (const [name, bytes] of members) {
    if (!/^group_\d+.*\.json$/i.test(name.toLowerCase())) continue;
    const g = safeParseJson(bytes);
    if (!isObj(g)) continue;
    addImage(g.Image);
    if (Array.isArray(g.Options)) for (const o of g.Options) scanOption(o);
  }
  return refs;
}

/** True when the golden archive contains a payload member (a zip entry that is not a manifest —
 *  meta.json / default_mod.json / group_*.json / *.mpl) that no manifest in the SAME archive
 *  references, under `looseKey`, by a `Files` value or an `Image` field. Mirrors `LoadPMP`'s own
 *  `ExtraFiles` computation (PMP.cs:213-215): TexTools itself treats an unreferenced-but-present
 *  member as legitimate on its own (a readme, a preview image, ...) — its mere existence is not a
 *  bug. But it IS the fingerprint the drop confirmation below needs: it means name resolution over
 *  this archive's members failed to connect at least one reference to a member that genuinely
 *  exists — for whatever reason, which could be a stray asset OR a decode bug (e.g. fflate falling
 *  back to latin1 for a zip entry whose UTF-8 general-purpose-flag bit is unset, so a non-ASCII
 *  member's decoded name differs from the correctly-UTF8-decoded manifest value that names it). We
 *  cannot tell those two causes apart from here, so an archive with ANY orphan disables the
 *  confirmation entirely rather than risk confirming a drop that is actually a silently-lost
 *  payload. See IMPORTANT 1 in the PR review this responds to. */
// `dropConfirmedAbsentKeys` runs once per manifest member in an archive (diffArchives calls it
// unconditionally per member; corpus-pmp.ts calls it once per fixed/group file too), and every call
// for the SAME archive would otherwise re-parse every group JSON to recompute the same answer.
// Cached per member-map identity (the same `Map` instance is passed on every call within one
// diff/round-trip check), not per archive content — irrelevant here since each check constructs its
// map fresh from one `readZip` call.
const orphanCache = new WeakMap<Map<string, Uint8Array>, boolean>();
function hasOrphanPayloadMember(members: Map<string, Uint8Array>): boolean {
  const cached = orphanCache.get(members);
  if (cached !== undefined) return cached;
  const refs = referencedZipPaths(members);
  let result = false;
  for (const name of members.keys()) {
    if (isManifest(name)) continue;
    if (!refs.has(looseKey(name))) {
      result = true;
      break;
    }
  }
  orphanCache.set(members, result);
  return result;
}

/** CONFIRMATION (not a tolerance) of the ONE manifest difference we intend: TexTools' writer drops
 *  a file whose payload does not exist from both the zip and the option's `Files` map
 *  (PopulatePmpStandardOption, PMP.cs:883-888), and our writer now does too. On a NO-OP upgrade
 *  ConsoleTools writes nothing, so the harness's reference is the INPUT pack — which still carries
 *  the dangling key. So: a `Files` key missing from OURS is allowed iff the golden's value for it
 *  names a zip path that does not resolve as a member of the GOLDEN's own archive, AND the golden
 *  archive has no orphan payload member (`hasOrphanPayloadMember` above).
 *
 *  Deliberately tight, in the spirit of DivergenceRule.confirm (upgrade-compare.ts):
 *   - resolution uses `looseKey`, NOT the reader's own `windowsPathKey` — see `looseKey`'s doc
 *     comment for why sharing the reader's function would be unsafe. `looseKey` is looser than
 *     `windowsPathKey`, so a merely case-mismatched or trailing-dotted key still RESOLVES and is
 *     NOT covered — the two normalization fixes stay under test, and independently so: a future
 *     regression in `windowsPathKey` cannot silently agree with this rule, because this rule never
 *     calls it. **This is the actual guarantee** ("fails closed against a `windowsPathKey`
 *     regression"), not a blanket one: `looseKey` still runs over the SAME `readZip` member names
 *     the reader itself resolves against (`src/zip/zip.ts`), so a decode bug in that shared step
 *     (not in `windowsPathKey`) is a residual this rule alone would not catch — which is exactly why
 *     the orphan guard exists, to close the concrete instance of that residual this review found.
 *     A narrower residual remains even with the orphan guard: a decode bug that corrupts a payload
 *     member's name AND happens to leave every manifest reference still resolvable (no orphan
 *     produced) would still evade detection. `readZip` itself is exercised directly elsewhere
 *     (`pmp-read.test.ts`), which is the backstop for that narrower case;
 *   - only a key MISSING from ours is covered; a changed value is still a mismatch;
 *   - every other field is still deep-equal'd.
 *  It is inert whenever ConsoleTools actually wrote the golden: TexTools dropped the key there too,
 *  so both sides agree and this never runs. See the absent-file design spec §4.1. This applies
 *  identically to both shapes below — a `group_NNN.json`'s `Options` array (paired by index) and a
 *  `default_mod.json` (the document IS the single option) — both funnel through `option()` below.
 *
 *  Also reused, with the roles relabeled, by corpus-pmp.ts's manifest round-trip check: there
 *  `golden` is the original on-disk JSON and `ours` the re-emitted one, and `goldenMembers` is the
 *  original archive's own member map — same rule, same tightness, one definition. */
export function dropConfirmedAbsentKeys(
  ours: unknown,
  golden: unknown,
  goldenMembers: Map<string, Uint8Array>,
): unknown {
  const present = memberKeys(goldenMembers);
  const hasOrphan = hasOrphanPayloadMember(goldenMembers);
  const confirmedFiles = (
    oursFiles: unknown,
    goldenFiles: Record<string, unknown>,
  ): Record<string, unknown> => {
    const o = (oursFiles ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [gamePath, value] of Object.entries(goldenFiles)) {
      const missingFromOurs = !Object.hasOwn(o, gamePath);
      const isStringValue = typeof value === "string";
      const zipPath = isStringValue ? value.replace(/\\/g, "/") : "";
      const absent = isStringValue && !present.has(looseKey(zipPath));
      if (missingFromOurs && absent && !hasOrphan) continue; // the PMP.cs:883 drop — confirmed
      out[gamePath] = value;
    }
    return out;
  };

  const option = (oursOpt: unknown, goldenOpt: unknown): unknown => {
    if (!isObj(goldenOpt) || !isObj(oursOpt) || !isObj(goldenOpt.Files))
      return goldenOpt;
    return {
      ...goldenOpt,
      Files: confirmedFiles(oursOpt.Files, goldenOpt.Files),
    };
  };

  if (!isObj(golden) || !isObj(ours)) return golden;
  // group_NNN.json: prune inside each option, pairing by index (order is part of the compare).
  if (Array.isArray(golden.Options) && Array.isArray(ours.Options)) {
    const oursOptions = ours.Options as unknown[];
    return {
      ...golden,
      Options: golden.Options.map((g, i) => option(oursOptions[i], g)),
    };
  }
  // default_mod.json: the document IS the option.
  return option(ours, golden);
}

/** STRUCTURE (manifest member-name set) + MANIFEST (semantic deep-equal) diffs between two
 * un-archived modpacks. Payload content is diffed separately by diffUpgrade. Orientation matches
 * diffUpgrade: golden-only member => "added"; ours-only => "removed"; shared+unequal => "mismatch".
 * See docs/superpowers/specs/2026-07-08-modpack-serialization-parity-design.md §3. */
export function diffArchives(ours: Uint8Array, golden: Uint8Array): FileDiff[] {
  const om = readZip(ours);
  const gm = readZip(golden);
  const oNames = new Set(manifestNames(om));
  const gNames = new Set(manifestNames(gm));
  const diffs: FileDiff[] = [];

  for (const name of [...new Set([...oNames, ...gNames])].sort()) {
    const inO = oNames.has(name);
    const inG = gNames.has(name);
    if (inO && !inG) {
      diffs.push({
        kind: "structure",
        gamePath: name,
        index: 0,
        status: "removed",
        detail: undefined,
      });
    } else if (!inO && inG) {
      diffs.push({
        kind: "structure",
        gamePath: name,
        index: 0,
        status: "added",
        detail: undefined,
      });
    } else {
      const o = parse(name, om.get(name)!);
      const g = parse(name, gm.get(name)!);
      // The confirmation always runs; it is inert (returns `g` verbatim) whenever nothing in `g`
      // qualifies as a confirmed drop, so this reduces to a straight deep-equal in that case.
      if (!deepEqual(o, dropConfirmedAbsentKeys(o, g, gm))) {
        diffs.push({
          kind: "manifest",
          gamePath: name,
          index: 0,
          status: "mismatch",
          detail: undefined,
        });
      }
    }
  }
  return diffs;
}
