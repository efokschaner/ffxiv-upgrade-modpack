/**
 * The diagnostics channel returned alongside an upgraded modpack.
 *
 * NOT a port of any C# symbol — TexTools reports the same events by writing a .NET
 * `Exception.ToString()` to `Trace`, which we deliberately do not reproduce (see
 * docs/superpowers/specs/2026-08-01-upgrade-diagnostics-channel-design.md §2). This module is
 * scaffolding for OUR seam, so it carries no `file · symbol · lines` citation; the individual
 * diagnostics emitted through it each cite the C# site whose behaviour they report.
 *
 * Lives in `src/util/` beside `errors.ts` for the same reason that file does: both the format layer
 * (`src/mtrl/`, `src/tex/`) and the upgrade layer need it, and `src/mtrl/` must not import "up".
 */

/** Stable diagnostic identities. Tests assert CODES, never prose, so message wording stays free to
 * change (spec §3). Values are the serialized form and reach the ratchet baseline — treat them as
 * a wire format and do not rename one without re-blessing. */
export enum DiagnosticCode {
  /** OUR PORT did not reproduce something. Always fatal (`ok: false`) — spec §4.1. */
  UnportedGap = "unported-gap",
  /** A failure the C# can also produce, escaping to the boundary. Fatal. Message is verbatim C#. */
  UpgradeFailed = "upgrade-failed",
  /** EndwalkerUpgrade.cs:1498-1501's swallow fired: a hair/tail/ear texture transform failed and the
   * raw pre-transform copies were left in place. NOT fatal — TexTools swallows here too, so bytes
   * still match the golden (docs/TEXTOOLS_BUGS.md #12). */
  HairTransformFailed = "hair-transform-failed",
}

/** One frame of context pushed onto an in-flight `UnportedGapError` as it unwinds (spec §4.3).
 * Every field is optional because no single frame knows them all: the throw site has the path, the
 * per-material catch has the material, and only `upgradeModpack`'s own loop has group + option. */
export interface GapContextFrame {
  gamePath?: string;
  material?: string;
  group?: string;
  option?: string;
  /** `file · symbol · lines` of the C# this operation ports, when the annotating frame knows it. */
  provenance?: string;
}

export interface Diagnostic {
  severity: "error" | "warning";
  code: DiagnosticCode;
  /** VERBATIM for reproduced-TexTools failures — `assertMatchedUpgradeFailure` substring-matches
   * this against the oracle's captured trace. Never prefix or wrap it (spec §3). */
  message: string;
  gamePath?: string;
  option?: { group: string; option: string };
  provenance: string;
  /** The originating error, when there was one. Kept so an `UnportedGapError` stays recognizable by
   * type and a genuine bug keeps its stack — the boundary catches everything, so without this the
   * distinction would be lost (spec §4.1). Not rendered to end users. */
  cause?: unknown;
}

/** Result of an upgrade. A discriminated union rather than a nullable field: `ok` narrows, so a
 * caller cannot reach `data` without handling failure, and the two can never disagree (spec §3).
 * "Produced but degraded" is deliberately not stored — it is `ok === true` with an `error`
 * diagnostic present. */
export type UpgradeResult<T> =
  | { ok: true; data: T; diagnostics: Diagnostic[] }
  | { ok: false; data: null; diagnostics: Diagnostic[] };

/** Flatten accumulated frames into one. Frames arrive innermost-first (index 0 is deepest, pushed
 * by the catch closest to the throw), and later/outer frames overwrite earlier ones for the same
 * key because the outer frame knows more about WHERE the failure sits. */
export function mergeGapContext(frames: GapContextFrame[]): GapContextFrame {
  return frames.reduce<GapContextFrame>((acc, f) => ({ ...acc, ...f }), {});
}
