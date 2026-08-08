# 9. `/upgrade` reports success and a destination path it never wrote

**Status:** **worked around** · **Where:** `ConsoleTools/Program.cs:181,188` + `ModpackUpgrader.cs:244`

When the upgrade produces no changes, `rewriteOnNoChanges` is `false`, so **no output file is
written** — but the CLI still prints `"Upgraded Modpack saved to: {dest}"` and returns exit code
`0`. A caller that trusts either signal gets a path to a nonexistent file.

**Us:** the golden harness treats "exit 0 but no file on disk" as the no-op outcome and caches a
`<sha256>.noop` marker (`test/helpers/upgrade-golden.ts`); the pack is then compared against its own
input.

**Upstream fix:** only print the success line when a file was actually written, and/or report the
no-op distinctly.
