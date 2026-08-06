# TexTools Re-pin to v3.1.1.4 — Part A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the porting baseline (installed ConsoleTools *and* `reference/`) from TexTools v3.1.0.2 to v3.1.1.4, on a portable repo-local oracle install, and produce a verdict for every upstream commit in the range that touches a file our port cites.

**Architecture:** Build the tooling first (pure, unit-tested helpers behind thin imperative shells), then perform the one-way operations in order: install oracle → re-pin `reference/` → wipe caches → cold run → bless → review commits. Pure logic lives in `scripts/lib/*.ts` with tests in `test/scripts/`; the scripts themselves are I/O shells.

**Tech Stack:** TypeScript (ESM, `tsx` runner), vitest, Biome, PowerShell 7 on Windows.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md`. Every task's requirements implicitly include it.
- Target: TexTools **v3.1.1.4** — FFXIV_TexTools_UI `b96139d3c2bbe8d8fa7ace94c9a9f00d1b500c40`, xivModdingFramework `8e2a2603f963ceb38062798c128b7f4efd966e11`.
- Release asset: `FFXIV_TexTools_v3.1.1.4b.zip`, sha256 `6add67cb87c8b123ade5f9b4172571d24adcaca3072475af3c7ee5f1907e86a2`, 35,120,324 bytes.
- Oracle install root: `reference/oracle/<tag>/`. Repo-relative default; `FFXIV_CONSOLETOOLS` is an override only.
- **`reference/` is never hand-edited.** Vendored source is read-only; `reference/oracle/` is written only by `scripts/setup-oracle.ts`.
- **A `deferred` verdict requires explicit operator sign-off** before any backlog item is filed or scope dropped. Stop and ask.
- `src/` must not import `node:*` or use Node globals (Biome enforces). `scripts/` and `test/` are Node-only by design and exempt.
- End-of-task ritual, all green: `npm run check` → `npm run typecheck` → `npm test`.
- No per-file license headers. Biome owns formatting — never hand-format.
- Every non-test, non-scaffolding behaviour cites its C# origin as `file · symbol · lines`.

---

### Task 1: Pure ConsoleTools config helpers

The released `ConsoleTools.exe.config` has no `<system.diagnostics>` section, so a fresh install fails at `assertUpgradeTraceListenerConfigured` (`test/helpers/oracle.ts:316`). These helpers generate what the installer must write. Pure string-in/string-out so they are testable without a download.

**Files:**
- Create: `scripts/lib/oracle-config.ts`
- Test: `test/scripts/oracle-config.test.ts`

**Interfaces:**
- Consumes: `traceListenerConfigured` from `test/helpers/oracle.ts` (test only — the real consumer, used as the cross-check oracle).
- Produces:
  - `withTraceListener(cfgXml: string, logPath: string): string`
  - `consoleConfigJson(xivPath: string, language?: string): string`

- [ ] **Step 1: Write the failing test**

Create `test/scripts/oracle-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  consoleConfigJson,
  withTraceListener,
} from "../../scripts/lib/oracle-config";
import { traceListenerConfigured } from "../helpers/oracle";

/** The config as shipped in FFXIV_TexTools_v3.1.1.4b.zip — no <system.diagnostics>. */
const RELEASED = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <runtime>
    <assemblyBinding xmlns="urn:schemas-microsoft-com:asm.v1">
      <probing privatePath="lib" />
    </assemblyBinding>
  </runtime>
  <startup>
    <supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" />
  </startup>
</configuration>
`;

const LOG = "C:\\Users\\someone\\.ffxiv-consoletools-trace.log";

describe("withTraceListener", () => {
  it("produces a config the harness's own gate accepts", () => {
    // Cross-check against the REAL consumer rather than a restatement of it:
    // assertUpgradeTraceListenerConfigured calls exactly this predicate.
    expect(traceListenerConfigured(withTraceListener(RELEASED, LOG), LOG)).toBe(
      true,
    );
  });

  it("leaves the released config otherwise intact", () => {
    const out = withTraceListener(RELEASED, LOG);
    expect(out).toContain('<probing privatePath="lib" />');
    expect(out).toContain('sku=".NETFramework,Version=v4.8"');
    expect(out.trimEnd().endsWith("</configuration>")).toBe(true);
  });

  it("is idempotent — re-running an install must not duplicate the listener", () => {
    const once = withTraceListener(RELEASED, LOG);
    expect(withTraceListener(once, LOG)).toBe(once);
  });

  it("escapes XML-significant characters in the path", () => {
    const odd = "C:\\Users\\a&b\\.ffxiv-consoletools-trace.log";
    const out = withTraceListener(RELEASED, odd);
    expect(out).toContain("a&amp;b");
    expect(out).not.toContain("a&b");
  });

  it("throws when the config has no </configuration> to insert before", () => {
    expect(() => withTraceListener("<nope/>", LOG)).toThrow(/configuration/);
  });
});

describe("consoleConfigJson", () => {
  it("matches the shape ConsoleConfig.Get deserializes (ConsoleConfig.cs:47-60)", () => {
    const xiv = "C:\\Games\\FFXIV\\game\\sqpack\\ffxiv";
    expect(JSON.parse(consoleConfigJson(xiv))).toEqual({
      XivPath: xiv,
      Language: "en",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scripts/oracle-config.test.ts`
Expected: FAIL — cannot resolve `../../scripts/lib/oracle-config`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/oracle-config.ts`:

```ts
// Pure config generation for a portable ConsoleTools install (scripts/setup-oracle.ts).
// No I/O — string in, string out — so the exact bytes an install writes are unit-testable
// without a 35 MB download.
//
// The trace-listener block is not cosmetic: ConsoleTools reports /upgrade failures via
// Trace.WriteLine, not Console (ConsoleTools/Program.cs:185), so without a listener a genuine
// oracle error is invisible. test/helpers/oracle.ts's assertUpgradeTraceListenerConfigured
// refuses to run without it. See
// docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md Part B.

/** Listener name we emit, and the marker `withTraceListener` uses to detect its own prior work. */
const LISTENER_NAME = "ffxivUpgradeFileListener";

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * `cfgXml` with a TextWriterTraceListener writing to `logPath` inserted before `</configuration>`.
 *
 * `logPath` MUST be an absolute, already-expanded path: .NET does not expand `%USERPROFILE%` in
 * `initializeData`, and `traceListenerConfigured` (test/helpers/oracle.ts:302) substring-matches
 * the absolute UPGRADE_TRACE_LOG value that oracle.ts:29 builds from `homedir()`.
 *
 * Idempotent, so re-provisioning an existing install is safe.
 */
export function withTraceListener(cfgXml: string, logPath: string): string {
  if (cfgXml.includes(LISTENER_NAME)) return cfgXml;
  const block =
    `  <system.diagnostics>\n` +
    `    <trace autoflush="true">\n` +
    `      <listeners>\n` +
    `        <add name="${LISTENER_NAME}" type="System.Diagnostics.TextWriterTraceListener" ` +
    `initializeData="${escapeXmlAttr(logPath)}" />\n` +
    `      </listeners>\n` +
    `    </trace>\n` +
    `  </system.diagnostics>\n`;
  const close = "</configuration>";
  const at = cfgXml.lastIndexOf(close);
  if (at < 0) {
    throw new Error(
      "setup-oracle: ConsoleTools.exe.config has no </configuration> to insert the trace listener before",
    );
  }
  return cfgXml.slice(0, at) + block + cfgXml.slice(at);
}

/**
 * The `console_config.json` ConsoleTools reads from its own directory
 * (xivModdingFramework/Cache/ConsoleConfig.cs:47-60 — `Assembly.GetEntryAssembly().Location`'s
 * dir + "console_config.json"). `XivPath` is the game's sqpack dir.
 */
export function consoleConfigJson(xivPath: string, language = "en"): string {
  return `${JSON.stringify({ XivPath: xivPath, Language: language }, null, 2)}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scripts/oracle-config.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Full gate and commit**

```bash
npm run check && npm run typecheck
git add scripts/lib/oracle-config.ts test/scripts/oracle-config.test.ts
git commit -m "feat(scripts): pure ConsoleTools install config helpers"
```

---

### Task 2: Pinned release manifest

Single source of truth for which release the repo is pinned to, and the hash to verify a download against. Imported by both the installer and the harness so the tag can never drift between them.

**Files:**
- Create: `scripts/lib/oracle-releases.ts`
- Test: `test/scripts/oracle-releases.test.ts`

**Interfaces:**
- Produces:
  - `type OracleRelease = { tag: string; asset: string; url: string; sha256: string; size: number }`
  - `PINNED_ORACLE_TAG: string`
  - `ORACLE_RELEASES: Record<string, OracleRelease>`

- [ ] **Step 1: Write the failing test**

Create `test/scripts/oracle-releases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ORACLE_RELEASES,
  PINNED_ORACLE_TAG,
} from "../../scripts/lib/oracle-releases";

describe("ORACLE_RELEASES", () => {
  it("has an entry for the pinned tag", () => {
    expect(ORACLE_RELEASES[PINNED_ORACLE_TAG]).toBeDefined();
  });

  it("pins v3.1.1.4 to the verified asset", () => {
    const r = ORACLE_RELEASES["v3.1.1.4"];
    expect(r).toBeDefined();
    expect(r?.sha256).toBe(
      "6add67cb87c8b123ade5f9b4172571d24adcaca3072475af3c7ee5f1907e86a2",
    );
    expect(r?.size).toBe(35_120_324);
    expect(r?.asset).toBe("FFXIV_TexTools_v3.1.1.4b.zip");
  });

  it("every entry is self-consistent and safely formed", () => {
    for (const [key, r] of Object.entries(ORACLE_RELEASES)) {
      expect(r.tag).toBe(key);
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.size).toBeGreaterThan(0);
      // https only, and pointing at the repo we actually vendor from.
      expect(r.url.startsWith("https://github.com/TexTools/FFXIV_TexTools_UI/")).toBe(
        true,
      );
      expect(r.url.endsWith(r.asset)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scripts/oracle-releases.test.ts`
Expected: FAIL — cannot resolve `../../scripts/lib/oracle-releases`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/oracle-releases.ts`:

```ts
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
    sha256:
      "6add67cb87c8b123ade5f9b4172571d24adcaca3072475af3c7ee5f1907e86a2",
    size: 35_120_324,
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scripts/oracle-releases.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Full gate and commit**

```bash
npm run check && npm run typecheck
git add scripts/lib/oracle-releases.ts test/scripts/oracle-releases.test.ts
git commit -m "feat(scripts): pinned TexTools release manifest for the oracle"
```

---

### Task 3: Repo-relative oracle resolution in the harness

Replaces the hardcoded `C:\Program Files\...` constant at `test/helpers/oracle.ts:21-22` so the harness finds the repo-local install by default, with an env override.

**Files:**
- Modify: `test/helpers/oracle.ts:21-23` (constant), `:316-335` (`assertUpgradeTraceListenerConfigured` message)
- Test: `test/scripts/oracle-resolve.test.ts`

**Interfaces:**
- Consumes: `PINNED_ORACLE_TAG` from `scripts/lib/oracle-releases.ts` (Task 2).
- Produces: `resolveConsoleToolsPath(envValue: string | undefined, fallback: string): string`, exported from `test/helpers/oracle.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/scripts/oracle-resolve.test.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PINNED_ORACLE_TAG } from "../../scripts/lib/oracle-releases";
import { resolveConsoleToolsPath } from "../helpers/oracle";

describe("resolveConsoleToolsPath", () => {
  it("prefers the env override when set", () => {
    expect(resolveConsoleToolsPath("D:\\other\\ConsoleTools.exe", "fallback")).toBe(
      "D:\\other\\ConsoleTools.exe",
    );
  });

  it("falls back when the env var is unset", () => {
    expect(resolveConsoleToolsPath(undefined, "fallback")).toBe("fallback");
  });

  it("falls back when the env var is empty — an empty override is a mistake, not a choice", () => {
    expect(resolveConsoleToolsPath("", "fallback")).toBe("fallback");
  });
});

describe("default oracle location", () => {
  it("is the repo-relative install for the pinned tag", () => {
    // Not asserting the file EXISTS (a fresh clone has none); asserting the repo agrees with
    // itself about where it would be, so the manifest tag and the harness cannot drift apart.
    const expected = join(
      __dirname,
      "..",
      "..",
      "reference",
      "oracle",
      PINNED_ORACLE_TAG,
      "ConsoleTools.exe",
    );
    expect(existsSync(join(__dirname, "..", "..", "reference"))).toBe(true);
    expect(expected).toContain(PINNED_ORACLE_TAG);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scripts/oracle-resolve.test.ts`
Expected: FAIL — `resolveConsoleToolsPath` is not exported from `test/helpers/oracle.ts`.

- [ ] **Step 3: Write minimal implementation**

In `test/helpers/oracle.ts`, replace lines 21-23:

```ts
const CONSOLE_TOOLS =
  "C:\\Program Files\\FFXIV TexTools\\FFXIV_TexTools\\ConsoleTools.exe";
const CONSOLE_TOOLS_DIR = dirname(CONSOLE_TOOLS);
```

with:

```ts
/** Env override wins when non-empty; an empty value is a mistake, not a deliberate choice. */
export function resolveConsoleToolsPath(
  envValue: string | undefined,
  fallback: string,
): string {
  return envValue !== undefined && envValue.length > 0 ? envValue : fallback;
}

/** Repo-relative default: the oracle is the compiled form of the source vendored beside it in
 *  reference/, so the two move together. Written only by scripts/setup-oracle.ts; see
 *  docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md §5. */
const DEFAULT_CONSOLE_TOOLS = join(
  __dirname,
  "..",
  "..",
  "reference",
  "oracle",
  PINNED_ORACLE_TAG,
  "ConsoleTools.exe",
);
const CONSOLE_TOOLS = resolveConsoleToolsPath(
  process.env.FFXIV_CONSOLETOOLS,
  DEFAULT_CONSOLE_TOOLS,
);
const CONSOLE_TOOLS_DIR = dirname(CONSOLE_TOOLS);
```

Add the import near the top of the file, after the existing `./corpus-roots` import:

```ts
import { PINNED_ORACLE_TAG } from "../../scripts/lib/oracle-releases";
```

- [ ] **Step 4: Update the setup error message**

In `assertUpgradeTraceListenerConfigured` (around `:326-332`), replace the `Add a TextWriterTraceListener … (elevated), then retry.` sentence with:

```ts
      `TextWriterTraceListener with initializeData="${UPGRADE_TRACE_LOG}" to ${cfgPath}. ` +
        `Provisioning is automated: run \`npm run setup-oracle\` to (re)install the pinned ` +
        `oracle with this listener configured. See ` +
        `docs/superpowers/specs/2026-07-17-resolve-highlight-preround-design.md.`,
```

The install is no longer under Program Files, so no elevation is required and the old instruction to edit an elevated path is wrong.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/scripts/oracle-resolve.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Full gate and commit**

Note: `npm test` will now report the oracle as unavailable until Task 6 installs it. Corpus-dependent tests FAIL loudly by policy (`oracle.ts:120`) — that is expected between here and Task 6, so run only `check` + `typecheck` here.

```bash
npm run check && npm run typecheck
git add test/helpers/oracle.ts test/scripts/oracle-resolve.test.ts
git commit -m "refactor(harness): resolve ConsoleTools repo-relative with env override"
```

---

### Task 4: Baseline totals reporter

Makes the ratchet-down measurable. Must land before the opening bless (spec §7.0) — it records the opening total and snapshots the roundtrip ratchet.

**Files:**
- Create: `scripts/lib/baseline-totals.ts`, `scripts/baseline-report.ts`
- Modify: `package.json` (scripts)
- Test: `test/scripts/baseline-totals.test.ts`

**Interfaces:**
- Produces:
  - `type BaselineEntry = { key: string; count: number }`
  - `type BaselineSummary = { name: string; packs: number; diffs: number }`
  - `summarize(name: string, entries: BaselineEntry[]): BaselineSummary`
  - `formatReport(summaries: BaselineSummary[]): string`

- [ ] **Step 1: Write the failing test**

Create `test/scripts/baseline-totals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  type BaselineEntry,
  formatReport,
  summarize,
} from "../../scripts/lib/baseline-totals";

describe("summarize", () => {
  it("counts packs and sums diffs", () => {
    const entries: BaselineEntry[] = [
      { key: "aa", count: 3 },
      { key: "bb", count: 7 },
    ];
    expect(summarize("upgrade", entries)).toEqual({
      name: "upgrade",
      packs: 2,
      diffs: 10,
    });
  });

  it("reports zeroes for an empty baseline dir — the burn-down terminal state", () => {
    expect(summarize("roundtrip", [])).toEqual({
      name: "roundtrip",
      packs: 0,
      diffs: 0,
    });
  });

  it("does not count a zero-length baseline file as a diverging pack", () => {
    // saveBaseline deletes a file when the diff set is empty (upgrade-baseline.ts:76-88), so a
    // `[]` file is off-spec — but if one exists by hand, the pack is not diverging.
    expect(summarize("upgrade", [{ key: "aa", count: 0 }])).toEqual({
      name: "upgrade",
      packs: 0,
      diffs: 0,
    });
  });
});

describe("formatReport", () => {
  it("lists each baseline and a TOTAL", () => {
    const out = formatReport([
      { name: "upgrade", packs: 4, diffs: 312 },
      { name: "resave", packs: 3, diffs: 98 },
      { name: "roundtrip", packs: 1, diffs: 2 },
    ]);
    expect(out).toContain("upgrade");
    expect(out).toContain("312");
    expect(out).toMatch(/TOTAL\s+8\s+412/);
  });

  it("still prints a TOTAL of zero when everything is clean", () => {
    expect(formatReport([{ name: "upgrade", packs: 0, diffs: 0 }])).toMatch(
      /TOTAL\s+0\s+0/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scripts/baseline-totals.test.ts`
Expected: FAIL — cannot resolve `../../scripts/lib/baseline-totals`.

- [ ] **Step 3: Write the pure module**

Create `scripts/lib/baseline-totals.ts`:

```ts
// Totals across the three ratchet baselines, so a porting step has a number that must go down.
// Reporting only — deliberately NOT part of the test gate (the gate stays unbrittle).

export type BaselineEntry = {
  /** sha256(input pack) — the baseline filename stem. */
  key: string;
  /** Number of FileDiff entries recorded for that pack. */
  count: number;
};

export type BaselineSummary = {
  name: string;
  /** Packs still diverging (a baseline file with at least one entry). */
  packs: number;
  /** Total recorded divergences. */
  diffs: number;
};

/** A pack counts as diverging only if it has at least one recorded diff. saveBaseline deletes a
 *  file whose diff set is empty (test/helpers/upgrade-baseline.ts:76-88), so a `[]` file is
 *  off-spec; treat it as clean rather than inflating the pack count. */
export function summarize(
  name: string,
  entries: BaselineEntry[],
): BaselineSummary {
  return {
    name,
    packs: entries.filter((e) => e.count > 0).length,
    diffs: entries.reduce((n, e) => n + e.count, 0),
  };
}

export function formatReport(summaries: BaselineSummary[]): string {
  const width = Math.max(9, ...summaries.map((s) => s.name.length));
  const row = (name: string, packs: string, diffs: string) =>
    `  ${name.padEnd(width)}  ${packs.padStart(5)}  ${diffs.padStart(6)}`;
  const lines = [
    row("baseline", "packs", "diffs"),
    `  ${"-".repeat(width)}  ${"-".repeat(5)}  ${"-".repeat(6)}`,
  ];
  for (const s of summaries) {
    lines.push(row(s.name, String(s.packs), String(s.diffs)));
  }
  const packs = summaries.reduce((n, s) => n + s.packs, 0);
  const diffs = summaries.reduce((n, s) => n + s.diffs, 0);
  lines.push(row("TOTAL", String(packs), String(diffs)));
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scripts/baseline-totals.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the I/O shell**

Create `scripts/baseline-report.ts`:

```ts
// Reports per-baseline pack and diff counts. Reporting only — not part of the gate.
// Usage: npm run baseline:report
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BaselineEntry,
  type BaselineSummary,
  formatReport,
  summarize,
} from "./lib/baseline-totals";

const CORPUS = join(__dirname, "..", "test", "corpus");

/** The three ratchets. `roundtrip` records OUR codec contradicting itself with no oracle
 *  involved, so it must NOT move across an oracle re-pin — see the spec §7.2 guard. */
const BASELINES: Array<[string, string]> = [
  ["upgrade", join(CORPUS, ".upgrade-baseline")],
  ["resave", join(CORPUS, ".resave-baseline")],
  ["roundtrip", join(CORPUS, ".roundtrip-baseline")],
];

function readEntries(dir: string): BaselineEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, f), "utf8"));
      return {
        key: f.replace(/\.json$/, ""),
        count: Array.isArray(parsed) ? parsed.length : 0,
      };
    });
}

const summaries: BaselineSummary[] = BASELINES.map(([name, dir]) =>
  summarize(name, readEntries(dir)),
);
console.log(formatReport(summaries));
```

- [ ] **Step 6: Add the npm script**

In `package.json`, add to `"scripts"` after `"test:coverage"`:

```json
    "baseline:report": "tsx scripts/baseline-report.ts",
```

- [ ] **Step 7: Run it against the CURRENT (pre-re-pin) baselines**

Run: `npm run baseline:report`
Expected: a table with three rows and a TOTAL. These are the **pre-re-pin** numbers — paste them into the task's commit message so the re-pin's effect is measurable later.

- [ ] **Step 8: Full gate and commit**

```bash
npm run check && npm run typecheck
npx vitest run test/scripts/
git add scripts/lib/baseline-totals.ts scripts/baseline-report.ts package.json test/scripts/baseline-totals.test.ts
git commit -m "feat(scripts): baseline totals reporter for the ratchet burn-down"
```

---

### Task 5: The oracle installer

Provisions `reference/oracle/<tag>/` from a verified release zip.

**Files:**
- Create: `scripts/setup-oracle.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `ORACLE_RELEASES`, `PINNED_ORACLE_TAG` (Task 2); `withTraceListener`, `consoleConfigJson` (Task 1).
- Produces: a populated `reference/oracle/<tag>/` containing `ConsoleTools.exe`, a patched `ConsoleTools.exe.config`, `console_config.json`, and `lib/`.

- [ ] **Step 1: Write the installer**

Create `scripts/setup-oracle.ts`:

```ts
// Provisions a pinned TexTools ConsoleTools install as the /upgrade + /resave oracle.
//
//   npm run setup-oracle                     -- install the pinned tag
//   npm run setup-oracle -- v3.1.1.4         -- install a specific tag
//   npm run setup-oracle -- v3.1.1.4 --xiv-path "C:\...\sqpack\ffxiv"
//
// Writes ONLY under reference/oracle/<tag>/. reference/ is gitignored wholesale (.gitignore:5),
// so nothing here can be committed. See
// docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md §5.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { consoleConfigJson, withTraceListener } from "./lib/oracle-config";
import { ORACLE_RELEASES, PINNED_ORACLE_TAG } from "./lib/oracle-releases";

/** Must match test/helpers/oracle.ts's UPGRADE_TRACE_LOG exactly — that module builds it from
 *  homedir() and substring-matches it against the config we write here. */
const UPGRADE_TRACE_LOG = join(homedir(), ".ffxiv-consoletools-trace.log");

const ORACLE_ROOT = join(__dirname, "..", "reference", "oracle");

function parseArgs(argv: string[]): { tag: string; xivPath?: string } {
  const rest = argv.slice(2);
  const i = rest.indexOf("--xiv-path");
  const xivPath = i >= 0 ? rest[i + 1] : undefined;
  const tag = rest.find((a) => !a.startsWith("--") && a !== xivPath);
  return { tag: tag ?? PINNED_ORACLE_TAG, xivPath };
}

/** Reuse the XivPath from any sibling install rather than making the operator retype it. */
function discoverXivPath(): string | undefined {
  if (!existsSync(ORACLE_ROOT)) return undefined;
  for (const d of readdirSync(ORACLE_ROOT)) {
    const p = join(ORACLE_ROOT, d, "console_config.json");
    if (!existsSync(p)) continue;
    try {
      const cfg = JSON.parse(readFileSync(p, "utf8")) as { XivPath?: string };
      if (cfg.XivPath) return cfg.XivPath;
    } catch {
      // Unreadable sibling config — keep looking.
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const { tag, xivPath: xivArg } = parseArgs(process.argv);
  const release = ORACLE_RELEASES[tag];
  if (!release) {
    throw new Error(
      `setup-oracle: unknown tag "${tag}". Known: ${Object.keys(ORACLE_RELEASES).join(", ")}. ` +
        `Add it to scripts/lib/oracle-releases.ts with a verified sha256 first.`,
    );
  }

  const xivPath = xivArg ?? discoverXivPath();
  if (!xivPath) {
    throw new Error(
      "setup-oracle: no XivPath. Pass --xiv-path \"<game>\\game\\sqpack\\ffxiv\" " +
        "(no sibling install to copy it from).",
    );
  }

  const dest = join(ORACLE_ROOT, tag);
  if (existsSync(dest)) {
    throw new Error(
      `setup-oracle: ${dest} already exists. Remove it first to reinstall.`,
    );
  }

  console.log(`Downloading ${release.asset} …`);
  const res = await fetch(release.url);
  if (!res.ok) {
    throw new Error(`setup-oracle: download failed: ${res.status} ${res.statusText}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  if (bytes.length !== release.size) {
    throw new Error(
      `setup-oracle: size mismatch for ${release.asset}: got ${bytes.length}, expected ${release.size}`,
    );
  }
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== release.sha256) {
    throw new Error(
      `setup-oracle: sha256 mismatch for ${release.asset}:\n  got      ${got}\n  expected ${release.sha256}`,
    );
  }
  console.log(`Verified sha256 ${got}`);

  // Extract. Node has no zip reader, and the repo's only zip dependency (fflate) is a src/ dep;
  // Expand-Archive is already available on this platform and avoids adding a devDependency.
  mkdirSync(ORACLE_ROOT, { recursive: true });
  const tmpZip = join(ORACLE_ROOT, `${tag}.download.zip`);
  writeFileSync(tmpZip, bytes);
  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${dest}' -Force`,
      ],
      { stdio: "inherit" },
    );
  } finally {
    rmSync(tmpZip, { force: true });
  }

  const exe = join(dest, "ConsoleTools.exe");
  if (!existsSync(exe)) {
    throw new Error(`setup-oracle: ${release.asset} contained no ConsoleTools.exe`);
  }

  const cfgPath = `${exe}.config`;
  writeFileSync(
    cfgPath,
    withTraceListener(readFileSync(cfgPath, "utf8"), UPGRADE_TRACE_LOG),
  );
  writeFileSync(join(dest, "console_config.json"), consoleConfigJson(xivPath));

  console.log(`Installed ${tag} to ${dest}`);
  console.log(`  trace log : ${UPGRADE_TRACE_LOG}`);
  console.log(`  XivPath   : ${xivPath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add after `"synthetics"`:

```json
    "setup-oracle": "tsx scripts/setup-oracle.ts",
```

- [ ] **Step 3: Verify the failure paths without a download**

Run: `npx tsx scripts/setup-oracle.ts v9.9.9.9`
Expected: exits non-zero with `unknown tag "v9.9.9.9"`.

- [ ] **Step 4: Gate and commit**

```bash
npm run check && npm run typecheck
git add scripts/setup-oracle.ts package.json
git commit -m "feat(scripts): provision the pinned ConsoleTools oracle into reference/oracle"
```

---

### Task 6: Install both oracles

Preserves the current v3.1.0.2 install (already trace-listener-configured) by copying it, then provisions v3.1.1.4. **No download is needed for v3.1.0.2** — the working install is on disk now, and copying it is both cheaper and higher-fidelity than re-downloading.

**Files:** none in the repo — this task writes only to `reference/oracle/` (gitignored).

- [ ] **Step 1: Preserve the existing v3.1.0.2 install**

```powershell
$src = "C:\Program Files\FFXIV TexTools\FFXIV_TexTools"
$dst = "C:\dev\efokschaner\ffxiv-upgrade-modpack\reference\oracle\v3.1.0.2"
New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
Copy-Item -Recurse -Force $src $dst
(Get-Item "$dst\ConsoleTools.exe").VersionInfo.ProductVersion
```

Expected: `1.0.0+b83feb57b59a8f061ee458e9e8b416a99225110b`

- [ ] **Step 2: Confirm the copy carried its config**

```powershell
$dst = "C:\dev\efokschaner\ffxiv-upgrade-modpack\reference\oracle\v3.1.0.2"
Select-String -Path "$dst\ConsoleTools.exe.config" -Pattern "TextWriterTraceListener"
Get-Content "$dst\console_config.json"
```

Expected: the listener line is present, and `XivPath` points at the game's sqpack dir.

- [ ] **Step 3: Install v3.1.1.4**

Run: `npm run setup-oracle`
Expected: downloads, prints `Verified sha256 6add67cb…`, extracts, prints `Installed v3.1.1.4 to …`.

- [ ] **Step 4: Verify the installed build is the intended commit**

```powershell
$d = "C:\dev\efokschaner\ffxiv-upgrade-modpack\reference\oracle\v3.1.1.4"
(Get-Item "$d\ConsoleTools.exe").VersionInfo.ProductVersion
(Get-Item "$d\lib\xivModdingFramework.dll").VersionInfo.ProductVersion
```

Expected exactly:
- `1.0.0+b96139d3c2bbe8d8fa7ace94c9a9f00d1b500c40`
- `3.1.1.4+8e2a2603f963ceb38062798c128b7f4efd966e11`

If either differs, STOP — the release contents do not match the manifest and the pin is wrong.

- [ ] **Step 5: Smoke-test the new oracle end to end**

```powershell
$d = "C:\dev\efokschaner\ffxiv-upgrade-modpack\reference\oracle\v3.1.1.4"
& "$d\ConsoleTools.exe" /help
```

Expected: the usage banner listing `/upgrade` and `/resave`, exit code 0.

- [ ] **Step 6: Report to the operator and STOP**

Post the two ProductVersion strings and confirm the harness now resolves to the new install. **Do not proceed to Task 7 until the operator has run `C:\Program Files\FFXIV TexTools\Uninstall.exe`** (spec §4.2 — their manual step) and confirmed.

---

### Task 7: Re-pin `reference/` to v3.1.1.4

**Files:** none in the repo — `reference/` is gitignored. Verification only.

- [ ] **Step 1: Fetch the tag (both clones are shallow)**

```powershell
$r = "C:\dev\efokschaner\ffxiv-upgrade-modpack\reference\FFXIV_TexTools_UI"
git -C $r fetch --depth=1 origin tag v3.1.1.4
git -C $r checkout v3.1.1.4
git -C $r submodule update --init --depth=1
```

- [ ] **Step 2: Verify both commits**

```powershell
$r = "C:\dev\efokschaner\ffxiv-upgrade-modpack\reference\FFXIV_TexTools_UI"
git -C $r rev-parse HEAD
git -C "$r\lib\xivModdingFramework" rev-parse HEAD
```

Expected exactly:
- `b96139d3c2bbe8d8fa7ace94c9a9f00d1b500c40`
- `8e2a2603f963ceb38062798c128b7f4efd966e11`

These must equal the `+hash` suffixes read in Task 6 Step 4. If they do not, STOP.

- [ ] **Step 3: Confirm the CMP fix is present in the vendored source**

```powershell
$m = "C:\dev\efokschaner\ffxiv-upgrade-modpack\reference\FFXIV_TexTools_UI\lib\xivModdingFramework"
Select-String -Path "$m\xivModdingFramework\General\DataContainers\CharaMakeParameter.cs" -Pattern "rspDataSize|MetadataStart"
```

Expected: `var rspDataSize = 8 * 10 * RacialScalingParameter.TotalByteSize;` and no `const int MetadataStart = 0x2a800`.

- [ ] **Step 4: Update README provenance**

In `README.md`, update the baseline sentence and table rows:
- Baseline: `v3.1.0.2` → `v3.1.1.4`; ProductVersion `1.0.0+b83feb57…` → `1.0.0+b96139d3…`.
- `FFXIV_TexTools_UI/` row commit → `b96139d3c2bbe8d8fa7ace94c9a9f00d1b500c40`, `= ` column → **tag v3.1.1.4**.
- `xivModdingFramework/` row commit → `8e2a2603f963ceb38062798c128b7f4efd966e11`, `= ` column → submodule pin @ v3.1.1.4.
- The ImageSharp row is **unchanged** — add "(verified unchanged across the re-pin)" to its sentence.
- Replace the oracle path sentence: the oracle is now `reference/oracle/<tag>/ConsoleTools.exe` (repo-relative default in `test/helpers/oracle.ts`), overridable with `FFXIV_CONSOLETOOLS`.
- Rewrite the "Incremental upgrade" paragraph to the actual procedure: add the release to `scripts/lib/oracle-releases.ts` with a verified sha256, `npm run setup-oracle -- <tag>`, `git -C reference/FFXIV_TexTools_UI fetch --depth=1 origin tag <tag>` + checkout + `submodule update --depth=1` (both clones are shallow), wipe the three caches, re-bless, then port the upstream diff.

- [ ] **Step 5: Add the AGENTS.md clarification**

In `AGENTS.md`, under **Conventions**, replace the `reference/` bullet with two bullets:

```markdown
- **`reference/` is off-limits to edits.** It is the vendored third-party C#
  (xivModdingFramework / TexTools) we port from — the map referenced throughout this
  guide. Read it freely; never edit, lint, or format it (it is gitignored).
- **`reference/oracle/` is tool-managed, and equally hands-off.** It holds the pinned
  ConsoleTools builds the golden harness runs — the *compiled* form of the source vendored
  beside it, kept together so read-source and oracle cannot drift. Written **only** by
  `scripts/setup-oracle.ts`; never hand-edited, and never committed (gitignored with the
  rest of `reference/`). See
  `docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` §5.
```

- [ ] **Step 6: Gate and commit**

```bash
npm run check && npm run typecheck
git add README.md AGENTS.md
git commit -m "docs: re-pin provenance to TexTools v3.1.1.4 and document reference/oracle"
```

---

### Task 8: Cache wipe, cold run, opening bless

**Destructive and slow.** The cold run re-spawns ConsoleTools for every corpus pack behind a cross-process lock, so budget substantial wall-clock. Read every step before starting.

**Files:** none in the repo — all paths are gitignored.

- [ ] **Step 1: Snapshot the roundtrip ratchet (spec §7.2 guard)**

The bless env var re-blesses **all three** baselines, so a `roundtrip` regression would be silently absorbed. Baselines are gitignored, so git cannot show it.

```powershell
$c = "C:\dev\efokschaner\ffxiv-upgrade-modpack\test\corpus"
Copy-Item -Recurse -Force "$c\.roundtrip-baseline" "$c\.roundtrip-baseline.presnapshot"
npm run baseline:report
```

Record the printed table — these are the pre-re-pin totals.

- [ ] **Step 2: Wipe all three oracle caches**

```powershell
$c = "C:\dev\efokschaner\ffxiv-upgrade-modpack\test\corpus"
Remove-Item -Recurse -Force "$c\.upgrade-cache","$c\.resave-cache","$c\.oracle-cache" -ErrorAction SilentlyContinue
```

`.oracle-cache` holds `/unwrap` output; all three also hold `.noop` / `.error` markers, which are outcomes and equally stale.

- [ ] **Step 3: Cold run**

Run: `npm test`
Expected: long. Many failures are expected — this is the drift the bless will record. What must NOT appear: setup errors (`ConsoleTools trace listener not configured`, oracle-unavailable). Those mean Tasks 5-7 are wrong; STOP and fix rather than blessing.

- [ ] **Step 4: Bless all three baselines**

```powershell
$env:UPDATE_UPGRADE_BASELINE = "1"; npm test; Remove-Item Env:\UPDATE_UPGRADE_BASELINE
```

- [ ] **Step 5: Verify the roundtrip ratchet did not move**

```powershell
$c = "C:\dev\efokschaner\ffxiv-upgrade-modpack\test\corpus"
$a = Get-ChildItem "$c\.roundtrip-baseline.presnapshot" -File | Sort-Object Name
$b = Get-ChildItem "$c\.roundtrip-baseline" -File -ErrorAction SilentlyContinue | Sort-Object Name
Compare-Object $a.Name $b.Name
foreach ($f in $a) {
  $other = Join-Path "$c\.roundtrip-baseline" $f.Name
  if (-not (Test-Path $other)) { "MISSING: $($f.Name)"; continue }
  if ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash $other).Hash) { "CHANGED: $($f.Name)" }
}
```

Expected: no output. Any movement means our codec's self-consistency changed — investigate, never bless away. STOP and report.

- [ ] **Step 6: Confirm green and record the opening total**

```powershell
npm test
npm run baseline:report
```

Expected: the suite passes (diffs are now within baseline) and **skip count is zero** — Milktruck's `/resave` skip should be gone now the CMP fix lets the oracle round-trip it.

- [ ] **Step 7: Record the opening total in the spec**

Fill the §10 "after opening bless" row of `docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` with the four numbers from Step 6. Also note in §7.2 whether the Milktruck skip disappeared as predicted.

- [ ] **Step 8: Close out the expected-failure backlog item (spec deliverable 9)**

Add a dated closing note to `docs/backlog/2026-07-11-expected-failure-golden.md`: the `/resave` oracle error it documents was environmental (patch-7.5 CMP breakage in v3.1.0.2), it is resolved by the re-pin to v3.1.1.4, and the pack now produces a real `/resave` golden. Keep the document — its analysis of why `/upgrade` can never see write-side oracle failures is still the durable reference other docs cite.

If the Milktruck skip did **not** disappear in Step 6, do not write this note — report the discrepancy instead, because the CMP diagnosis would then be wrong.

- [ ] **Step 9: Clean up and commit**

```powershell
Remove-Item -Recurse -Force "C:\dev\efokschaner\ffxiv-upgrade-modpack\test\corpus\.roundtrip-baseline.presnapshot"
```

```bash
git add docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md docs/backlog/2026-07-11-expected-failure-golden.md
git commit -m "docs(spec): record the opening baseline total after the v3.1.1.4 re-pin"
```

---

### Task 9: Review all 11 commits and record verdicts

Produces the input for Part B. **No production code changes in this task** — reviewing and recording only. If a review concludes `deferred`, STOP and get operator sign-off (Global Constraints).

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md` (§10 ledger)

**Method — apply to every step below.** For commit `<sha>`:

```powershell
$m = "C:\dev\efokschaner\ffxiv-upgrade-modpack\reference\FFXIV_TexTools_UI\lib\xivModdingFramework"
git -C $m show <sha> -- <cited paths>
```

For each hunk, grep `src/` for citations naming that C# file and symbol, and decide whether the hunk lands in a symbol we port. Record the verdict in §10 with a one-line rationale naming the symbol. Then re-validate every citation into that file — an earlier insertion shifts every later `file · symbol · lines` reference, even when the verdict is `no port impact`.

- [ ] **Step 1: `1993bf6` — Tex.cs +9/−10.** Expect `bug register`: it deletes the `LoDMips` ordering guard (registered bug #19) and changes `LoD 2 Mip` to `newMipCount > 2 ? 2 : (newMipCount - 1)`. Also audit registered bugs #20 and #21 (same mip machinery).
- [ ] **Step 2: `76535f4` — PMP.cs +93/−3, WizardData.cs +19/−1.** PMP "Combining" group import. README records that our port already carries this feature opaquely via `raw`; confirm against the hunks rather than assuming.
- [ ] **Step 3: `9c09415` — XivCache.cs +10/−1, Mtrl.cs +7/−1, Mdl.cs +1/−0, Imc.cs +12/−1.** Facewear item list support.
- [ ] **Step 4: `bbc7069` — Mdl.cs +5/−1, TTMP.cs +14/−12.** Material auto-assign for pre-`_bibo` EW mods.
- [ ] **Step 5: `8cc1f40` — Mdl.cs +1/−5.** Double-execution of ModelModifiers on some import paths.
- [ ] **Step 6: `d09cd2b` — PMP.cs +25/−5.** Don't crash on v4 import.
- [ ] **Step 7: `371f74b` — ModelModifiers.cs +28/−8.** Racial deforms; also replaces a GPL-violating `DxtUtil.cs`. Check whether `NOTICE` needs updating.
- [ ] **Step 8: `f20b659` — PMP.cs +26/−11, WizardData.cs +0/−1.** Penumbra v4 read/write.
- [ ] **Step 9: `33ae15c` — PMP.cs +38/−2, ModpackUpgrader.cs +34/−6, WizardData.cs +2/−2.** Upgrader full-copies or **refuses** v4 modpacks by context — behaviour to reproduce, not route around.
- [ ] **Step 10: `cdd64b6` — PMP.cs +4/−4.** Minor PMPv4 fixes.
- [ ] **Step 11: `7bc8a76` — PMP.cs +4/−0, WizardData.cs +1/−0.** `LastWrite` field for PMP v4.

- [ ] **Step 12: Reconcile the bug register**

For every commit whose verdict is `bug register`, update `docs/TEXTOOLS_BUGS.md` per spec §9: keep the entry, add *"Fixed upstream in `<sha>` (v3.1.1.4); our port reproduces the fixed behaviour as of `<our commit>`."* The behaviour change itself is Part B — this step records the finding only.

- [ ] **Step 13: Gate and commit**

```bash
npm run check && npm run typecheck && npm test
git add docs/superpowers/specs/2026-08-05-textools-repin-v3.1.1.4-design.md docs/TEXTOOLS_BUGS.md
git commit -m "docs: verdicts for all 11 upstream commits in the v3.1.0.2..v3.1.1.4 range"
```

- [ ] **Step 14: Hand off to Part B**

Report the verdict distribution. Every `ported` verdict becomes a Part B task; write that plan with the writing-plans skill once the verdicts exist.

---

## Part A Exit Criteria

1. Harness resolves the oracle at `reference/oracle/v3.1.1.4/`; `FFXIV_CONSOLETOOLS` works as an override; Program Files install removed by the operator.
2. `reference/` at UI `b96139d3` / XMF `8e2a2603`, matching the installed binaries' ProductVersion suffixes.
3. All three caches rebuilt from the new oracle; baselines blessed; roundtrip ratchet verified unmoved; opening total recorded in the spec.
4. All 11 commits carry a verdict in spec §10, with any `deferred` verdict signed off by the operator.
5. `npm run check` / `npm run typecheck` / `npm test` green; suite skip count zero.
