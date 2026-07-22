import type { SqPackCompressedFile } from "../model/modpack";

/**
 * Load-seam types shared between the TTMP readers (which consume a fix as an optional parameter) and
 * the upgrade layer (which implements one). They live HERE, in the container layer, on purpose: the
 * readers must never import the upgrade layer's FIX logic (that would invert layering and blend
 * different C# symbols — see AGENTS.md "split, don't blend"). Readers do import the pure gate
 * predicates (`ttmpNeedsTexFix` / `ttmpNeedsMdlFix`, from `../upgrade/texfix` / `../upgrade/model`) to
 * compute `needsTexFix` / `needsMdlFix` themselves, mirroring how FromWizardGroup computes those same
 * two flags inline (`WizardData.cs:656-657`) before its fix loop; that's fine and acyclic since it's
 * only the gate predicates, never the fix. Defining the seam type where it is consumed lets the
 * upgrade layer depend downward on the container to implement it (load-fixes.ts), never the reverse.
 */

/** Gate flags a reader computes from the parsed TTMPVersion, handed to the LoadFix factory. */
export interface LoadFixGates {
  needsTexFix: boolean;
  needsMdlFix: boolean;
}

/**
 * Per-file load fix applied at the read seam, BEFORE the reader's last-write-wins collapse `.set`,
 * reproducing WizardData.FromWizardGroup's fix-then-collapse order (WizardData.cs:685-738, the whole
 * body guarded by `if (File.Exists(finfo.RealPath))`). Returns the fixed file, or `null` to DROP it
 * (the C# `catch { continue }` in the tex/mdl `else` branch, :699-738 — or, for `.meta`, the implicit
 * skip where the `:685-698` branch diverts the file into `data.Manipulations` and never adds it to
 * `data.Files` at all) — so a dropped later duplicate FullPath never overwrites an earlier survivor. A
 * `LoadFix` may therefore implement either the tex/mdl fix-or-drop branch (:699-738) or the
 * `.meta`/`.rgsp` branch (:685-698) — see `makeTtmpLoadFix` (`../upgrade/load-fixes.ts`) for the
 * concrete implementation of both.
 */
export type LoadFix = (
  gamePath: string,
  file: SqPackCompressedFile,
) => SqPackCompressedFile | null;

/** Factory a reader calls once it has parsed the version and computed the gates. */
export type LoadFixFactory = (gates: LoadFixGates) => LoadFix;
