# Round 6 partials — `UpdateEyeMask` (control-flow gate + iris table)

**Date:** 2026-07-16
**Status:** Design signed off; implementation pending.
**Foundation:** extends the roadmap design
(`docs/superpowers/specs/2026-06-30-dawntrail-modpack-upgrader-design.md`, §5 bundled reference
assets, §8 burndown) and is the direct sibling of the unclaimed-hair partials
(`docs/superpowers/specs/2026-07-16-unclaimed-hair-partials-design.md`) — the *same* round-6 glue
block (`ModpackUpgrader.cs:148-183`) that landing wired but deliberately left the eye call unported.
This advances the round-6 eye-mask partial backlog item (closed by the pixel-pipeline follow-up,
`docs/superpowers/specs/2026-07-16-eye-mask-pixel-pipeline-design.md`).

**Goal:** Port `EndwalkerUpgrade.UpdateEyeMask` (`EndwalkerUpgrade.cs:2007-2079`) — the round-6
heuristic that rescues a loose Endwalker iris **mask** (`--c{race}f{face}_iri_s.tex`) shipped without
its material by converting it to a Dawntrail iris **diffuse** — **as far as it can go faithfully
today, and no further.** Concretely: reproduce the whole control flow up to the pixel conversion,
including the bundled iris `(race, face) → diffuse` existence oracle and its `FileExists` gate, and
**throw a fail-loud, documented gap** at the one step that is genuinely blocked — the ImageSharp
pixel pipeline (`ConvertEyeMaskToDiffuse`). This converts today's **silent divergence** (an
unclaimed `iri_s.tex` passes through unchanged, where TexTools would convert it) into a loud gap,
per AGENTS.md ("Fail loud, never silently diverge").

---

## 1. What splits, and why the split lands here

`UpdateEyeMask` decomposes cleanly into a **control-flow half** (portable now) and a **pixel half**
(genuinely blocked). Two findings from tracing the C# fix the seam:

- **No block encoder is needed.** `DefaultTextureFormat` is `A8R8G8B8` (`XivCache.cs:68`), and our
  `/upgrade` golden's ConsoleTools uses that default — the round-2 texture port already proves it by
  matching the golden byte-for-byte via `encodeUncompressedTex`. So the eye path's
  `Tex.ConvertToDDS(..., DefaultTextureFormat, ...)` + `DDSToUncompressedTex` (`:2069-2073`) collapse
  to "encode an uncompressed A8R8G8B8 `.tex` with mips" — already a solved, byte-exact primitive.
  The backlog's DDS/BC7 worry is a non-issue. `SwizzleRB`/`ExpandChannel`/`MaskImage` are trivial
  pure per-texel ports too (`TextureHelpers.cs`), matching the existing `src/tex/helpers.ts`.

- **The one real blocker is ImageSharp float math.** `ConvertEyeMaskToDiffuse`
  (`EndwalkerUpgrade.cs:1910-2003`) runs a chain of ImageSharp operations we do **not** port:
  Bicubic `Resize`, NearestNeighbor `Resize`, `BoxBlur(w/128)`, and two `DrawImage` alpha composites
  (positioned `SrcOver`, then `SrcAtop`). This is the T3 resampler backlog item
  (`docs/backlog/2026-07-10-imagesharp-resampler.md`) **plus** blur **plus** compositing, and
  byte-parity against ImageSharp's float pipeline is uncertain — it would very likely require a
  `DIVERGENCE_RULES` "close-enough" pixel rule, which cannot be authored or blessed without a corpus
  golden to compare against. It is its own sub-project; see §5.

The seam therefore falls **exactly at the `ConvertEyeMaskToDiffuse` call** (`:2064`): everything
before it (matching, existence, path resolution) is faithful and shippable; the call itself throws.

---

## 2. Decomposition

Three pieces, mirroring the unclaimed-hair landing:

| Piece | Deliverable |
|---|---|
| **A. Logic** | `src/upgrade/eye-mask.ts` — a new module porting `UpdateEyeMask`'s control flow, ending in a fail-loud throw at the pixel step. `partials()` in `src/upgrade/upgrade.ts` adds the per-`contained`-path call (`ModpackUpgrader.cs:174-177`). |
| **B. Constants** | `scripts/extract-eye-materials.ts` → generated `src/upgrade/reference/eye-materials.ts` — the iris `(race, face) → diffuse path` table, doubling as the `FileExists` oracle. |
| **C. Coverage** | a synthetic **unit** test (`test/upgrade/eye-mask.test.ts`) — a golden is not viable for the throw path (see §6). |

Per "split, don't blend": A is its own module citing `EndwalkerUpgrade.UpdateEyeMask`; it does not
merge into `unclaimed-hair.ts` (a *different* C# symbol) nor into `upgrade.ts` beyond the thin
`partials()` call site.

---

## 3. The bundled iris table (piece B)

### 3.1 Shape — minimum surface, full existence coverage

One generated table, one entry **per base-game iris material that exists**, keyed by the material
game path `chara/human/c{race}/obj/face/f{face}/material/mt_c{race}f{face}_iri_a.mtrl`
(`EndwalkerUpgrade.cs:2044`). The table **is** the `FileExists` oracle (`:2049`): a lookup **miss**
means the iris material is genuinely absent in-game — a faithful skip (`return`), not a silent gap.

Per-entry value: the `g_SamplerDiffuse` texture path (`:2058-2059`, `mtrlTex.TexturePath`). This is
the destination the converted diffuse is written at — read only by the *pixel half*, not by the gate
we ship now. We capture it anyway (one entry per existing iris, cheap) so the deferred pixel work
needs **no second game-install extraction run**. *Implementation note:* `:2059` uses the raw
`mtrlTex.TexturePath`, **not** the `--`-prefixed Dx11 path the hair extractor records via `dx11Path()`
— record it raw and cite the difference, so a later port does not accidentally repath it.

### 3.2 Extraction — mirror `extract-hair-materials.ts`

Reuse that script's proven machinery verbatim in shape: `GameIndex.load(SQPACK)` as the in-process
CRC32-against-`.index` existence oracle (never a subprocess-per-candidate probe), `extractGameFile`
via the ConsoleTools oracle only on an index hit, `parseMtrl` + the `g_SamplerDiffuse` sampler
lookup. Enumerate `(race, face)` over the **full IDRaceDictionary** race-code list (identical to the
hair extractor's `RACES`, whose completeness is load-bearing for the same oracle reason) × a face-ID
scan range. Faces are low-numbered in retail, but the mask path admits `f[0-9]{4}`; pick a scan bound
generous enough to cover every shipped face and **`log()` the bound** so a face beyond it reads as a
deliberate, visible limit rather than a silent mis-skip (completeness stance, AGENTS.md).

### 3.3 Race-code round-trip

The runtime builds the iris path from the mask path's `c{race}` via
`IOUtil.GetRaceFromPath(maskPath).GetRaceCode()` (`:2041/:2045`), **not** by copying the raw digits.
`GetRaceFromPath` extracts `c([0-9]{4})` then `GetXivRace` maps it to an `XivRace` enum
(`FirstOrDefault`, so an unknown code falls to the enum's default member), and `GetRaceCode` maps
back (`XivRace.cs:866-871/515-519`). For every real race code this round-trips to the same digits; an
unknown code resolves to the default member's code → an iris path that misses the table → a faithful
skip. Port a small, cited `raceCodeFromPath` helper reproducing that round-trip rather than assuming
identity, so the edge behaves as TexTools does.

---

## 4. The logic (piece A)

`updateEyeMask(option, contained, IRIS_TABLE)`, called once per path in `contained`
(`ModpackUpgrader.cs:174-177`), reproducing `UpdateEyeMask`'s guards in order:

1. `EyeMaskPathRegex.IsMatch(path)` — the Dx11 `--..._iri_s.tex` shape (`:2005/2009`); miss ⇒ return.
2. Exists in the option's files (`Exists`, `:2019`). `contained ⊆ option.files` by construction, so
   this is always true here — mirror it (`option.files.has(path)`) and note the invariant, as the
   hair port does.
3. `_ConvertedTextures` dedup (`:2024`): the caller passes it as `null` each call (`:176`), so C#
   allocates a fresh empty set per call — no cross-path dedup. One path per call ⇒ the guard never
   fires; document, don't model state that cannot change.
4. Face regex `f([0-9]{4})` on the filename (`:2034-2039`); the outer regex already guarantees a
   match, but mirror the guard.
5. `race = raceCodeFromPath(path)` (§3.3); `face = D4(parsed)`; build `irisPath` (`:2044-2045`).
6. `IRIS_TABLE.has(irisPath)` — the `FileExists` gate (`:2049`); **miss ⇒ return** (faithful skip,
   matching the `// Hmmm...` branch).
7. **Hit ⇒ throw** a fail-loud `Error` — this is where TexTools reads the iris material and runs the
   pixel pipeline (`:2056-2077`). The throw cites the round-6 eye-mask partial backlog item and
   names the blocked step. (This throw was later removed once the pixel pipeline shipped — see
   `docs/superpowers/specs/2026-07-16-eye-mask-pixel-pipeline-design.md`.)

**Throw vs. catch.** `partials()` calls `updateEyeMask` directly (not inside the texture round's
`try`), so the throw propagates and fails the whole upgrade — deliberately. Unlike the hair pass's
bare-`catch` (a reproduced C# defect), there is no C# `catch` around this call site
(`ModpackUpgrader.cs:174-177` is bare), so failing loud is *also* the faithful control flow, not just
our gap policy: a mod that reaches the pixel step is one we cannot yet upgrade correctly, and a hard
stop is safer than a wrong texture that slips past a byte diff.

**Reachability.** An `iri_s.tex` reaches here only when it is *unclaimed* — present in the option but
not a value of any round-1/2 texture-upgrade target (so it lands in `unused ∩ option.files`), i.e. a
texture-only eye mod shipped without its iris material. The common "material included" case never
reaches this round. No corpus pack exercises it today, so the throw is inert against the current
suite (verified by the end-of-task gate staying green).

---

## 5. What stays deferred — recorded accurately in the backlog

The backlog item is **rewritten**, not closed, to capture precisely what remains to upgrade an eye
mod correctly, and the two avenues the operator flagged:

- **The pixel pipeline** `ConvertEyeMaskToDiffuse` (`:1910-2003`): Bicubic + NearestNeighbor
  `Resize`, `BoxBlur(w/128)`, positioned-`SrcOver` and `SrcAtop` `DrawImage`, plus the pure helpers
  `ExpandChannel`/`MaskImage`/`SwizzleRB`. Depends on and subsumes T3
  (`docs/backlog/2026-07-10-imagesharp-resampler.md`).
- **Bundled base-game eye textures** `chara/common/texture/eye/eye01_base.tex` and `eye01_mask.tex`
  (`:1928-1929`) — their raw pixels, extracted by the same script pass.
- **The write-back** reuses `encodeUncompressedTex` + `writeGeneratedTex` (already byte-exact); the
  diffuse destination path is already captured in the iris table (§3.1).
- **"Close-enough" pixel comparison.** Byte-parity against ImageSharp float math is unlikely; the
  intended path is a `DIVERGENCE_RULES` entry with a documented per-pixel tolerance, exactly as other
  texture cases already do non-exact matching (`test/helpers/upgrade-compare.ts`). Recorded so the
  pixel port is scoped as "close-enough, blessed against a golden," not "byte-exact."
- **Third-party npm libraries.** Investigate whether an existing library reproduces the ImageSharp
  ops closely enough to pass the close-enough rule (candidates to evaluate: a pure-JS resampler,
  `sharp`/libvips, `jimp`) before hand-porting resampler + blur + compositing. Pinned-exact, ≥7-day
  min release age per the supply-chain rule. Recorded as the first step of the pixel sub-project.

---

## 6. Coverage (piece C)

A **golden is not viable** for the shipped slice: our pipeline *throws* on the exercising input,
while ConsoleTools produces a real converted diffuse — a mismatch the `/upgrade` harness models only
as `pack | noop`, not "expected failure" (that capability is itself deferred,
`docs/backlog/2026-07-11-expected-failure-golden.md`). So per AGENTS.md ("fall back to a synthetic
unit test when the case is too deep for a golden"), pin the gate with a unit test:

- **Throw path:** an option holding an `iri_s.tex` whose `(race, face)` **is** in a stub iris table ⇒
  `updateEyeMask` throws (the documented gap).
- **Skip — regex miss:** a non-eye texture ⇒ no throw, file untouched.
- **Skip — iris absent:** an `iri_s.tex` whose `(race, face)` is **not** in the table ⇒ no throw,
  file untouched (the `// Hmmm...` branch).
- **Race-code round-trip:** a mask path whose race digits are not a real race resolves to the
  default-member code (§3.3), so the constructed iris path misses the table ⇒ skip.

The iris table itself is validated the same way the hair table is: it is a generated existence
oracle whose correctness is its faithful reproduction of `FileExists` over the enumerated inputs.

---

## 7. End-of-task gate

`npm run check`, `npm run typecheck`, `npm test` all green. The new throw must not fire against the
existing corpus (no pack reaches the eye path), so the suite stays green; the new unit test covers the
gate. If the extraction cannot run in-session (no live FFXIV/ConsoleTools), the committed script plus
a one-line operator run produces `eye-materials.ts` — the same regenerate-on-a-game-machine contract
the hair table already carries.
