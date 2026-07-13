import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

  it("does not delete another holder's lock when ours was broken as stale (ownership token)", () => {
    const lock = join(dir, "d.lock");
    withConsoleToolsLock(
      () => {
        // Simulate a second waiter concluding (wrongly, from a very slow run, or correctly,
        // from a real crash) that our lock is stale: it breaks it and re-acquires with its
        // own token while we are still "running" inside this body.
        rmSync(lock, { force: true });
        writeFileSync(lock, "other-holder-token");
      },
      { lockPath: lock },
    );
    // Our release must see the token no longer matches and must NOT unlink the new holder's
    // lock — deleting it here would let a third acquirer in while the second is still running.
    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(lock, "utf8")).toBe("other-holder-token");
  });

  it("honours the deadline even when statSync keeps failing for a non-vanished reason (busy-spin guard)", () => {
    // A lock path whose parent directory never exists: openSync always throws ENOENT (held/
    // uncreatable) and the subsequent statSync also always throws ENOENT — a persistent
    // failure, not the one-off TOCTOU race the inner catch was written for. A loop that
    // `continue`s past this without checking the deadline never terminates.
    const lock = join(dir, "missing-parent-dir", "e.lock");
    const start = Date.now();
    expect(() =>
      withConsoleToolsLock(() => "unreachable", {
        lockPath: lock,
        staleMs: 10 * 60 * 1000,
        timeoutMs: 200,
      }),
    ).toThrow(/Timed out after 200ms waiting for the ConsoleTools lock/);
    expect(Date.now() - start).toBeLessThan(5000);
  }, 15_000);

  it("throws an actionable error when timeoutMs elapses against a live, non-stale holder", () => {
    const lock = join(dir, "f.lock");
    // A lock file that looks freshly created (not stale) and that we deliberately never
    // release, simulating another live ConsoleTools run still holding it.
    writeFileSync(lock, "live-holder-token");
    expect(() =>
      withConsoleToolsLock(() => "unreachable", {
        lockPath: lock,
        staleMs: 10 * 60 * 1000,
        timeoutMs: 200,
      }),
    ).toThrow(/Timed out after 200ms waiting for the ConsoleTools lock/);
  });
});
