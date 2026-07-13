export type JsonDiffStatus = "added" | "removed" | "mismatch";
export interface JsonPointerDiff {
  pointer: string;
  status: JsonDiffStatus;
}

/** RFC 6901: '~' -> '~0', '/' -> '~1'. Order matters ('~' first). */
function escapeToken(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * Structural diff of two parsed JSON documents, one entry per differing JSON pointer.
 *
 * Replaces the whole-document deep-equal that `diffArchives` used to do. That granularity was a
 * ratchet hazard, not a cosmetic one: a baseline records (kind, gamePath, index, status), so a
 * document blessed as `mismatch` swallowed every FUTURE difference in the same document — which is
 * exactly how a missing `Files` key hid behind an unrelated `Version` difference. One diff per
 * pointer means each accepted difference is pinned individually and nothing else can hide under it.
 *
 * Orientation matches diffUpgrade/diffArchives: golden-only => "added", ours-only => "removed".
 * A node whose TYPE differs is a single `mismatch` at that node; we do not descend into it (the
 * children of an array and of an object are not comparable, so per-child diffs would be noise).
 */
export function jsonPointerDiff(
  ours: unknown,
  golden: unknown,
  pointer = "",
): JsonPointerDiff[] {
  if (kindOf(ours) !== kindOf(golden)) {
    return [{ pointer, status: "mismatch" }];
  }
  if (Array.isArray(ours) && Array.isArray(golden)) {
    const out: JsonPointerDiff[] = [];
    const n = Math.max(ours.length, golden.length);
    for (let i = 0; i < n; i++) {
      const p = `${pointer}/${i}`;
      if (i >= ours.length) out.push({ pointer: p, status: "added" });
      else if (i >= golden.length) out.push({ pointer: p, status: "removed" });
      else out.push(...jsonPointerDiff(ours[i], golden[i], p));
    }
    return out;
  }
  if (isObj(ours) && isObj(golden)) {
    const keys = [
      ...new Set([...Object.keys(ours), ...Object.keys(golden)]),
    ].sort();
    const out: JsonPointerDiff[] = [];
    for (const k of keys) {
      const p = `${pointer}/${escapeToken(k)}`;
      const inOurs = Object.hasOwn(ours, k);
      const inGolden = Object.hasOwn(golden, k);
      if (!inOurs) out.push({ pointer: p, status: "added" });
      else if (!inGolden) out.push({ pointer: p, status: "removed" });
      else out.push(...jsonPointerDiff(ours[k], golden[k], p));
    }
    return out;
  }
  return ours === golden ? [] : [{ pointer, status: "mismatch" }];
}
