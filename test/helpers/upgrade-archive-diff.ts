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

/** CONFIRMATION (not a tolerance) of the ONE manifest difference we intend: TexTools' writer drops
 *  a file whose payload does not exist from both the zip and the option's `Files` map
 *  (PopulatePmpStandardOption, PMP.cs:883-888), and our writer now does too. On a NO-OP upgrade
 *  ConsoleTools writes nothing, so the harness's reference is the INPUT pack — which still carries
 *  the dangling key. So: a `Files` key missing from OURS is allowed iff the golden's value for it
 *  names a zip path that does not resolve as a member of the GOLDEN's own archive.
 *
 *  Deliberately tight, in the spirit of DivergenceRule.confirm (upgrade-compare.ts):
 *   - resolution uses `looseKey`, NOT the reader's own `windowsPathKey` — see `looseKey`'s doc
 *     comment for why sharing the reader's function would be unsafe. `looseKey` is looser than
 *     `windowsPathKey`, so a merely case-mismatched or trailing-dotted key still RESOLVES and is
 *     NOT covered — the two normalization fixes stay under test, and independently so: a future
 *     regression in `windowsPathKey` cannot silently agree with this rule, because this rule never
 *     calls it. **This is the actual guarantee** ("fails closed against a `windowsPathKey`
 *     regression"), not a blanket one: if we ever silently lost a member we shouldn't have — a
 *     decode bug in the shared `readZip` step, a bad `windowsPathKey`, a writer bug — that is no
 *     longer this rule's problem to catch: `diffArchives`' payload-member comparison (below) catches
 *     a lost member directly, by name, regardless of cause. That is what replaced the previous
 *     orphan-payload-member guard here (see git history / the design spec §4.1 for that episode);
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
      if (missingFromOurs && absent) continue; // the PMP.cs:883 drop — confirmed
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

/** Non-manifest ("payload") member names of an archive — the complement of `manifestNames`. */
function payloadNames(members: Map<string, Uint8Array>): string[] {
  return [...members.keys()].filter((n) => !isManifest(n));
}

/** Multiset-compare payload (non-manifest) member NAMES between our archive and the golden,
 *  bucketed by `looseKey` so a legitimate spelling difference (case, a stripped trailing dot) is
 *  not flagged — the same normalization `dropConfirmedAbsentKeys` uses to decide "does this zip path
 *  resolve to a member of this archive". This is what makes the orphan-payload-member guard that
 *  used to live here unnecessary: that guard existed because the drop confirmation above only ever
 *  looks at `Files` keys, so a member lost for any OTHER reason (a decode bug mangling a name, a
 *  writer bug dropping an `ExtraFile` no `Files`/`Image` field ever referenced — PMP.cs:213-215) was
 *  invisible to it. Comparing the member-name sets directly catches exactly that, per member, and
 *  regardless of cause — see the regression test in upgrade-archive-diff.test.ts pinning the
 *  "silently lost an unreferenced member" hole this replaces.
 *
 *  Reported as `structure` diffs, same as a missing/extra manifest member above. */
function diffPayloadMembers(
  ours: Map<string, Uint8Array>,
  golden: Map<string, Uint8Array>,
): FileDiff[] {
  const bucket = (names: string[]): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const n of names) {
      const list = m.get(looseKey(n)) ?? [];
      list.push(n);
      m.set(looseKey(n), list);
    }
    return m;
  };
  const ob = bucket(payloadNames(ours));
  const gb = bucket(payloadNames(golden));
  const diffs: FileDiff[] = [];
  for (const key of [...new Set([...ob.keys(), ...gb.keys()])].sort()) {
    const os = (ob.get(key) ?? []).slice().sort();
    const gs = (gb.get(key) ?? []).slice().sort();
    const n = Math.min(os.length, gs.length);
    // Extra golden members past the shared count are ones ours is missing; extra "ours" members
    // past the shared count are ones ours has that the golden doesn't. Orientation matches the
    // manifest-name diff above: golden-only => "added", ours-only => "removed".
    for (let i = n; i < gs.length; i++) {
      diffs.push({
        kind: "structure",
        gamePath: gs[i]!,
        index: 0,
        status: "added",
        detail: undefined,
      });
    }
    for (let i = n; i < os.length; i++) {
      diffs.push({
        kind: "structure",
        gamePath: os[i]!,
        index: 0,
        status: "removed",
        detail: undefined,
      });
    }
  }
  return diffs;
}

/** STRUCTURE (manifest member-name set) + MANIFEST (semantic deep-equal) diffs between two
 * un-archived modpacks. Payload content is diffed separately by diffUpgrade. Orientation matches
 * diffUpgrade: golden-only member => "added"; ours-only => "removed"; shared+unequal => "mismatch".
 * See docs/superpowers/specs/2026-07-08-modpack-serialization-parity-design.md §3.
 *
 * `checkPayloadMembers` additionally compares the *names* of non-manifest members (see
 * `diffPayloadMembers`). Callers should only pass `true` on a no-op upgrade: when ConsoleTools
 * actually wrote the golden it regenerates every payload member's name as
 * `<optionPrefix><gamePath>` (and lowercases extras) where our writer reuses the source pack's own
 * names — a real, pre-existing, and separately tracked divergence (BACKLOG.md: "`writePmp`
 * round-trips the source pack where TexTools *regenerates* it"). Turning this comparison on for a
 * real golden would light up that unrelated, already-known gap instead of anything this change is
 * about, so it stays off there. */
export function diffArchives(
  ours: Uint8Array,
  golden: Uint8Array,
  checkPayloadMembers = false,
): FileDiff[] {
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
  if (checkPayloadMembers) diffs.push(...diffPayloadMembers(om, gm));
  return diffs;
}
