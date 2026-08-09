// Builds test/corpus/synthetic/load-seam-mipfix.ttmp2 — the /upgrade golden for Branch B of
// EndwalkerUpgrade.ValidateTexFileData (EndwalkerUpgrade.cs:2116-2124), the mip-offset repair
// TTMP.FixOldTexData runs at load on every .tex of an old pack. Deferred from
// docs/superpowers/specs/2026-07-25-validate-tex-load-seam-design.md §6.2 and built here because
// upstream 1993bf6 changed what this branch DOES: the pre-fix ToBytes ordering guard dropped a
// non-ascending-LoDMips header, and at v3.1.1.4 the header is repaired and kept instead
// (docs/TEXTOOLS_BUGS.md #19).
//
// TTMPVersion "2.0w" is load-bearing, and the "w" suffix is NOT decoration: DoesModpackNeedFix
// (TTMP.cs:918-932) parses the numeric major.minor and returns NeedsTexFix alone for major==2 &&
// minor==0, so the tex load fix runs and the mdl one does not. But TTMP.GetModpackType (TTMP.cs:122-
// 174), which runs FIRST in WizardData.FromModpack (WizardData.cs:1717-1740) to pick the loader,
// classifies purely by suffix — EndsWith("w")/("s")/("b") for Wizard/Simple/Backup, EModpackType.
// Invalid otherwise, in which case FromModpack returns null and ModpackUpgrader.UpgradeModpack
// (ModpackUpgrader.cs:73) NREs on `data.DataPages`. A bare "2.0" (no suffix) hits exactly that
// Invalid path — confirmed empirically against the oracle, which throws the NRE for "2.0" and
// upgrades cleanly for "2.0w". The suffix must stay "w": this pack's a .ttmp2 wizard structure
// (ModPackPages), which only FromWizardTtmp (not FromSimpleTtmp) knows how to read.
//
// The .mtrl + normal + mask triple is NOT decoration. ModpackUpgrader snapshots its AnyChanges
// baseline AFTER the load fixes have run (ModpackUpgrader.cs:70-86) and writes an output pack only
// when AnyChanges (:244), so a pack whose only change is the mip repair produces NO golden at all —
// ConsoleTools no-ops and the harness compares us against our own input. The colorset material gives
// the transform something real to do. Both textures it binds are power-of-two A8R8G8B8, the shape
// npot-mask-a8 proves is byte-exact, so nothing about the material round is under test here.
//
// The two broken fixtures sit at _d (diffuse) paths bound by no sampler, so no upgrade round claims
// them: the material round only follows the mtrl's own samplers, and the third round's unclaimed
// scan is gated on hair/eye paths (ModpackUpgrader.cs:154-189). Their whole job is to reach the load
// seam and come back repaired.

import { buildCanonicalTexHeader } from "../../src/tex/header";
import { A8R8G8B8 } from "../../src/tex/types";
import { concatBytes } from "../../src/util/binary";
import { buildEwColorsetMaskMtrl } from "./synthetic-mtrl";
import { writeTtmp2Files } from "./ttmp2-builder";

// e9998, distinct from npot-mask's e9999: no real base-game material lives there, so
// resolveStolenIndexPath misses its table (gate A, EndwalkerUpgrade.cs:923-936) and no index-path
// steal muddies the comparison.
const MTRL = "chara/equipment/e9998/material/v0001/mt_c9998e9998_top_a.mtrl";
const NORMAL = "chara/equipment/e9998/texture/c9998e9998_top_a_n.tex";
const MASK = "chara/equipment/e9998/texture/c9998e9998_top_a_m.tex";
const BROKEN_TWO_MIP = "chara/equipment/e9998/texture/c9998e9998_top_b_d.tex";
const BROKEN_NON_ASCENDING =
  "chara/equipment/e9998/texture/c9998e9998_top_c_d.tex";

/** Deterministic non-uniform bytes — a flat fill would hide a mis-sized copy. */
function pattern(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + 3) & 0xff;
  return out;
}

/** States the fixture's LoDMips outright instead of inheriting whatever buildCanonicalTexHeader
 *  currently emits — these packs exist to pin a change to that very constructor. */
function withHeaderFields(
  header: Uint8Array,
  lodMips: [number, number, number],
  mip0Offset?: number,
): Uint8Array {
  const out = header.slice();
  const dv = new DataView(out.buffer);
  dv.setUint32(16, lodMips[0], true);
  dv.setUint32(20, lodMips[1], true);
  dv.setUint32(24, lodMips[2], true);
  if (mip0Offset !== undefined) dv.setUint32(28, mip0Offset, true);
  return out;
}

const POT = 64;
const potTex = concatBytes([
  buildCanonicalTexHeader(A8R8G8B8, POT, POT, 1),
  pattern(POT * POT * 4),
]);

// 4x4, two mips (sizes 64 + 16), LoDMips [0,1,0] — the exact canonical header pre-1993bf6 TexTools
// wrote for every two-mip texture, and the one its own ToBytes then refused. mip0's offset is
// clobbered so FixUpBrokenMipOffsets has to rewrite the table and reach the (former) guard.
const twoMip = concatBytes([
  withHeaderFields(buildCanonicalTexHeader(A8R8G8B8, 4, 4, 2), [0, 1, 0], 999),
  pattern(64 + 16),
]);

// 16x16, four mips (1024 + 256 + 64 + 16 = 1360 bytes), LoDMips [0,2,1] — non-ascending without
// being the two-mip special case, so the ascending clamp is exercised independently of hunk 2's
// constructor change. The clamp raises LoD2 to 2, giving [0,2,2].
const nonAscending = concatBytes([
  withHeaderFields(
    buildCanonicalTexHeader(A8R8G8B8, 16, 16, 4),
    [0, 2, 1],
    999,
  ),
  pattern(1024 + 256 + 64 + 16),
]);

writeTtmp2Files(
  "load-seam-mipfix.ttmp2",
  "Load Seam Mip Fix",
  [
    { gamePath: MTRL, data: buildEwColorsetMaskMtrl(NORMAL, MASK) },
    { gamePath: NORMAL, data: potTex },
    { gamePath: MASK, data: potTex },
    { gamePath: BROKEN_TWO_MIP, data: twoMip },
    { gamePath: BROKEN_NON_ASCENDING, data: nonAscending },
  ],
  "synthetic",
  "2.0w",
);
