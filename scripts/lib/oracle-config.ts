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
