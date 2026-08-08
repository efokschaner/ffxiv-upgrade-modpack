/** .NET's round-trip date format, as `PMP.WritePmp` stamps it:
 *
 *     pmp.Meta.LastWrite = DateTime.Now.ToString("O", CultureInfo.InvariantCulture);   // PMP.cs:941
 *
 * `"O"` for a `DateTime` is `yyyy-MM-ddTHH:mm:ss.fffffffK`, and `DateTime.Now` is LOCAL, so `K`
 * renders a `±HH:mm` offset. A real v4 golden reads `2026-08-06T04:41:11.0160172-07:00`
 * (test/corpus/.resave-cache, 2026-08-06).
 *
 * DIVERGENCE, documented rather than hidden: .NET's `DateTime` has 100-nanosecond ticks and JS's
 * `Date` resolves to milliseconds, so our last four fractional digits are always `0000`. That is an
 * honest representation of the clock we actually have, not fabricated precision — and the value can
 * never match a golden anyway (TexTools re-stamps it every write), which is why the harness confirms
 * this field's SHAPE rather than its value (test/helpers/pmp-v4-nondeterminism.ts).
 *
 * `Intl`/locale plays no part: `"O"` is culture-invariant by definition, and every component below
 * is formatted arithmetically. */
export function dotnetRoundTripLocal(d: Date): string {
  const pad = (n: number, width = 2): string =>
    String(Math.abs(n)).padStart(width, "0");
  // getTimezoneOffset() is minutes WEST of UTC (positive for UTC-7); .NET's K is signed the other
  // way, so negate.
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}0000` +
    `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`
  );
}
