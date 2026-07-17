import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isGenuineUpgradeError,
  OracleUpgradeError,
  oracleKey,
  traceListenerConfigured,
  UPGRADE_TRACE_LOG,
} from "./oracle";
import { upgradeGoldenCached } from "./upgrade-golden";

// A real captured /upgrade failure trace (install-dir CWD): contains the HandleUpgrade frame.
const REAL_ERROR_TRACE = [
  'Native library pre-loader is trying to load native SQLite library "...\\x64\\SQLite.Interop.dll"...',
  "System.IO.InvalidDataException: Cannot upgrade modpack - Highlight/Visibility options are unresolveable either due to missing files or too much complexity.",
  "Try installing the modpack and creating an updated pack from the desired options.",
  "   at xivModdingFramework.Mods.ModpackUpgrader.<ResolveHighlightOptionsAndMashupHair>d__5.MoveNext()",
  "   at ConsoleTools.ConsoleTools.<HandleUpgrade>d__7.MoveNext()",
].join("\n");

// SQLite noise only (a successful upgrade's non-fatal async LoadShaderInfo failure) — no HandleUpgrade.
const NOISE_ONLY_TRACE =
  "SQLite error (14): os_win.c:50673: winOpen(...shader_info.db) - The system cannot find the path specified.";

describe("isGenuineUpgradeError", () => {
  it("is true for a trace with the HandleUpgrade caught-exception frame", () => {
    expect(isGenuineUpgradeError(REAL_ERROR_TRACE)).toBe(true);
  });
  it("is false for LoadShaderInfo SQLite noise alone", () => {
    expect(isGenuineUpgradeError(NOISE_ONLY_TRACE)).toBe(false);
  });
  it("is false for empty trace", () => {
    expect(isGenuineUpgradeError("")).toBe(false);
  });
});

describe("traceListenerConfigured", () => {
  // The real expected path (homedir-derived); the value is arbitrary to the pure predicate — it
  // just has to match between the config fixture and the expected arg — so use the actual constant
  // rather than a machine-specific literal.
  const path = UPGRADE_TRACE_LOG;
  it("is true when a TextWriterTraceListener writes to the expected path", () => {
    const cfg = `<add name="x" type="System.Diagnostics.TextWriterTraceListener" initializeData="${path}" />`;
    expect(traceListenerConfigured(cfg, path)).toBe(true);
  });
  it("is false when the listener is absent", () => {
    expect(traceListenerConfigured("<configuration/>", path)).toBe(false);
  });
  it("is false when it points at a different path", () => {
    // A path that does NOT contain `path` as a substring (the predicate is a substring check).
    const cfg = `<add type="System.Diagnostics.TextWriterTraceListener" initializeData="/some/other/trace.log" />`;
    expect(traceListenerConfigured(cfg, path)).toBe(false);
  });
});

describe("upgradeGoldenCached — error classification", () => {
  it("caches an OracleUpgradeError as { kind: 'error' } and does not re-invoke the producer", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([1, 2, 3]);
    let calls = 0;
    const produce = (): Uint8Array | null => {
      calls++;
      throw new OracleUpgradeError(
        "Highlight/Visibility options are unresolveable",
      );
    };
    const first = upgradeGoldenCached("m.pmp", input, {
      dir,
      available: true,
      produce,
    });
    expect(first?.kind).toBe("error");
    expect(first).toMatchObject({
      message: expect.stringContaining("unresolveable"),
    });
    expect(calls).toBe(1);
    const second = upgradeGoldenCached("m.pmp", input, {
      dir,
      available: true,
      produce,
    });
    expect(second?.kind).toBe("error");
    expect(calls).toBe(1);
  });

  it("propagates any non-OracleUpgradeError (harness bug / lock-race) without caching", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([42]);
    const produce = (): Uint8Array | null => {
      throw new Error("Command failed / lock race");
    };
    expect(() =>
      upgradeGoldenCached("m.pmp", input, { dir, available: true, produce }),
    ).toThrow(/lock race/);
    const key = oracleKey(input);
    expect(existsSync(join(dir, `${key}.error`))).toBe(false);
  });

  it("still returns noop and leaves no .bin on error", () => {
    const dir = mkdtempSync(join(tmpdir(), "ug-"));
    const noop = upgradeGoldenCached("m.pmp", new Uint8Array([9]), {
      dir,
      available: true,
      produce: () => null,
    });
    expect(noop?.kind).toBe("noop");
    const dir2 = mkdtempSync(join(tmpdir(), "ug-"));
    const input = new Uint8Array([1]);
    upgradeGoldenCached("m.pmp", input, {
      dir: dir2,
      available: true,
      produce: () => {
        throw new OracleUpgradeError("boom");
      },
    });
    expect(readdirSync(dir2).some((f) => f === `${oracleKey(input)}.bin`)).toBe(
      false,
    );
  });
});
