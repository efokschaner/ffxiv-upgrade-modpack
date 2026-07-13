import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { withConsoleToolsLock } from "./helpers/oracle";

const dir = mkdtempSync(join(tmpdir(), "ctlock-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("withConsoleToolsLock", () => {
  it("runs the body and releases the lock afterward", () => {
    const lock = join(dir, "a.lock");
    const out = withConsoleToolsLock(() => 42, { lockPath: lock });
    expect(out).toBe(42);
    expect(existsSync(lock)).toBe(false);
  });

  it("releases the lock even when the body throws", () => {
    const lock = join(dir, "b.lock");
    expect(() =>
      withConsoleToolsLock(
        () => {
          throw new Error("boom");
        },
        { lockPath: lock },
      ),
    ).toThrow("boom");
    expect(existsSync(lock)).toBe(false);
  });

  it("breaks a stale lock rather than deadlocking", () => {
    const lock = join(dir, "c.lock");
    // Simulate a crashed holder: a lock file with an mtime far in the past.
    withConsoleToolsLock(
      () => {
        // Nested acquisition of the SAME path with a zero stale window must break in and succeed,
        // proving the staleness path works without waiting out the real timeout.
        const inner = withConsoleToolsLock(() => "broke-in", {
          lockPath: lock,
          staleMs: 0,
          timeoutMs: 1000,
        });
        expect(inner).toBe("broke-in");
      },
      { lockPath: lock },
    );
  });
});
