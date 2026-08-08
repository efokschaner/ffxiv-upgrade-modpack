# 6. Group-folder collision loop cannot terminate

**Status:** **gap** — we throw rather than hang · **Where:** `WizardData.cs:1425-1428` (see
`src/container/option-prefix.ts`, `makeGroupPrefix`)

The loop that de-collides duplicate group folder names never increments its counter `i`, so two
groups whose names sanitize to the same folder AND whose first retry (`" (1)/"`) also collides
would spin forever recomputing the same candidate. (The sibling loop in `MakeOptionPrefix`,
`:1467-1472`, increments correctly — see below.)

**Us:** ported the loop condition as written (a single retry at `" (1)/"` succeeds silently, matching
the C#), but if resolving the collision would need a second retry we throw, citing this entry,
instead of hanging. `optionPrefixes` is unit-tested (`test/container/option-prefix.test.ts`) and
called by `writePmp` (`src/container/pmp.ts`) to regenerate every zip path from the model.

**Upstream fix:** increment the counter.
