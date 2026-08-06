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
