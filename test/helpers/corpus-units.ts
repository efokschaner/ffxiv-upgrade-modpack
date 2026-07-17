import { corpusPacks, isUpgradeErrorPack } from "./corpus-roots";

// Pure enumeration of corpus work units. Depends ONLY on node:fs/node:path (via corpus-roots) and
// runs NO test registration on import, so the Node-API runner can import it outside any test
// worker. The vitest-dependent dispatch lives in corpus-register.ts (loaded only inside workers).

export type CheckKind = "assets" | "golden" | "upgrade" | "resave";
export interface Unit {
  pack: string;
  check: CheckKind;
}

/**
 * Every (pack × check-family) work unit, in a stable order: packs sorted ascending, then per pack
 * the fixed check order [assets, golden, upgrade, resave]. The index into this array is the virtual
 * module's identity.
 *
 * `assets` is ONE unit covering all five ASSET-LEVEL families (sqpack, mtrl, tex, mdl, geometry)
 * over a single shared load + decode — see corpus-assets.ts. They were five separate units until
 * 2026-07-14; each re-ran readFileSync -> loadModpack -> decodeSqPackFile in its own worker, which
 * made the per-filetype checks ~95% duplicated inflate (the `tex` check spent 3951 ms re-decoding
 * and 189 ms asserting on the biggest pack). Every assertion is retained; only the decode is shared.
 *
 * The three PACK-LEVEL checks stay separate units on purpose: they exercise the write path and the
 * ConsoleTools oracles rather than the shared decode, and keeping them apart preserves the
 * scheduling granularity the forks pool needs to fill all cores.
 *
 * Packs in the `upgrade-error` corpus root (see corpus-roots.ts `isUpgradeErrorPack`) are scoped to
 * ONLY the `upgrade` check: they exist to prove our port throws exactly where ConsoleTools /upgrade
 * throws (a matched-failure test), not to exercise the writer/codec, so they skip
 * assets/golden/resave, which would otherwise surface unrelated writer/codec gaps on their content.
 *
 * There used to be a ninth, PMP-only "pmp" check (`registerPmpManifestChecks`, formerly
 * corpus-pmp.ts) that compared `writePmp(readPmp(x))` structurally against the SOURCE `x`. Retired
 * (2026-07-13, PMP writer regeneration): its whole premise was that our writer round-trips the
 * source manifest near-verbatim, which is now false BY DESIGN — TexTools itself never round-trips
 * either (PMP.WritePmp regenerates Files/FileSwaps/Manipulations/every typed field from its model,
 * see src/container/pmp.ts), and reproducing that is the fix this branch makes. Its actual PURPOSE
 * — an INDEPENDENT check of PMP manifest fidelity, since `golden` alone can't catch a reader bug
 * that corrupts both sides of its self round-trip identically (see corpus-golden.ts's doc comment,
 * now updated) — is properly superseded by `resave`: it compares our writer against ConsoleTools'
 * OWN independent implementation (real ground truth), not a self-referential "unchanged from
 * source" assumption, so it has no blind spot `pmp` ever closed and is strictly the better check.
 */
export function enumerateUnits(): Unit[] {
  const units: Unit[] = [];
  for (const pack of corpusPacks()) {
    if (isUpgradeErrorPack(pack)) {
      // Expected-failure /upgrade pack: only the upgrade check (matched-failure test). See corpus-roots.
      units.push({ pack, check: "upgrade" });
      continue;
    }
    units.push({ pack, check: "assets" });
    units.push({ pack, check: "golden" });
    units.push({ pack, check: "upgrade" });
    units.push({ pack, check: "resave" });
  }
  return units;
}
