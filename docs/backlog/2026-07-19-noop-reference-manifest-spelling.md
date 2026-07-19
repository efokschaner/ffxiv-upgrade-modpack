# `SetId` (and friends) manifest mismatches on no-op packs are baseline-suppressed, not confirmed

Filed: 2026-07-19 · Status: open

Surfaced while retiring the default-only-PMP option-prefix item (2026-07-19). That work dropped
`torn bassment glow.pmp`'s `/upgrade` baseline from 37 entries to 1 — and the survivor turned out to
be a **manifest value spelling** difference, not a layout one. Auditing for siblings found it is a
class, not a one-off.

**The shape.** Against a `/upgrade` NO-OP golden the harness compares our output to the **untouched
Penumbra input** (`corpus-upgrade.ts`, reason (b)). Penumbra writes some manipulation fields
loosely-typed; our writer normalizes them the TexTools way. For `torn bassment glow.pmp`:

    input: {"Type":"Eqp","Manipulation":{"Entry":16129,"SetId":"246","Slot":"Body"}}
    ours:  {"Type":"Eqp","Manipulation":{"Entry":16129,"SetId":246, "Slot":"Body"}}

That one is **confirmed benign**: ConsoleTools `/resave` on the same pack produces our spelling, and
its `/resave` baseline carries no manifest entry at all. So we match the real write-side oracle; only
the raw-input reference disagrees.

**Why this is still open.** There are **18 such entries across 4 packs, and only that one has been
checked against an oracle.** Census (2026-07-19, `test/corpus/.upgrade-baseline/`):

| pack | entries | golden |
|---|---|---|
| `torn bassment glow.pmp` | 1 | no-op — **verified benign via `/resave`** |
| `Flower Child - by Solona.pmp` | 1 | no-op — unverified |
| (baseline present, pack not in local corpus) | 1 | no-op — unverified |
| (baseline present, pack not in local corpus) | 15 | no-op — unverified |

All four are no-op packs, which is consistent with every one being the same raw-input artifact — but
consistency is not evidence. Per AGENTS.md, *"a divergence recorded only in a gitignored ratchet
baseline is not documented — the baseline suppresses a diff, it does not confirm one."* Seventeen of
these are exactly that.

**What to do.**

1. Check the remaining packs' entries against the `/resave` golden, the same way `torn bassment
   glow.pmp` was checked. That harness already runs per pack, so the evidence is cheap to get.
2. If they are all the same normalization, replace the baseline entries with a **confirmation** —
   ours must equal the golden once a documented, narrow coercion (a numeric string to its number) is
   applied, and reject anything else. The natural home is the manifest carve-out in
   `test/helpers/upgrade-archive-diff.ts`, alongside `stripOursPrefix` (which is the same idea for
   the layout half). Do not widen it to "any JSON scalar that stringifies equal" — that would absorb
   a genuine type confusion in a manipulation field.
3. If any entry is NOT that shape, it is a real writer divergence and gets its own item.

**Related.** [`2026-07-18-empty-vs-omitted-fileswaps-key.md`](2026-07-18-empty-vs-omitted-fileswaps-key.md)
is the same family — a manifest difference visible only against a raw Penumbra export — and worth
resolving in the same pass. The two "pack not in local corpus" rows are also stranded-baseline
instances of [`2026-07-14-orphaned-baseline-cache-entries.md`](2026-07-14-orphaned-baseline-cache-entries.md);
re-supplying those packs is a prerequisite for verifying their 16 entries at all.
