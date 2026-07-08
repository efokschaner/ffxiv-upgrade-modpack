# Audits

Point-in-time assessments of `src/` against the AGENTS.md porting guidelines, plus the
**reusable protocol** for running one. Reports are dated; this protocol is not.

## Index

- [`2026-07-07-porting-guideline-audit.md`](./2026-07-07-porting-guideline-audit.md) —
  full-codebase adherence audit (Provenance / Blend / Fail-loud / Invented / Conventions).

---

## Why audit separately from the golden harness

The `/upgrade` golden harness proves **byte-parity of what it compares**. It cannot see what
it does not compare (manifest structure, unreached code paths), and it says nothing about
**traceability** — whether each line cites the C# it came from, lives with its rightful owner,
and fails loud on unported paths. Those are guideline-adherence properties an audit checks by
*reading* the port against `reference/`, not by diffing output. The two are complementary:
the harness catches divergence on covered paths; the audit catches latent traps and drift.

## What the audit checks — the five dimensions

Every finding is tagged with one dimension, a severity, and a confidence.

- **P — Provenance.** Every non-scaffolding TS file/function cites its C# origin as
  `file · symbol · lines`, and the citation resolves in `reference/`. Flag: missing, too
  vague (file but no symbol/lines), or non-resolving citations. Not a defect: genuine
  scaffolding (barrels, pure type decls, thin glue) — note as an observation.
- **B — Blend (split, don't blend).** Carving one C# symbol into several TS modules is
  encouraged; merging logic from *different* C# owners into one module is not. Flag: a module
  hosting logic from two+ unrelated C# symbols, or a member living away from its C# owner
  (e.g. a `TTModel` method implemented in the serializer).
- **L — Fail-loud.** Unreproduced structures/paths must `throw`. Flag: silent best-effort
  fallbacks, swallowed errors, default-returns on unhandled input. Not a defect: a `throw`
  with a clear "not yet ported" message — that is the goal.
- **I — Invented / divergent.** Behaviour matches the C#; quirks and apparent bugs are
  reproduced faithfully **and annotated**, never "fixed". Flag: un-cited/invented logic, a
  "cleanup" that changes output vs the golden, or an unannotated reproduced quirk.
- **C — Conventions.** No per-file SPDX/license headers (licensing lives in LICENSE/NOTICE);
  no edits into `reference/`.

**Severity:** HIGH (could change output bytes / silent divergence) · MEDIUM (traceability
broken, behaviour likely fine) · LOW (nits).
**Confidence:** CONFIRMED (opened the `reference/` C# or the TS is self-evident) · SUSPECTED
(looks wrong, needs cross-file/deeper verification — state exactly what would settle it).

## The design that makes it scale — three dedup mechanisms

An audit fans out across many agents. Left unstructured, several agents chase the same issue
across the codebase and file it repeatedly. Three mechanisms prevent that:

1. **File-scoping (partition).** Split `src/` into disjoint domains; no file is owned by two
   agents, so no per-file finding can be raised twice. The only permitted cross-read is a
   split domain's boundary (e.g. `mdl/model` a/b), and even then findings are filed only
   against the agent's *own* files.
2. **Consolidation.** Every agent emits findings in one fixed schema. The orchestrator merges
   them and collapses any pattern recurring across domains into a single systemic theme rather
   than N copies. (In the 2026-07 run this turned 31 raw findings into 5 themes + 1 headline.)
3. **Central follow-up on suspicions.** Agents surface `SUSPECTED` findings but do **not**
   chase theories across other domains. The orchestrator triages suspicions and dispatches a
   focused follow-up per theory — so a single theory is investigated once, not per-domain.

## Protocol

### Phase 0 — scope

- Enumerate `src/**/*.ts`, get line counts, and partition into ~6–8 domains balanced by size
  (roughly by subsystem directory). Keep tightly-coupled files (a subsystem that cross-
  references heavily) in one domain so blending/placement is judged with full context; split
  only oversized domains, telling each half the other's file list.
- Skim a few files to confirm the current citation style (e.g. `EndwalkerUpgrade.cs:797-873`)
  and the `reference/` layout (`reference/xivModdingFramework/...`,
  `reference/FFXIV_TexTools_UI/...`).

### Phase 1 — parallel domain audit

- Dispatch one `general-purpose` subagent per domain, **in a single message** so they run
  concurrently. Give each: the five-dimension rubric above (verbatim), its exact file list,
  the disjointness rule, and the output schema. Instruct read-only; do not edit `src/` or
  `reference/`.
- **Output schema** each agent returns: a findings table
  `| ID | file:line | Dim | Severity | Confidence | Summary |`, a detail block per finding
  (Evidence / C# checked / Why (tied to a dimension) / Suggested fix), a **"Clean /
  notable-but-fine"** section (so "audited & clean" is distinct from "not looked at"), and
  counts by (Dim, Severity, Confidence).

### Phase 2 — consolidate

- Merge all domain returns into one master list; sort by (Severity, Confidence).
- Collapse cross-domain patterns into systemic themes; keep a per-file appendix so nothing is
  lost.
- **Self-verify:** the orchestrator independently spot-checks a few HIGH/CONFIRMED findings
  (open the cited TS + C#) — subagents make systematic errors; do not relay blind.
- Build the suspicion queue: each `SUSPECTED` finding worth resolving, deduped by theory.

### Phase 2b — central follow-up

- One focused follow-up agent per distinct theory (batch independent ones in parallel).
  Typical theories: **reachability** (does the corpus reach this, and is a ratchet baseline
  masking it? — classify LIVE-MASKED / LIVE-CLEAN / LATENT) and **suspicion resolution**
  (a single code/`reference` lookup that confirms/refutes each SUSPECTED item).
- Fold verdicts back into the master list (SUSPECTED → CONFIRMED / REFUTED / DOWNGRADED).

### Phase 3 — report

Write a dated report to this folder: executive summary; headline/systemic findings first;
each theme with a per-finding table (location, dimension, evidence, fix); resolved/no-action
items; a **verified-clean** inventory; a **coverage map** (domain → files, confirming all of
`src` was covered); and a suggested priority order.

## Practical notes / gotchas (learned in the 2026-07 run)

- **Subagents may be unable to write files.** In this harness the domain agents' `Write` to
  the scratchpad was blocked, so they returned findings inline; the **orchestrator persists
  each return** to a findings file. Instruct agents to return the full findings as text (not
  only "written to path"), so nothing is lost if the write fails.
- **Reachability changes severity.** A CONFIRMED divergence on a path no corpus pack reaches
  is a *latent trap* (fail-loud it), not a *live bug*. Distinguish them explicitly — inspect
  `test/corpus/.upgrade-baseline/` (what diffs are already ratcheted) and, where needed,
  un-archive corpus packs (`.pmp`/`.ttmp2` are zip-family) to check for a triggering shape.
  The dangerous case is **LIVE-MASKED**: reached *and* absorbed by a baseline.
- **Mind the harness blind spots.** The golden diff compares decompressed payloads by
  `gamePath` only — it does not exercise the writers or compare manifest/top-level structure.
  Findings in those layers will not be caught by "but the tests pass"; weight them accordingly.
- **Scale to the ask.** A quick check = a few domains, single-pass. "Thorough audit" = full
  partition + reachability sweep + suspicion follow-ups, as above.

## Reproducing an audit

There is no committed script — an audit is orchestrated live (see the design in
`superpowers:dispatching-parallel-agents`). To re-run: ask a coding agent to "run the porting
audit protocol in `docs/audits/README.md`". It should re-derive the domain partition from the
*current* `src/` layout (files move), reuse the rubric and phases verbatim, and write a new
dated report here.
