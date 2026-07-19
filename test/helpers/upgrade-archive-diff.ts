import { readZip } from "../../src/zip/zip";
import { payloadMemberNames, resolveRedirects } from "./archive-redirects";
import { bytesEqual } from "./compare";
import { jsonPointerDiff } from "./json-diff";
import type { FileDiff } from "./upgrade-diff";

const dec = new TextDecoder();

// A manifest member is a JSON document we compare semantically; everything else (game-file
// payloads, the TTMP .mpd blob) is compared by the payload byte-diff (diffUpgrade), not here.
export function isManifest(name: string): boolean {
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
 *  are unaffected.
 *
 *  Exported for reuse by `pmp-self-consistency.ts`, which needs the exact same looseness for the
 *  exact same reason (its own doc comment explains why sharing THIS function, as opposed to the
 *  PMP reader's `windowsPathKey`, is safe). */
export function looseKey(path: string): string {
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
 *     regression"), not a blanket one: if we ever silently lost a member we shouldn't have — a bad
 *     `windowsPathKey`, a writer bug dropping something no `Files`/`Image` field names — that is no
 *     longer this rule's problem to catch: `diffArchives`' payload-member comparison (below) catches
 *     a member the WRITER dropped (present on one side's archive, absent from the other's) directly,
 *     by name. It does NOT cover every conceivable cause of a lost member — in particular, an entry
 *     name fflate and TexTools' Ionic.Zip/IBM437 fallback would decode differently (a byte >= 0x80
 *     with the zip's UTF-8 flag unset) is caught earlier and separately, by `readZip` itself
 *     throwing (src/zip/zip.ts) rather than by any comparison here: ExtraFiles re-emits a
 *     mis-decoded member as an "extra" under its (wrong) decoded name, so the member count would
 *     still balance and this comparison would see nothing to flag. That is what replaced the
 *     previous orphan-payload-member guard here (see git history / the design spec §4.1 for that
 *     episode);
 *   - only a key MISSING from ours is covered; a changed value is still a mismatch;
 *   - every other field is still deep-equal'd.
 *  It is inert whenever ConsoleTools actually wrote the golden: TexTools dropped the key there too,
 *  so both sides agree and this never runs. See the absent-file design spec §4.1. This applies
 *  identically to both shapes below — a `group_NNN.json`'s `Options` array (paired by index) and a
 *  `default_mod.json` (the document IS the single option) — both funnel through `option()` below.
 *
 *  Formerly also reused, with the roles relabeled, by corpus-pmp.ts's manifest round-trip check
 *  (`golden` = the original on-disk JSON, `ours` = the re-emitted one). That check was retired
 *  2026-07-13 when the PMP writer stopped round-tripping the source manifest — see corpus-units.ts's
 *  doc comment for why; `registerResaveCheck` (corpus-resave.ts) is its proper replacement.
 *
 *  `layoutEquivalent`, when true, ALSO rewrites a `Files` VALUE (not just a confirmed-absent key)
 *  when it is purely a `common/N` dedup renumbering — the same shift `diffPayloadSemantic` already
 *  tolerates in the archive's zip member NAMES (see `diffArchives`'s doc comment). A `Files` value is
 *  itself a zip path, i.e. layout, so without this the exact same renumbering reappears here as a
 *  manifest (`jsonPointerDiff`) mismatch even though the structural diff was already suppressed. This
 *  is deliberately narrow, mirroring `diffPayloadSemantic`'s own part 2 scoping:
 *   - only fires for a key present on BOTH sides — a missing/extra `Files` KEY (the gamePath, the
 *     effective result) is never touched here, confirmed-absent-drop pruning above is unaffected;
 *   - only fires when BOTH sides' values resolve (after backslash normalization, via `looseKey`, same
 *     as the `present`/`absent` check above) to a path starting with `common/` — a value outside that
 *     namespace on EITHER side is left as-is, so a writer bug that renames an ordinary (non-dedup)
 *     member is still caught;
 *   - it is a re-keying, not a content check: `diffPayloadSemantic`'s redirect-table comparison has
 *     already proven the gamePath resolves to identical bytes on both sides, so this only suppresses
 *     the redundant name-shaped report of that same fact, never substitutes for it. Callers must gate
 *     `layoutEquivalent` on a STRUCTURAL property of the comparison, never on what the diff looks
 *     like — see `diffArchives`'s doc comment for the two admissible gates. */
export function dropConfirmedAbsentKeys(
  ours: unknown,
  golden: unknown,
  goldenMembers: Map<string, Uint8Array>,
  layoutEquivalent = false,
  stripOursPrefix?: string,
): unknown {
  const present = memberKeys(goldenMembers);
  // Deliberately `toLowerCase()`, NOT `looseKey`: this is an EXEMPTION test, not a resolution test.
  // `looseKey` fails closed when used to RESOLVE a name (it can only ever match a real member, so
  // being loose there is safe — see `looseKey`'s own doc comment), but fails OPEN when used to
  // decide whether to EXEMPT a diff: `looseKey` strips every '.' and ' ', so e.g. "com mon/1/a"
  // would normalize to "common/1/a" and wrongly qualify for the exemption below even though it
  // never names the dedup namespace. A case-fold alone is the right amount of tolerance here.
  const isCommon = (value: unknown): boolean =>
    typeof value === "string" &&
    value.replace(/\\/g, "/").toLowerCase().startsWith("common/");
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
      if (
        layoutEquivalent &&
        !missingFromOurs &&
        isCommon(value) &&
        isCommon(o[gamePath])
      ) {
        out[gamePath] = o[gamePath]; // common/N renumbering — layout-equivalent, confirmed elsewhere
        continue;
      }
      // `stripOursPrefix`: the member-NAME counterpart of this exemption, for the same value seen
      // through the manifest. A `Files` value IS a zip path, so the synthesized `default/` folder
      // that shifts our member names shifts these values identically. CONFIRMATION, not a waiver —
      // ours must equal the golden's value EXACTLY once the one known prefix is removed, so any
      // other difference in the value is still reported. See `diffArchives`' doc comment for the
      // single case a caller may pass it.
      if (stripOursPrefix !== undefined && !missingFromOurs) {
        const oursValue = o[gamePath];
        const stripped =
          typeof oursValue === "string" &&
          oursValue.replace(/\\/g, "/").startsWith(stripOursPrefix)
            ? oursValue.slice(stripOursPrefix.length)
            : oursValue;
        if (
          typeof stripped === "string" &&
          isStringValue &&
          looseKey(stripped.replace(/\\/g, "/")) === looseKey(zipPath)
        ) {
          out[gamePath] = oursValue;
          continue;
        }
      }
      out[gamePath] = value;
    }
    return out;
  };

  const option = (oursOpt: unknown, goldenOpt: unknown): unknown => {
    if (!isObj(goldenOpt) || !isObj(oursOpt) || !isObj(goldenOpt.Files))
      return goldenOpt;
    const out: Record<string, unknown> = {
      ...goldenOpt,
      Files: confirmedFiles(oursOpt.Files, goldenOpt.Files),
    };
    // INTENTIONAL DIVERGENCE (spec §5.1). PopulatePmpStandardOption sets `opt.FileSwaps = new()`
    // and never repopulates it (PMP.cs:873-875), silently destroying every swap the pack carried --
    // docs/TEXTOOLS_BUGS.md #10, adjudicated a genuine defect. We preserve them instead, because a
    // swap is a live redirection in Penumbra (SubMod.AddContainerTo, Penumbra repo
    // Mods/SubMods/SubMod.cs:23-32 -- a separate repo from this project's reference/). So: an EMPTY
    // golden FileSwaps against a NON-EMPTY ours is the confirmed shape, and we adopt ours' value so
    // the pointer diff sees no difference. Applies regardless of `layoutEquivalent` -- this is about
    // the writer destroying swaps on write, not about zip layout.
    //
    // Deliberately tight, and NOT symmetric:
    //  - ours empty + golden populated means we LOST swaps -- still a mismatch;
    //  - both populated but differing means we MANGLED them -- still a mismatch.
    // Only "golden dropped everything, we kept something" is confirmed.
    //
    // UNGATED: unlike the `layoutEquivalent`-gated common/N exemption above, this carve-out runs for
    // every pack, not just ones `packHasFileSwaps` flags on the input. Acceptable today because
    // `base.FileSwaps = o.fileSwaps` (src/container/pmp.ts:446) is a pure passthrough of the reader's
    // own `fileSwaps` map -- there is no writer code path that could FABRICATE a populated FileSwaps
    // map for an option the input never gave one to, so the shape this carve-out blesses (ours
    // non-empty, golden empty) cannot arise for a swap-free pack. That passthrough is pinned by
    // `test/container/pmp-write.test.ts`'s round-trip case; if it ever grows real logic instead of a
    // straight assignment, this carve-out should gate on `packHasFileSwaps` of the input too.
    //
    // IN-GAME VERIFICATION (AGENTS.md first principle, requirement 3) -- performed 2026-07-19 by the
    // operator, against `torn bassment glow.pmp` (6 swaps pulling e6120 textures onto e0246):
    // both packs load in Penumbra; the FileSwaps metadata difference is visible; and **a material
    // that loads successfully from our output FAILS to load from TexTools' output**, because the
    // swaps that resolved its textures were destroyed on write. That is the concrete user-visible
    // harm this divergence exists to prevent, observed rather than reasoned.
    //
    // The exact mechanism, so this is reproducible rather than testimony. The packed material
    // `chara/equipment/e0246/material/v0001/mt_c0101e0246_top_a.mtrl` references THREE textures,
    // and ALL THREE arrive via FileSwaps -- none is packed:
    //     v01_c0101e0246_top_n_afadde89.tex   <- e6120/v01_c0101e6120_top_n.tex
    //     v01_c0101e0246_top_m_0b26c9b8.tex   <- e6120/v01_c0101e6120_top_m.tex
    //     v01_c0101e0246_top_id_f6bf57ea.tex  <- e6120/v01_c0101e6120_top_id.tex
    // Those hash-suffixed DESTINATION paths are TexTools' item-swap feature minting unique names so
    // the swapped item cannot collide with real e0246 gear. Checked against the 040000 index
    // (scripts/lib/game-index.ts): all three destinations are ABSENT from the game, all three
    // sources EXIST. So they resolve to nothing unless the swap supplies them -- there is no
    // base-game fallback, because the suffixed name is not a base-game name (the conventional
    // un-suffixed `v01_c0101e0246_top_n.tex` does exist, but the material never asks for it).
    // Drop the swaps and the material points at three addresses backed by nothing: a hard load
    // failure, not a degraded appearance.
    //
    // Verified against ConsoleTools `/resave`, NOT `/upgrade` -- ConsoleTools no-ops on every
    // swap-carrying pack we have, so it emits no `/upgrade` output to compare against. `/resave` is
    // the same write path minus the transform (Program.cs:191-221) and PopulatePmpStandardOption
    // sits in that shared path, so the destruction shown there is the destruction any writing
    // `/upgrade` performs. What this does NOT establish is how often a real user reaches that path
    // via `/upgrade`; that is a reachability question answered by the call path, not by this
    // evidence. See the spec §7 -- do not cite this as more than it is.
    const gSwaps = isObj(goldenOpt.FileSwaps) ? goldenOpt.FileSwaps : undefined;
    const oSwaps = isObj(oursOpt.FileSwaps) ? oursOpt.FileSwaps : undefined;
    if (
      gSwaps !== undefined &&
      oSwaps !== undefined &&
      Object.keys(gSwaps).length === 0 &&
      Object.keys(oSwaps).length > 0
    ) {
      out.FileSwaps = oSwaps;
    }
    return out;
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

/** Multiset-compare payload (non-manifest) member NAMES (and, for matched pairs, BYTES) between our
 *  archive and the golden, bucketed by `looseKey` so a legitimate spelling difference (case, a
 *  stripped trailing dot) is not flagged — the same normalization `dropConfirmedAbsentKeys` uses to
 *  decide "does this zip path resolve to a member of this archive". This is what makes the
 *  orphan-payload-member guard that used to live here unnecessary: that guard existed because the
 *  drop confirmation above only ever looks at `Files` keys, so a member the WRITER silently dropped
 *  for any OTHER reason (e.g. a writer bug dropping an `ExtraFile` no `Files`/`Image` field ever
 *  referenced — PMP.cs:213-215) was invisible to it. Comparing the member-name sets directly catches
 *  a member missing on one side, per member — see the regression test in
 *  upgrade-archive-diff.test.ts pinning the "silently lost an unreferenced member" hole this
 *  replaces. It does NOT catch every way a member could be wrong: an entry name fflate would decode
 *  differently than TexTools' Ionic.Zip/IBM437 fallback (a byte >= 0x80 with the UTF-8 flag unset)
 *  never reaches this comparison at all — `readZip` throws on it first (src/zip/zip.ts) rather than
 *  silently producing a name for this function to compare.
 *
 *  Reported as `structure` diffs, same as a missing/extra manifest member above, except a
 *  content-mismatched matched pair, reported as `mismatch` (Minor 4: content was previously
 *  unchecked here — a corrupted or swapped extra, which has no `gamePath` for `diffUpgrade` to
 *  catch it under, was invisible).
 *
 *  `confirmDivergence`, when supplied, is consulted on a raw content mismatch before it is
 *  reported: a matched pair whose only difference is an INTENDED one (a DIVERGENCE_RULES entry)
 *  is treated as matched here too, same as it already is in `diffUpgrade`'s gamePath-keyed payload
 *  diff. Without this, a real, confirmed divergence (e.g. the eye-mask diffuse's float64-vs-float32
 *  pixel tolerance) would pass `diffUpgrade` but still be flagged here as a structural mismatch —
 *  this function's only other consumer of file identity is the archive MEMBER NAME (`<option
 *  prefix><gamePath>` for a PMP, per `src/container/option-prefix.ts`), not the bare gamePath, so
 *  it is passed to `confirmDivergence` as-is: a path-scoped rule's predicate must therefore match a
 *  gamePath *suffix* of an arbitrary prefixed string (e.g. `.includes(...)`/`.endsWith(...)`, not
 *  `.startsWith(...)`) to fire in both places. */
function diffPayloadMembers(
  ours: Map<string, Uint8Array>,
  golden: Map<string, Uint8Array>,
  confirmDivergence?: (
    gamePath: string,
    ours: Uint8Array,
    golden: Uint8Array,
  ) => boolean,
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
    // Matched pairs (same looseKey bucket, paired in sorted order): compare BYTES. Names alone
    // proved a member exists on both sides, but content was never diffed anywhere else — extras
    // have no `gamePath`, so `diffUpgrade` (keyed by gamePath) cannot see them, and a corrupted or
    // swapped extra would otherwise pass silently (Minor 4).
    for (let i = 0; i < n; i++) {
      const oBytes = ours.get(os[i]!)!;
      const gBytes = golden.get(gs[i]!)!;
      if (!bytesEqual(oBytes, gBytes)) {
        if (confirmDivergence?.(gs[i]!, oBytes, gBytes)) continue; // confirmed intentional divergence
        diffs.push({
          kind: "structure",
          gamePath: gs[i]!,
          index: 0,
          status: "mismatch",
          detail: `${oBytes.length} vs ${gBytes.length} bytes`,
        });
      }
    }
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

/** STRUCTURE (manifest member-name set) + MANIFEST (one diff per differing JSON pointer, via
 * `jsonPointerDiff`) diffs between two un-archived modpacks. Payload content is diffed separately
 * by diffUpgrade. Orientation matches diffUpgrade: golden-only member => "added"; ours-only =>
 * "removed"; shared+unequal => "mismatch".
 * See docs/superpowers/specs/2026-07-08-modpack-serialization-parity-design.md §3.
 *
 * `checkPayloadMembers` additionally compares the *names* (and, for matched pairs, bytes) of
 * non-manifest members (see `diffPayloadMembers`). Callers should only pass `true` for PMP —
 * `isManifest` counts `.mpl` but not `.mpd`, so a TTMP's single opaque `TTMPD.mpd` blob is not a
 * PMP-shaped "payload member" (a per-gamePath zip entry) at all — turning this on for TTMP would
 * compare the wrong thing (and any OTHER member in a source `.ttmp2`/`.ttmp` archive, which
 * `writeTtmp2` has no analogue for, would produce a spurious diff). It used to be further scoped to
 * the no-op branch only, because our writer reused the source pack's own zip member names where a
 * real golden regenerates every name as `<optionPrefix><gamePath>`; now that `writePmp` regenerates
 * names the same way (see `src/container/option-prefix.ts` / `resolve-duplicates.ts`), that
 * restriction is gone and this runs on every PMP golden, no-op or not.
 *
 * `confirmDivergence`, when supplied, is forwarded to `diffPayloadMembers`' matched-pair content
 * check (see its doc comment) so a confirmed DIVERGENCE_RULES entry is not double-reported here
 * after `diffUpgrade` already accepted it.
 *
 * `layoutEquivalent` swaps the payload comparison for `diffPayloadSemantic` — compare the redirect
 * table rather than the member-name multiset. Pass `true` ONLY when the comparison is STRUCTURALLY
 * incapable of matching member names, never based on what the diff looks like: gating on the symptom
 * would silently absorb genuine writer regressions in every pack. Exactly two such gates exist today
 * (both applied by `registerUpgradeCheck`, corpus-upgrade.ts, which documents each in full):
 *   1. the INPUT pack carries FileSwaps (`packHasFileSwaps`) — TexTools' write-time swap destruction
 *      shifts our `common/N` dedup numbering away from the golden's. See the spec, §5.2.
 *   2. the golden is a NO-OP — ConsoleTools wrote no archive, so the reference is the raw input pack,
 *      a layout TexTools' writer never produced and therefore no oracle for member names at all.
 *
 * `stripOursPrefix` removes one known leading folder from OUR payload member names (and from our
 * matching `Files` VALUES) before pairing them with the golden's. Unlike the two gates above it is a
 * CONFIRMATION of one specific expected difference, not a relaxation: the stripped name must then
 * equal the golden's exactly, so any member that differs in any other way is still reported.
 *
 * Exactly one caller passes it, `registerUpgradeCheck` for a DEFAULT-ONLY PMP on the no-op branch,
 * and it is derivable rather than observed: a PMP with no groups makes `WizardData.FromPmp`
 * synthesize a lone group named "Default" (WizardData.cs:1118-1138), which `MakeGroupPrefix`
 * folder-safes to the prefix `default/` (WizardData.cs:1390-1400). Our output is therefore the raw
 * Penumbra input's layout plus exactly that one folder. Verified against the write-side oracle:
 * ConsoleTools /resave on `torn bassment glow.pmp` emits `default/chara/equipment/e0246/...`,
 * byte-identical to ours.
 *
 * Deliberately NOT generalized to "the golden is a no-op, so skip name comparison": the other no-op
 * synthetics (`f1-safename.pmp`, `case-mismatch.pmp`, `trailing-dot.pmp`) author their input layout
 * to be exactly what TexTools writes, precisely so the member-name comparison pins their repro. A
 * blanket skip would make all three unable to fail.
 *
 * `layoutEquivalent` REQUIRES `checkPayloadMembers` — see the guard at the top of the function body
 * for why the two are coupled. */
export function diffArchives(
  ours: Uint8Array,
  golden: Uint8Array,
  checkPayloadMembers = false,
  confirmDivergence?: (
    gamePath: string,
    ours: Uint8Array,
    golden: Uint8Array,
  ) => boolean,
  layoutEquivalent = false,
  stripOursPrefix?: string,
): FileDiff[] {
  if (stripOursPrefix !== undefined && !layoutEquivalent) {
    // Fail loud (AGENTS.md), not silently diverge: the prefix confirmation below only re-keys the
    // NAME of a member. It is sound because diffPayloadSemantic's part 1 independently proves each
    // gamePath resolves to identical BYTES through the redirect table. Without layoutEquivalent the
    // payload goes to diffPayloadMembers, which has no part 1 — so a prefix-stripped pairing there
    // would rest on nothing but the names it just rewrote.
    throw new Error(
      "diffArchives: stripOursPrefix requires layoutEquivalent=true. Re-keying a member name by " +
        "prefix is only sound when diffPayloadSemantic's redirect-table pass runs alongside it to " +
        "independently prove the content matches; diffPayloadMembers has no equivalent.",
    );
  }
  if (layoutEquivalent && !checkPayloadMembers) {
    // Fail loud (AGENTS.md), not silently diverge: dropConfirmedAbsentKeys' Files-VALUE
    // common/N exemption (below, via jsonPointerDiff) is sound only because diffPayloadSemantic
    // (gated by checkPayloadMembers) independently proves the redirect resolves to identical
    // content. Without that, this combination would exempt a genuinely mis-pointed redirect —
    // e.g. ours "chara/a.tex" -> "common/1/a.bin" vs golden "chara/a.tex" -> "common/2/zzz.bin",
    // naming entirely different content — with no content check anywhere in the comparison.
    throw new Error(
      "diffArchives: layoutEquivalent requires checkPayloadMembers=true. The Files-value " +
        "common/N exemption is only sound when diffPayloadSemantic (checkPayloadMembers) runs " +
        "alongside it to independently prove content equivalence through the redirect table; " +
        "enabling layoutEquivalent without it would exempt every common/->common/ Files-value " +
        "difference with no content check at all.",
    );
  }
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
      // qualifies as a confirmed drop, so this reduces to a straight structural diff in that case.
      // One FileDiff PER DIFFERING JSON POINTER, not one per document: see jsonPointerDiff's doc
      // comment for why the old document-granular `mismatch` was a ratchet hazard.
      for (const d of jsonPointerDiff(
        o,
        dropConfirmedAbsentKeys(o, g, gm, layoutEquivalent, stripOursPrefix),
      )) {
        diffs.push({
          kind: "manifest",
          gamePath: `${name}#${d.pointer}`,
          index: 0,
          status: d.status,
          detail: undefined,
        });
      }
    }
  }
  if (checkPayloadMembers)
    diffs.push(
      ...(layoutEquivalent
        ? diffPayloadSemantic(om, gm, confirmDivergence, stripOursPrefix)
        : diffPayloadMembers(om, gm, confirmDivergence)),
    );
  return diffs;
}

/** Payload comparison for a pack whose zip LAYOUT cannot match the golden's, but whose behaviour
 *  must (the spec, §5.2). Compares the redirect table (`gamePath -> content`, keyed per option —
 *  see `resolveRedirects`'s doc comment, archive-redirects.ts — Penumbra SubMod.AddContainerTo,
 *  Penumbra repo Mods/SubMods/SubMod.cs:23-32, a separate repo from this project's reference/)
 *  instead of the member-name multiset, because a preserved FileSwap means
 *  TexTools burned a dedup `idx` we did not (PMP.cs · UnpackPmpOption · 1104-1137 ->
 *  PmpExtensions.cs · ResolveDuplicates · 500,543 — `var idx = 1` then `idx++` on a repeat hit),
 *  shifting every later `common/N`.
 *
 *  This is a RE-KEYING, not a tolerance. It still fails on a (option, gamePath) pair present on
 *  one side only, on differing content for a shared pair, and on ANY non-`common/` member name
 *  differing — only renumbering WITHIN the `common/N` dedup namespace is free. Callers must gate
 *  it on the input pack actually carrying FileSwaps (`packHasFileSwaps`); firing it on the diff's
 *  shape instead would silently absorb writer regressions in every other pack.
 *
 *  Two real narrowings versus the strict-mode sibling (`diffPayloadMembers`), not just a looser
 *  tolerance — see part 2's own comment below for the detail: a one-sided orphan member INSIDE
 *  `common/` is invisible here (part 2 filters the whole namespace out, on both sides, not just the
 *  exact-name check), and a payload member no `Files` value names (an option's `Image`, an
 *  `ExtraFiles` entry) never gets its bytes compared at all, even as a matched pair.
 *
 *  `FileDiff.gamePath` here is `resolveRedirects`' composite key
 *  (`redirectKey`: `${manifestName}#${optionIndex}|${gamePath}`), not a bare gamePath — that key IS
 *  the identity a divergence in this comparison is keyed by (see `resolveRedirects`' doc comment
 *  for why an archive-wide merge would silently hide a cross-option divergence), and it stays
 *  human-legible (names both the option and the gamePath) for a failing assertion. Because the
 *  gamePath is always the key's trailing segment (after the last `|`), a `confirmDivergence` rule
 *  whose predicate matches a gamePath *suffix* (`.endsWith(...)`, per `diffPayloadMembers`'s doc
 *  comment above) still fires correctly against this composite key. */
export function diffPayloadSemantic(
  ours: Map<string, Uint8Array>,
  golden: Map<string, Uint8Array>,
  confirmDivergence?: (
    gamePath: string,
    ours: Uint8Array,
    golden: Uint8Array,
  ) => boolean,
  stripOursPrefix?: string,
): FileDiff[] {
  const diffs: FileDiff[] = [];

  // 1. The redirect tables must agree exactly — same (option, gamePath) keys, same bytes.
  const o = resolveRedirects(ours);
  const g = resolveRedirects(golden);
  for (const key of [...new Set([...o.keys(), ...g.keys()])].sort()) {
    const ob = o.get(key);
    const gb = g.get(key);
    if (ob === undefined) {
      diffs.push({
        kind: "structure",
        gamePath: key,
        index: 0,
        status: "added",
        detail: undefined,
      });
      continue;
    }
    if (gb === undefined) {
      diffs.push({
        kind: "structure",
        gamePath: key,
        index: 0,
        status: "removed",
        detail: undefined,
      });
      continue;
    }
    if (bytesEqual(ob, gb)) continue;
    if (confirmDivergence?.(key, ob, gb)) continue;
    diffs.push({
      kind: "structure",
      gamePath: key,
      index: 0,
      status: "mismatch",
      detail: `${ob.length} vs ${gb.length} bytes`,
    });
  }

  // 2. Every payload member name OUTSIDE the `common/N` dedup namespace must still match exactly (up
  //    to `looseKey`, same spelling tolerance as `diffPayloadMembers`), so a misnamed or dropped
  //    ordinary member is still caught here. Matched by `looseKey` but REPORTED under the real member
  //    name — unlike the matching key, `looseKey` strips every '.' (see its doc comment), so using it
  //    as the reported name too would silently corrupt a real name like "a.tex" into "atex" in every
  //    diff this branch raises.
  //
  //    Bucketed multiset pairing, mirroring `diffPayloadMembers` above — NOT a `Set`-membership
  //    check. Two genuinely distinct member names can share a `looseKey` (e.g. "extra.tex" and
  //    "extra .tex" both normalize to "extratex"); a `Set` can only record that the key is
  //    PRESENT, not that one side has two real members under it and the other has one, so an
  //    extra, unpaired member on either side would be silently lost. Bucketing by `looseKey`,
  //    sorting within each bucket, and pairing positionally makes the comparison count-aware: only
  //    the overflow past the shared count is reported, exactly as `diffPayloadMembers` does.
  //
  //    TWO real narrowings versus that strict-mode sibling — both a genuine coverage loss in
  //    relaxed mode, not merely cosmetic, and both scoped to packs that take this path
  //    (`packHasFileSwaps`, 2 of the corpus as of this writing — see the design spec §5.2):
  //     - `common/`-prefixed names are filtered OUT of this comparison entirely (`outsideNames`,
  //       on both `ours` and `golden`) rather than merely exempted from the exact-name check. A
  //       member that exists inside `common/` on only ONE side — an orphan the writer dropped or
  //       added, unrelated to any legitimate renumbering — is invisible to this whole function,
  //       though `diffPayloadMembers` (strict mode) would report it as a structural add/remove.
  //       Nothing else in relaxed mode catches it either, unless it also happens to be a
  //       `Files`-referenced member whose content part 1 checks.
  //     - Matched pairs here are NOT byte-compared — this part is name-only. "Already checked by
  //       part 1's redirect-table comparison" holds ONLY for a member actually named by some
  //       option's `Files` value: part 1 walks `Files` (via `resolveRedirects`), so a payload
  //       member no `Files` entry points at — an option's `Image` PNG, an `ExtraFiles` entry — has
  //       its bytes checked by NEITHER part here, even though `diffPayloadMembers` (strict mode)
  //       would content-compare it as a matched pair. See
  //       `docs/backlog/2026-07-18-semantic-payload-part2-coverage.md`.
  //    `stripOursPrefix` (see `diffArchives`' doc comment for when a caller may pass it) removes
  //    that exact leading folder from OUR names before pairing. This is a CONFIRMATION, not a
  //    waiver: the stripped name must still match the golden's exactly, so a member that differs in
  //    any other way is still reported. It exists for the default-only-PMP case, where our name is
  //    provably the golden's plus one synthesized folder and nothing else.
  const strip = (n: string): string =>
    stripOursPrefix !== undefined && n.startsWith(stripOursPrefix)
      ? n.slice(stripOursPrefix.length)
      : n;
  const outsideNames = (m: Map<string, Uint8Array>, ours: boolean) =>
    payloadMemberNames(m)
      .map((n) => (ours ? strip(n) : n))
      .filter((n) => !looseKey(n).startsWith("common/"));
  const bucket = (names: string[]): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const n of names) {
      const list = m.get(looseKey(n)) ?? [];
      list.push(n);
      m.set(looseKey(n), list);
    }
    return m;
  };
  const ob = bucket(outsideNames(ours, true));
  const gb = bucket(outsideNames(golden, false));
  for (const bucketKey of [...new Set([...ob.keys(), ...gb.keys()])].sort()) {
    const os = (ob.get(bucketKey) ?? []).slice().sort();
    const gs = (gb.get(bucketKey) ?? []).slice().sort();
    const n = Math.min(os.length, gs.length);
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
