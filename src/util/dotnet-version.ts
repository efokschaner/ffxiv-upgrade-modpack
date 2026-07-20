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
 * .NET's `Version.TryParse` splits the input on `'.'` and requires 2 to 4 components
 * (`major.minor[.build[.revision]]`); any other count fails. A failed parse leaves `ver` null, so
 * the `??=` supplies `new Version("1.0")`, i.e. `"1.0"`.
 * `Version.ToString()` re-renders exactly the components that were present in the parsed value,
 * each as a plain integer — `"1.2"` stays 2-field, `"1.2.3"` stays 3-field — it does NOT pad to 4
 * fields and does NOT preserve a component's original spelling (so `"01.2"` renders `"1.2"`).
 *
 * Each component goes through `Version.ParseComponent`, which is
 * `int.TryParse(component, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)` followed by
 * a `v < 0` rejection. That contract, spelled out because it is wider than it looks:
 * - `NumberStyles.Integer` = `AllowLeadingWhite | AllowTrailingWhite | AllowLeadingSign`. So a
 *   component may be surrounded by whitespace (`"1 . 2"` parses) and may carry a LEADING sign
 *   (`"+1.2"` parses). It permits no decimal point, no thousands separator, and no TRAILING sign.
 * - .NET's number parser also allows whitespace BETWEEN the sign and the digits: its leading-white
 *   state stays open after a sign for non-currency parses whose `NumberNegativePattern != 2`, and
 *   InvariantCulture's is 1. So `"+ 1.2"` parses too.
 * - "Whitespace" to that parser is `Number.IsWhite`: `0x20` or `0x09..0x0D` — NOT JS's `\s`, which
 *   additionally matches NBSP, the Unicode space separators and BOM. The character class below is
 *   written out longhand for exactly that reason: a U+00A0-prefixed component falls back.
 * - Digits are ASCII `0-9` only, with any number of leading zeros; `int.TryParse` FAILS on a value
 *   outside Int32, so `"1234567890123.2"` falls back rather than passing through.
 * - A leading `-` parses fine as a negative int and is then rejected by `v < 0` — with the single
 *   exception of `"-0"`, which parses to `0` and is NOT `< 0`, so .NET accepts it and renders `0`. */

/** `[white][sign][white]digits[white]`, per the `NumberStyles.Integer` contract above. */
const COMPONENT = /^[ \t\n\v\f\r]*([+-]?)[ \t\n\v\f\r]*([0-9]+)[ \t\n\v\f\r]*$/;
const INT32_MAX = 2147483647;

/** `Version.ParseComponent`: `int.TryParse(..., NumberStyles.Integer, InvariantCulture)` then
 *  reject `< 0`. Returns the parsed value, or `undefined` if either step fails. */
function parseComponent(component: string): number | undefined {
  const m = COMPONENT.exec(component);
  if (!m) return undefined;
  // Leading zeros are consumed by the parser without counting toward the value's magnitude.
  const digits = m[2]!.replace(/^0+(?=[0-9])/, "");
  const negative = m[1] === "-";
  // int.TryParse overflow. Int32.MinValue is -2147483648, one further out than Int32.MaxValue.
  if (digits.length > 10) return undefined;
  const magnitude = Number(digits);
  if (magnitude > (negative ? INT32_MAX + 1 : INT32_MAX)) return undefined;
  // `v < 0` — true for every negative except "-0", which parses to plain 0.
  if (negative && magnitude !== 0) return undefined;
  return magnitude;
}

export function reformatDotnetVersion(source: string): string {
  const parts = source.split(".");
  if (parts.length < 2 || parts.length > 4) return "1.0";
  const parsed: number[] = [];
  for (const part of parts) {
    const value = parseComponent(part);
    if (value === undefined) return "1.0";
    parsed.push(value);
  }
  return parsed.join(".");
}
