# `/resave` matched-failure capability — asserting a *ported refusal* against the oracle

Status: **implemented 2026-08-09** · Foundation roadmap:
[`2026-06-30-dawntrail-modpack-upgrader-design.md`](2026-06-30-dawntrail-modpack-upgrader-design.md)

## 1. Problem

`registerResaveCheck` (`test/helpers/corpus-resave.ts`) has exactly one response to a
`{ kind: "error" }` `/resave` golden: log loudly, mark the writer **UNVERIFIED**, `ctx.skip`. That is
the right response to the only such error the corpus had ever produced — `Milktruck Bust Scaling
Tweaks v1.0.0.ttmp2`, where TexTools' write path reads the *installed game's* `human.cmp` and throws
`CMP Format Changed`. Nothing about that failure is a property of the pack, so asserting we must fail
too would be meaningless.

But a `/resave` oracle error is not one thing. `Parent Settings.pmp` — a Penumbra feature-test pack
(`FileVersion 4`, 8 groups, 3 of them `Combining`, **zero payload files**), sourced from the official
TexTools/Penumbra dev Discord — makes the second kind concrete. Measured 2026-08-09 against the
pinned v3.1.1.4 oracle:

    System.IO.InvalidDataException: Editing or exporting PMP Combining groups is not supported.
       at xivModdingFramework.Mods.WizardGroupEntry.<ToPmpGroup>d__18.MoveNext()
       ...
       at xivModdingFramework.Mods.WizardData.<WritePmp>d__21.MoveNext()
       ...
       at xivModdingFramework.Mods.WizardData.<WriteModpack>d__15.MoveNext()
       at ConsoleTools.ConsoleTools.<HandleResaveModpack>d__8.MoveNext()

That is `WizardData.cs · WizardGroupEntry.ToPmpGroup · 897-900` — a **semantic refusal**, decided
entirely by the pack's bytes, and one this port already reproduces at the same seam
(`src/container/pmp.ts`'s `writePmp` group-assembly loop, whose thrown string is byte-identical to
the C# message). Our `writeModpack(d, "pmp")` throws exactly that. Both implementations refuse, for
the same reason, deterministically.

Under this repo's rules that is a **matched failure and therefore a PASS** — the same verdict
`assertMatchedUpgradeFailure` already gives on the `/upgrade` side. Today it is a *skip*, and worse,
it cannot even reach the skip: `corpus-resave.ts` calls `writeModpack` at `:44`, *before* fetching
the golden at `:46`, so our writer's throw escapes the `it()` as a test error and the
`result.kind === "error"` branch at `:53` is never entered at all. The pack cannot live in the corpus.

### 1.1 The asymmetry that must survive

| kind | example | correct outcome |
| --- | --- | --- |
| **environmental** | Milktruck — TexTools reading the installed game's `human.cmp` | loud skip, writer UNVERIFIED — **unchanged** |
| **semantic refusal** | the Combining refusal above | matched failure = **PASS** |

[`docs/backlog/2026-07-19-resave-oracle-error-skips-all-assertions.md`](../../backlog/2026-07-19-resave-oracle-error-skips-all-assertions.md)
is explicit that the item must **not** be closed by turning the skip into a blanket matched-failure
assertion, for exactly the Milktruck reason. This design does not do that. It adds a **second,
narrower branch in front** of the skip, entered only when a *declared rule* recognises the oracle's
trace; everything else falls through to today's behaviour byte-for-byte.

## 2. Decision: a declared rule table, not inference

Option A, chosen ahead of implementation. The harness never infers "this looks semantic". It matches
the oracle's captured trace against a committed registry, modelled on
`ORACLE_ERROR_DIVERGENCE_RULES` + `assertMatchedUpgradeFailure`
(`test/helpers/upgrade-compare.ts`, `test/helpers/corpus-upgrade.ts`).

Rejected alternatives:

- **Infer from the exception type** (`InvalidDataException` ⇒ semantic). Fragile and wrong in
  principle: TexTools throws `InvalidDataException` from environmental paths too, and the whole point
  of the register is that each accepted refusal is *named*, with the C# symbol and our port site
  written down beside it.
- **Key on the pack name.** Exactly what the `/upgrade` side deliberately does not do. Keying on the
  failure *signature* makes one rule cover every pack that trips the same TexTools refusal — today's
  fixture and tomorrow's user upload alike — with nothing blessed per-pack.
- **Bless it into the ratchet.** A matched failure records **no** baseline entry. AGENTS.md: a
  divergence recorded only in a gitignored baseline is not documented. Here there is not even a
  divergence — both sides refuse.

### 2.1 The rule shape

`test/helpers/resave-compare.ts` (new; mirrors `upgrade-compare.ts`'s role as the resave harness's
declared-rule registry):

```ts
interface ResaveMatchedFailureRule {
  reason: string;      // why this refusal is one we reproduce, in prose
  csharp: string;      // the C# that throws it — `file · symbol · lines`
  port: string;        // the site in src/ that reproduces it
  matchesOracle(trace: string): boolean;  // SELECTS the rule off the oracle's captured trace
  ourRefusal: string;  // the EXACT message our port throws
}
```

Three checks, each doing a distinct job — this is what makes the pairing sound rather than merely
plausible:

1. **`matchesOracle`** selects. It keys on the exception *signature* — the message text **and** the
   throwing frame (`WizardGroupEntry.<ToPmpGroup>`) — not on the message alone. This is the
   discriminator that keeps Milktruck out.
2. **`ourRefusal` exact-match** confirms *our* side refused for the declared reason, not merely that
   it refused. Stricter than the `/upgrade` side's containment test, and deliberately brittle: the
   string is a ported constant, byte-identical to the C#, so if it drifts we want a red.
3. **Containment of `ourRefusal` in the oracle trace** proves the two halves are the *same* refusal
   rather than two independently-declared ones that happen to be paired in the table. This is the
   check `assertMatchedUpgradeFailure` performs, kept verbatim in spirit.

### 2.2 Control flow

`registerResaveCheck`, on `result.kind === "error"`:

- a rule matches → `assertMatchedResaveFailure` runs **our** load + write and applies (2)+(3):
  - we throw the declared refusal → **PASS**, logged, no baseline entry, no skip;
  - we throw something else → loud `expect.fail` (mismatched reason);
  - we **succeed** → loud `expect.fail` (divergence: TexTools refuses, we do not).
- no rule matches → **today's code, unchanged**: `console.error("[resave] UNVERIFIED: …")` +
  `ctx.skip`.

### 2.3 The ordering fix

`loadModpack` and `writeModpack` move **after** the golden fetch, into a closure the assertion
invokes — the same shape as `registerUpgradeCheck`'s `runUpgrade` closure and for the same reason,
stated there at `corpus-upgrade.ts:499-504`: *a pack the oracle refuses at load or write is refused
just as legitimately by our loader or writer*, and running them outside the branch turns a matched
refusal into an escaped exception. Necessary for this design and correct independently of it.

## 3. The `golden` unit — a writer refusal is not a round-trip failure

Not anticipated by the brief; found by probing rather than assumed, and it is the reason this design
has a third moving part.

`registerGoldenCheck` (`test/helpers/corpus-golden.ts`) is a self round-trip: `load → write → load`
must preserve every inner file byte-for-byte. It calls `writeModpack` unconditionally. For a pack our
writer **deliberately refuses**, that throw fails the unit — measured on `Parent Settings.pmp`:

    golden-unit write THREW Error: Editing or exporting PMP Combining groups is not supported.

The round-trip is not *failing* here, it is *inapplicable*: there is no artifact to compare because
neither implementation will produce one. But the unit must not simply swallow write throws — a
genuine writer bug has to stay red.

**Resolution:** the golden check catches the throw and asserts it is a **declared ported refusal** —
matched by `ourRefusal` against the same `RESAVE_MATCHED_FAILURE_RULES` table. If it is, the unit
passes with a loud log naming the rule; anything else re-throws.

This is a real assertion, not a hole: if our writer stops refusing, or starts refusing with a
different message, `golden` goes red. It is also why the unit does **not** `ctx.skip` — a skip would
assert nothing and would erode the property that the suite's skip count is meaningful.

**On sharing the table across two harnesses.** The operator's 2026-07-19 ruling that `/upgrade` and
`/resave` stay independent is about **not reading another check's oracle cache** — a runtime coupling
that would let one harness's cached verdict decide another's outcome. This is a *committed
declaration*, not a cache: `golden` consults only the `ourRefusal` half, which is a statement about
**our own writer** and needs no oracle at all. The alternative — a second table of the same ported
refusals, which must be kept in agreement by hand — is strictly worse. The table lives in
`resave-compare.ts` because the `/resave` oracle is what *establishes* each entry; `golden` reuses
the port-side half.

## 4. Corpus placement: `test/corpus/real/`

The defining line between the roots is **who authored the bytes**, not what genre they are.
`test/corpus/synthetic/` means *we* built it with a committed builder under
`scripts/generate-synthetics/` and `npm run synthetics` regenerates it from a fresh clone. We did not
build this pack, there is no builder for it, and a fresh clone cannot regenerate it — so it is not
synthetic, whatever else it is.

`test/corpus/upgrade-error/` is wrong for a different reason: `corpus-units.ts:51-54` scopes those
packs to the `upgrade` check **only**, which would forgo precisely the `/resave` assertion this work
exists to create. (Note that root already holds a real third-party pack, `[Inako] Lilith Wish.pmp` —
so the roots are not partitioned by provenance either; `upgrade-error/` is a *scoping* device.)

That leaves `real/`, whose doc comments describe it as real third-party **mods**. This pack is a
third-party **test fixture** — Penumbra's own feature-test pack, not something anyone installs to
change how the game looks. The root's actual invariant, as `corpus-roots.ts` states it, is "real mods
… and authored synthetic packs": the operative distinction is *authored here* vs *not*. Rather than
leave the mismatch implicit, the wording is widened, in `corpus-roots.ts` and in AGENTS.md's
glossary, to **"third-party packs we did not author (real mods, and third-party test fixtures)"**.
That is a one-clause widening of an existing rule to match what the root already contains, not a new
policy.

### 4.1 What the four units do for this pack

Verified by probe (`assets`, `golden`) and by the run (`upgrade`, `resave`):

| unit | outcome |
| --- | --- |
| `assets` | The archive's only member is `meta.json`, so `assetFilesOf` yields **0** files and all five families (sqpack/mtrl/tex/mdl/geometry) iterate empty collections. Trivial pass. **No emptiness guard was needed or added** — every assertion in those modules sits *inside* a per-entry loop, so none can fire on an empty set, and adding a "corpus packs must carry payload" guard would be a new policy this pack would be the first to violate. |
| `golden` | Writer refuses → declared-refusal assertion (§3) → pass. |
| `upgrade` | Oracle refuses (`ModpackUpgrader.cs:226-232`, v4 pre-check); we throw `Cannot convert v4+ Penumbra modpack to ttmp/pmp.` (`src/upgrade/upgrade.ts:445-451`) → existing `assertMatchedUpgradeFailure` → pass. **No change to the `/upgrade` harness.** |
| `resave` | Oracle refuses (Combining); we throw the same → matched failure → pass, **no baseline entry**. |

Zero-payload is therefore an exercised shape now, not an assumed-safe one.

## 5. Milktruck stays exactly as it is

The claim that needs proving is negative — "the new branch cannot capture an environmental error" —
so it is pinned by a test rather than by inspection. `test/helpers/resave-compare.test.ts` asserts
that the recorded Milktruck trace (verbatim from
[`docs/backlog/2026-07-11-expected-failure-golden.md`](../../backlog/2026-07-11-expected-failure-golden.md))
matches **no** rule, alongside the positive case that the recorded Combining trace matches exactly
one. The two traces share no discriminating substring: Milktruck's is a `System.Exception: CMP Format
Changed …` raised from `CharaMakeParameterSet..ctor`, with no `ToPmpGroup` frame and no Combining
text.

Note the trace has to come from the backlog record rather than from the cache: at the v3.1.1.4 pin
Milktruck **no longer errors at all** (upstream fixed the CMP offset), so `.resave-cache` holds no
marker for it and the live corpus cannot supply the negative case. That is precisely why the guard is
a committed unit test.

## 6. Scope — what this deliberately does not do

- **The oracle-free assertions still do not run on the environmental branch.** That is the substance
  of `2026-07-19-resave-oracle-error-skips-all-assertions.md`, and that item's own operator-ratified
  ruling is *do not implement the fix speculatively* — with no pack reaching the branch (zero `.error`
  markers of that kind at the current pin), the code would ship unexercised. Its prescribed shape
  (extract the assertions into an exported function; unit-test it through `resaveGoldenCached`'s
  `opts.produce` seam) is unchanged by this work and still the right next step. The item is updated,
  not closed.
- **`Combining` groups remain unported**, and the newer Penumbra manifest keys this pack carries
  (`Condition`, `ParentSetting`, `Layout`, `Color`, `Id`, `RequiredFeatures`, `PageNames`) remain
  dropped on write — filed separately as
  [`2026-08-09-pmp-combining-group-support.md`](../../backlog/2026-08-09-pmp-combining-group-support.md)
  and [`2026-08-09-penumbra-schema-keys-dropped.md`](../../backlog/2026-08-09-penumbra-schema-keys-dropped.md).
  Both refusals here are *reproductions*, not gaps to close in this change.
- **No second real v4 pack.** `hs-Yet Another Leisurewear (+Rue!)-1.1.1-Zx8j.pmp` stays out; it is a
  separate operator decision and would need a 94-entry bless
  ([`2026-08-09-real-v4-corpus-coverage.md`](../../backlog/2026-08-09-real-v4-corpus-coverage.md)).

## 7. Corpus note

`test/corpus/**` is gitignored, so this pack does not land in git. The bytes are the operator's copy
from `C:\Users\user\Downloads\Parent Settings.pmp`, **copied** (not moved) into
`test/corpus/real/Parent Settings.pmp` — a fresh clone has neither, and the harness no-ops without a
corpus by design. `sha256 = c41612a64ac68f8b38787dc258ea944ca53a0b13eef5f7996f56fe09d4d36895`; that
key already holds the `/resave` `.error` marker, so a run does not re-spawn ConsoleTools for it.
