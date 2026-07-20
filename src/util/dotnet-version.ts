/** The .NET `System.Version` round-trip primitive: `Version.TryParse(s, out var ver);
 * ver ??= new Version("1.0"); return ver.ToString();`
 *
 * NOT A PORT OF ANY ONE C# SYMBOL — this is the BCL behaviour the framework leans on, shared here
 * because two different TexTools writers each perform that same round-trip on their own pack
 * version. Each CALL SITE carries its own `file · symbol · lines` citation for the logic that
 * invokes this; only the .NET contract itself lives here. (AGENTS.md forbids blending logic from
 * different C# symbols into one module; factoring out a framework primitive both call sites use is
 * not blending — the callers' logic stays with the callers.)
 *
 * Current call sites:
 * - `WizardData.cs · WritePmp · 1474-1475` + `:1494` (meta.json `Version`), via `src/container/pmp.ts`.
 * - `WizardData.cs · WriteWizardPack · 1335-1337` (the `ModPackData.Version` the TTMPWriter ctor
 *   stringifies at `TTMPWriter.cs · TTMPWriter · 61-69`), via `src/container/ttmp2.ts`.
 *
 * .NET's `Version.TryParse` requires AT LEAST `major.minor` — a bare `"1"` FAILS to parse — and
 * accepts up to 4 dot-separated non-negative-integer components (`major.minor[.build[.revision]]`);
 * anything else (blank, extra text, a negative/non-numeric component) fails too. A failed parse
 * leaves `ver` null, so the `??=` supplies `new Version("1.0")`, i.e. `"1.0"`.
 * `Version.ToString()` re-renders exactly the components that were present in the parsed value —
 * `"1.2"` stays 2-field, `"1.2.3"` stays 3-field, etc. — it does NOT pad to 4 fields. */
export function reformatDotnetVersion(source: string): string {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(source.trim());
  if (!m) return "1.0";
  return [m[1], m[2], m[3], m[4]].filter((p) => p !== undefined).join(".");
}
