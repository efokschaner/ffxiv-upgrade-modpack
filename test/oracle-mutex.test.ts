import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { withConsoleToolsLock } from "./helpers/oracle";

// `node:fs`'s ESM namespace isn't spy-able in place (vi.spyOn throws "Module namespace is not
// configurable"), so failure injection for the disk-full test below goes through vi.mock instead.
// Shared, mutable, and reset per-test so it only affects the one test that opts in.
const writeFileSyncFailures = vi.hoisted(() => ({ left: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: (
      ...args: Parameters<typeof actual.writeFileSync>
    ): ReturnType<typeof actual.writeFileSync> => {
      if (writeFileSyncFailures.left > 0) {
        writeFileSyncFailures.left--;
        throw new Error("ENOSPC: simulated disk full, write");
      }
      return actual.writeFileSync(...args);
    },
  };
});

const dir = mkdtempSync(join(tmpdir(), "ctlock-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  writeFileSyncFailures.left = 0;
});

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

  it("cleans up its own orphan lock after a failed token write, instead of leaving an unbreakable empty lock behind", () => {
    const lock = join(dir, "g.lock");
    // Simulate openSync succeeding but the token write failing (e.g. disk full): fail the
    // FIRST writeFileSync call only (the token write), then let the retry's write through.
    writeFileSyncFailures.left = 1;
    // A short timeoutMs against the default (10-minute) staleMs: if the failed write's empty
    // lock file were left behind (age ≈ 0, not stale), every retry — including our own — would
    // be stuck waiting out the full staleMs and this would time out well before that.
    const out = withConsoleToolsLock(() => "recovered", {
      lockPath: lock,
      staleMs: 10 * 60 * 1000,
      timeoutMs: 2000,
    });
    expect(out).toBe("recovered");
    expect(existsSync(lock)).toBe(false);
  });

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
