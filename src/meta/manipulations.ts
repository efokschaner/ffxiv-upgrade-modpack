import type { ItemMeta } from "./types";

/**
 * Would this `.meta` produce at least one Penumbra manipulation? Port of the five segment gates in
 * PMPExtensions.MetadataToManipulations (PmpExtensions.cs:417-467), which emits one manipulation
 * per PRESENT segment: Gmp (:422), Eqp (:429), Est (:436), Eqdp (:446), Imc (:456).
 *
 * EST and IMC gate on `Count > 0`, not merely non-null, so a present-but-empty EST/IMC segment
 * yields nothing — mirrored with `.size`/`.length` rather than a bare null-check. EQDP's `Count > 0`
 * gate (:446) can never be false in the C#: the dictionary it tests comes from DeserializeEqdpData,
 * which unconditionally backfills every missing Eqp.PlayableRaces race after parsing
 * (ItemMetadata.cs:779-788), so a present EQDP segment always has >= 18 entries there. Our
 * deserializeMeta does not backfill (that expansion lives downstream in reconstructMeta,
 * src/meta/reconstruct.ts:24-47), so mirroring the literal `Count > 0` text would silently drop a
 * `.meta` carrying a zero-size EQDP segment that TexTools keeps — hence EQDP below is a bare
 * non-null check, matching the C#'s EFFECTIVE gate rather than its literal one. The two opaque-byte
 * segments (Gmp, Eqp) gate on null alone, no backfill involved.
 */
export function yieldsManipulations(m: ItemMeta): boolean {
  return (
    m.gmp !== null || // PmpExtensions.cs:422
    m.eqp !== null || // :429
    (m.est !== null && m.est.size > 0) || // :436
    m.eqdp !== null || // :446 + ItemMetadata.cs:779-788 (present segment always backfills to >= 18)
    (m.imc !== null && m.imc.length > 0) // :456
  );
}
