// The regular-case base-material index path, derived from the material path plus the two non-derivable
// values the extractor stores per material: the texture VERSION number and the keep-variant-letter bit.
// TexTools reads this whole path from the base material (EndwalkerUpgrade.cs:923-936); we store only what
// cannot be derived from the material path string. NOTE: `version` is the index-TEXTURE version prefix,
// which is NOT the material's own folder version (they diverge for most equipment — see Task 3). Shared by
// scripts/extract-index-table.ts (encoder) and index-path-resolver.ts (runtime).
// mt_c0201e0194_top_a.mtrl + (version 1, keepLetter false)  ->  .../texture/v01_c0201e0194_top_id.tex
export function reconstructIndexPath(
  materialPath: string,
  version: number,
  keepLetter: boolean,
): string | null {
  const m = materialPath.match(/^(.*)\/material\/v\d{4}\/mt_(.+)\.mtrl$/);
  if (!m) return null;
  const [, root, name] = m;
  const vv = String(version).padStart(2, "0"); // 1 -> "01" ; 18 -> "18" ; 100 -> "100"
  const body = keepLetter ? name! : name!.replace(/_[a-z]$/, "");
  return `${root}/texture/v${vv}_${body}_id.tex`;
}
