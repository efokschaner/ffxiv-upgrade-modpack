import { sha1Hex } from "../util/sha1";

/** RFC 4122 §4.3's "namespace" half of a version-5 UUID's input. A fixed, project-owned string:
 *  nothing outside this port consumes it, and changing it would silently renumber every identifier
 *  we have ever written. */
const NAMESPACE = "ffxiv-upgrade-modpack/pmp-v4";

/** Our stand-in for the `Guid.NewGuid()` field initializers TexTools relies on for a written PMP's
 *  identifiers — `PMPMetaJson.Identifier` (PMP.cs:1476) and `PMPGroupJson.Identifier` (:1514).
 *  Neither is ever assigned: `WizardData.WritePmp` (WizardData.cs:1509-1517) and
 *  `WizardGroupEntry.ToPmpGroup` (:957-964) leave both at their initializers, so TexTools mints a
 *  fresh random GUID on every write.
 *
 *  INTENTIONAL DIVERGENCE, and an unavoidable one: the VALUE can never match a golden whatever we
 *  do, since the golden's is random. What we choose is the quality of OUR output (operator ruling,
 *  2026-08-06):
 *
 *   - NOT random per write. Our writer would stop being deterministic, making every written-bytes
 *     assertion untestable and every diff harder to read, for zero gain.
 *   - NOT `Guid.Empty` (`00000000-…-000000000000`). Penumbra treats a mod's `Identifier` as its
 *     `StableIdentifier` and explicitly rejects the empty GUID, so two of our packs would collide on
 *     one identity. (Penumbra's sources are a separate repo from this project's `reference/` and are
 *     consulted for format semantics only; nothing here is ported from them.)
 *   - Deterministically DERIVED, RFC-4122 version-5 shaped: reproducible, well-formed, unique per
 *     pack and per group, and never empty.
 *
 *  The harness confirms this field's SHAPE, never its value — see
 *  `test/helpers/pmp-v4-nondeterminism.ts` for the rule and why it rejects everything else. */
export function pmpIdentifier(seed: string): string {
  // RFC 4122 §4.3 names SHA-1 over (namespace, name) for a version-5 UUID. `sha1Hex` is the same
  // primitive `resolveDuplicates` already uses; a `\u0000` separator keeps the namespace and the
  // seed from running together for any seed value.
  const hex = sha1Hex(new TextEncoder().encode(`${NAMESPACE}\u0000${seed}`));
  const d = hex.slice(0, 32).split("");
  d[12] = "5"; // version 5, high nibble of octet 6
  d[16] = "89ab"[Number.parseInt(d[16] as string, 16) & 3] as string; // variant 0b10xx, octet 8
  const j = (a: number, b: number): string => d.slice(a, b).join("");
  return `${j(0, 8)}-${j(8, 12)}-${j(12, 16)}-${j(16, 20)}-${j(20, 32)}`;
}
