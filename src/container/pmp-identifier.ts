import { sha1Hex } from "../util/sha1";

/** The "namespace" half of the derivation. Fixed and project-owned: nothing outside this port
 *  consumes it, and changing it would silently renumber every identifier we have ever written.
 *
 *  NOT an RFC 4122 namespace UUID. §4.3 specifies SHA-1 over the 16 raw BYTES of a namespace UUID
 *  followed by the name; this is an ASCII string hashed as its own UTF-8 bytes. That is a deliberate
 *  simplification — see `pmpIdentifier` for what the output therefore is and is not. */
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
 *   - Deterministically DERIVED from a seed, and shaped like an RFC-4122 version-5 UUID:
 *     reproducible, well-formed, and never empty.
 *
 *  WHAT THIS IS NOT: a conformant RFC 4122 version-5 UUID. §4.3 requires the namespace input to be
 *  the 16 raw bytes of a namespace UUID, and ours is an ASCII string (see `NAMESPACE`). The output
 *  is therefore v5-SHAPED — 32 lowercase hex digits, version nibble `5`, variant nibble in `[89ab]`
 *  — with the version/variant bits stamped exactly as §4.3 prescribes, but it is not derived the way
 *  a §4.3 implementation would derive it and must not be described as one. Nothing depends on
 *  conformance: no consumer re-derives or validates it, Penumbra only needs a non-empty GUID, and
 *  the harness confirms shape and uniqueness, never provenance. The shape is what earns us the
 *  version-nibble assertion in `test/helpers/pmp-v4-nondeterminism.ts` (a `4` on our side means
 *  something other than this function produced the value); conformance would earn us nothing more.
 *
 *  UNIQUENESS IS THE SEED'S JOB, NOT THIS FUNCTION'S. SHA-1 makes distinct seeds collide only
 *  negligibly, so two identifiers differ exactly when their seeds do — which puts the whole burden
 *  on callers to seed with something that actually distinguishes what they mean to distinguish. The
 *  two callers (src/container/pmp.ts) and their scopes:
 *
 *   - `meta:<pack identity>` — must be distinct ACROSS PACKS, because Penumbra keys a mod's identity
 *     on it. Seeded on the pack's whole writable manifest content, not its display name: a bare
 *     `meta:${name}` made every mod called "Hair" (or "Test", or a re-uploaded "Bibo+ Patch") mint
 *     the SAME identifier — precisely the collision the `Guid.Empty` bullet above rejects, arrived at
 *     by a longer route. See the seed's own comment at the call site for what it covers.
 *   - `group:<index>:<name>` — must be distinct WITHIN a pack (that is the scope a group identifier
 *     is read in, and the scope the harness's duplicate check pins). The index alone guarantees it.
 *     No cross-pack claim is made or needed: two packs with a same-named group at the same position
 *     do mint the same group identifier. Folding the pack seed in here would be circular — the pack
 *     seed is computed from the assembled groups, which already carry these values.
 *
 *  The harness confirms this field's SHAPE and its non-duplication, never its value — see
 *  `test/helpers/pmp-v4-nondeterminism.ts` for the rule and why it rejects everything else. */
export function pmpIdentifier(seed: string): string {
  // The §4.3 construction, minus the namespace-as-UUID-bytes part (see above): SHA-1 over
  // (namespace, name), first 16 bytes taken, version and variant nibbles overwritten. `sha1Hex` is
  // the same primitive `resolveDuplicates` already uses; a `\u0000` separator keeps the namespace
  // and the seed from running together for any seed value.
  const hex = sha1Hex(new TextEncoder().encode(`${NAMESPACE}\u0000${seed}`));
  const d = hex.slice(0, 32).split("");
  d[12] = "5"; // version 5, high nibble of octet 6
  d[16] = "89ab"[Number.parseInt(d[16] as string, 16) & 3] as string; // variant 0b10xx, octet 8
  const j = (a: number, b: number): string => d.slice(a, b).join("");
  return `${j(0, 8)}-${j(8, 12)}-${j(12, 16)}-${j(16, 20)}-${j(20, 32)}`;
}
