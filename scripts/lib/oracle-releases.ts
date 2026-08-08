// The TexTools releases this repo can provision as its /upgrade + /resave oracle.
//
// The porting baseline is the INSTALLED ConsoleTools (README "Upstream provenance"), so this table
// and reference/'s checked-out commit must move together. Hashes are pinned so a download is
// verified rather than trusted — the same reasoning as the repo's pinned-exact npm policy.

export type OracleRelease = {
  /** Git tag in TexTools/FFXIV_TexTools_UI. */
  tag: string;
  /** Release asset filename. */
  asset: string;
  /** Direct download URL for `asset`. */
  url: string;
  /** Lowercase hex sha256 of the asset, verified before extraction. */
  sha256: string;
  /** Asset size in bytes; a cheap pre-check before hashing. */
  size: number;
};

/** The tag the repo is currently pinned to. `reference/` must be checked out to match. */
export const PINNED_ORACLE_TAG = "v3.1.1.4";

export const ORACLE_RELEASES: Record<string, OracleRelease> = {
  // v3.1.1.4 is zip-only (no Install_TexTools.exe since v3.1.0.2) and its release is still
  // titled "v3.1.1.3 BETA" despite prerelease:false. It is the first release carrying the
  // patch-7.5 CMP fix (xivModdingFramework d731d744) our /resave oracle needs.
  "v3.1.1.4": {
    tag: "v3.1.1.4",
    asset: "FFXIV_TexTools_v3.1.1.4b.zip",
    url: "https://github.com/TexTools/FFXIV_TexTools_UI/releases/download/v3.1.1.4/FFXIV_TexTools_v3.1.1.4b.zip",
    sha256: "6add67cb87c8b123ade5f9b4172571d24adcaca3072475af3c7ee5f1907e86a2",
    size: 35_120_324,
  },
};
