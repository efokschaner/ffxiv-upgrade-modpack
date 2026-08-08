# TexTools bug register

Bugs and mistakes in **TexTools / xivModdingFramework / ConsoleTools** that this port meets and
must decide what to do about.

**Most entries here are defects we knowingly reproduce.** `AGENTS.md` is explicit: TexTools is the
spec, byte-parity with its `/upgrade` output is the definition of correct, and a "fix" is a
divergence from the golden. So the default is to reproduce the buggy behaviour faithfully and record
the bug here — this file is the register of every place we knowingly did that, and the shortlist we
could take upstream as patches or issues if we ever choose to.

**A small number are defects we deliberately do _not_ reproduce**, because reproducing them would
hand the user a worse modpack (`AGENTS.md`'s user-benefit-divergence rule) or because TexTools emits
nothing at all to be byte-parity with. Those carry the `diverged` status below, say so in their own
text, and name the confirmation site that proves the divergence is exactly the one we meant (a
suppressing ratchet baseline is *not* such a site). **The complete list is #10, #18, #22 and #23** —
keep it accurate; this is the inventory `AGENTS.md`'s divergence rule leans on.

**Add an entry when** you port (or deliberately decline to port) behaviour that is a defect rather
than a design choice: a null dereference, an unreachable guard, a comparison that can never match, a
loop that cannot terminate, an exit code that lies. Ordinary SE/format weirdness that TexTools
merely *transcribes* — an odd race order, a hard-coded set-0 rule — is a **quirk**, not a bug; leave
those in the code comments where they are, unless the transcription itself is wrong.

**Each entry states:** what is wrong, the C# citation, what it does to us, what we do about it, and
what an upstream fix would look like.

## How this works

**This file is the index.** Each bug lives in its own file under `docs/textools-bugs/`, named
`NN-slug.md`. The register below is one line of context per entry — just enough to decide whether to
open it.

- **`NN` is a permanent ID, not a rank.** It is assigned once, at filing, and never reused or
  reordered. The list is in ID order because that is filing order; that order carries no priority,
  severity or urgency. (This is the difference from `docs/BACKLOG.md`, which *is* a prioritized list
  and deliberately keeps rank out of its filenames because rank moves. Here nothing moves.)
- **Entries are never deleted** — again unlike the backlog. A bug that is fixed upstream, or that we
  stop reaching, still has to explain why our port looks the way it does; it gets a status update, not
  a deletion. #19 is the live example: fixed upstream in `1993bf6`, still registered, because our
  faithful reproduction is now a divergence from the new oracle until Part B lands.
- **To file one:** take the next free ID, write `docs/textools-bugs/NN-slug.md` following the shape of
  the existing entries (status line, C# citation, *Us:*, *Upstream fix:*), and add its line to the
  register below.
- **To cite one from code or prose, keep writing `` `docs/TEXTOOLS_BUGS.md` #N ``.** That is the
  established form at ~139 sites across `src/`, `test/`, `scripts/` and `docs/`, and it stays correct:
  it points at this index, which links onward. Deliberately *not* the per-file path — the ID is stable
  where a slug is not, so a citation to the ID survives a rename that a citation to the file would not.
  Link the entry file directly only from prose that is genuinely about that one bug.

> **Status legend** — `reproduced`: our port deliberately mirrors the bug. `not reached`: the buggy
> code is in a path we don't port, recorded so nobody "discovers" it later. `gap`: we do **not**
> reproduce it yet and fail loud instead (a known parity hole). `worked around`: we neither reproduce
> nor fail loud — the harness absorbs the symptom by other means (see the entry for how) rather than
> our port mirroring the buggy behaviour itself. `diverged`: we deliberately do **not** reproduce it —
> our output differs from the golden (documented, and confirmed by a `DIVERGENCE_RULES` entry or, if no
> rule is constructible, a ratchet baseline) because reproducing the defect would hand the user a worse
> result; distinct from `gap` (which fails loud) and `worked around` (which the harness hides).

## The register

- [**#1 · `UpgradeRemainingTextures` dereferences a null texture in the `GearMaskNew` branch**](textools-bugs/01-gearmasknew-null-texture-deref.md)
  — **reproduced** · `EndwalkerUpgrade.cs:1865-1889`. The branch feeds `ResolveFile`'s result into
  `UpgradeMaskTex` *before* its null check, where the sibling `GearMaskLegacy` branch checks first. A
  PMP naming a payload its archive never contained therefore kills the whole `/upgrade`.

- [**#2 · `UpdateEndwalkerMaterial` dereferences an unresolvable Normal texture**](textools-bugs/02-endwalker-material-null-normal.md)
  — **reproduced** · `EndwalkerUpgrade.cs:912-921`. A colorset material with no resolvable Normal
  throws an NRE that the per-material `try/catch` swallows, leaving the file byte-untouched.

- [**#3 · Unguarded sampler scan in the spec/diffuse lookup**](textools-bugs/03-unguarded-sampler-scan-spec-diffuse.md)
  — **reproduced** · `EndwalkerUpgrade.cs:1028-1029`. Reads `x.Sampler.SamplerId` with no null guard,
  unlike the two mask lookups directly above it. `Array.find` order decides whether it throws.

- [**#4 · Empty-sampler exclusion checks can never match (case mismatch)**](textools-bugs/04-empty-sampler-case-mismatch.md)
  — **gap**, we fail loud · `Mtrl.cs:560` vs `:577`/`:593`/`:627`/`:719`. Paths are lowercased before
  being compared against an **uppercase** constant, so every exclusion meant to drop empty-sampler
  placeholders is dead code and C# writes the placeholders into the material.

- [**#5 · `TTModel.GetMaterialIndex` folds "not found" to index 0**](textools-bugs/05-getmaterialindex-not-found-folds-to-zero.md)
  — **reproduced** · `TTModel.cs:1419-1430`. `index > 0 ? index : 0` — note `> 0` — silently maps
  `IndexOf`'s `-1` onto material 0 instead of reporting it.

- [**#6 · Group-folder collision loop cannot terminate**](textools-bugs/06-group-folder-collision-loop.md)
  — **gap**, we throw rather than hang · `WizardData.cs:1425-1428`. The de-collision loop never
  increments its counter, so a collision needing a second retry spins forever recomputing the same
  candidate. The sibling loop in `MakeOptionPrefix` increments correctly.

- [**#7 · `FromPmp`'s page-index off-by-one merges page-0 groups onto the Default page**](textools-bugs/07-frompmp-page-index-off-by-one.md)
  — **reproduced** · `WizardData.cs:1137-1177` + `:1253-1263`. Groups are assigned by their raw page
  number *after* a synthesized Default page is unshifted onto the front, so a page-0 group lands on
  the Default page. `ClearNulls` then prunes the stranded empty page: with one real page that leaves
  a folder merge as the only effect (no `pN/`); with more, `pN/` still appears and later groups shift
  a slot.

- [**#8 · Missing files all share the zero hash, perturbing dedup paths**](textools-bugs/08-missing-files-zero-hash-dedup.md)
  — **reproduced** · `PmpExtensions.cs:509-514` + `:537-551`. An absent file is given a default
  all-zero `SHA1HashKey` rather than being excluded, so absent files collide as "duplicates" and burn
  `common/{idx}` numbers that the later write-time drop never refunds.

- [**#9 · `/upgrade` reports success and a destination path it never wrote**](textools-bugs/09-upgrade-reports-unwritten-path.md)
  — **worked around** · `ConsoleTools/Program.cs:181,188`. A no-op upgrade writes no file but still
  prints `"Upgraded Modpack saved to: {dest}"` and exits 0. The harness treats that as the no-op
  outcome and caches a `.noop` marker.

- [**#10 · `PopulatePmpStandardOption` silently destroys a pack's FileSwaps on write**](textools-bugs/10-fileswaps-destroyed-on-write.md)
  — **diverged** · `PMP.cs:966-968`. The only writer of a PMP option's JSON initializes `FileSwaps`
  and then never populates it, so any TexTools round-trip drops a Penumbra pack's swaps silently.
  Data loss **observed in-game** (a material that loads from our output and fails from TexTools');
  we preserve them, confirmed by a scoped carve-out in the golden harness.

- [**#11 · `ReadSqPackType3` over-allocates the model buffer by one header, appending 68 stray zero bytes**](textools-bugs/11-readsqpacktype3-header-overallocation.md)
  — **reproduced** · `Dat.cs:801` vs `Mdl.cs:2255`. `decompressedSize` already counts the 68-byte
  runtime header and the decoder adds it a second time. Never reaches an emitted file, but it makes
  `decode(encode(x))` non-idempotent for a model that entered un-padded.

- [**#12 · `UpdateUnclaimedHairTextures` swallows every transform exception (bare catch)**](textools-bugs/12-unclaimed-hair-bare-catch.md)
  — **reproduced** · `EndwalkerUpgrade.cs:1498-1501`. The catch-all around the transform leaves the
  *raw* copies already written at the new Dawntrail paths, silently shipping a pixel-untransformed
  pair.

- [**#13 · `UpdateEyeMask` passes a possibly-null `ResolveFile` result straight into `FromUncompressedTex`**](textools-bugs/13-updateeyemask-null-resolvefile.md)
  — **reproduced** · `EndwalkerUpgrade.cs:2030-2032`. `ResolveFile` can return null and
  `FromUncompressedTex` takes it unchecked, throwing `ArgumentNullException` at `XivTex.cs:96` —
  #1's defect class at a different call site.

- [**#14 · `UpdateEyeMask` dereferences a `FirstOrDefault` that can return null for `TexturePath`**](textools-bugs/14-updateeyemask-firstordefault-deref.md)
  — **reproduced** · `EndwalkerUpgrade.cs:2056-2059`. An iris material that binds no diffuse sampler
  NREs on the very next line — an unguarded *result* deref, where #3 is an unguarded *predicate*.

- [**#15 · `RepathHairMashups`' sampler scan dereferences `x.Sampler.SamplerId` unguarded**](textools-bugs/15-repathhairmashups-unguarded-sampler.md)
  — **reproduced** · `ModpackUpgrader.cs:434-436` (+ the highlight-half twin at `:322-323`). Same
  defect as #3, but with **no** enclosing `try/catch`, so the NRE aborts the whole `/upgrade` instead
  of skipping one material.

- [**#16 · `GetFullImcInfo`'s NonSet default subset reads `Vfx` from the material-set byte**](textools-bugs/16-getfullimcinfo-nonset-vfx.md)
  — **not reached** · `Imc.cs:395`. The `vfx` local is read off the stream and discarded; the entry is
  built with `Vfx = variant`. Our `.meta` seed runs through a different reader entirely. Also records,
  so it is not re-litigated, why the sibling near-bug in `Imc.GetEntries` is **not** a bug.

- [**#17 · `FromPMPGroup`'s Multi bitmask aliases option 64 onto option 0 (unmasked shift count)**](textools-bugs/17-multi-bitmask-unmasked-shift.md)
  — **reproduced** · `WizardData.cs:817-818` + the mirror getter at `:600`. C# masks a 64-bit shift
  count to its low 6 bits, so a 65-plus-option group wraps onto earlier options. JS `BigInt` does not
  mask, so reproducing it takes an explicit `& 63` on both the read and write sides.

- [**#18 · `ResizeXivTx` needlessly BC-recompresses a resized texture that is decoded again and stored uncompressed**](textools-bugs/18-resizexivtx-needless-bc-recompress.md)
  — **diverged** · `Tex.cs:412-419` → `:636-705`. A full lossy BC generation whose result is decoded
  again two lines later and never reaches the output format — yet the loss survives into the shipped
  mask and hair textures. We resize to raw RGBA instead (we have no BC encoder, *and* reproducing it
  would copy a needless quality loss into a texture the game samples).

- [**#19 · A canonical `MipCount==2` header's `LoDMips=[0,1,0]` trips `TexHeader.ToBytes`'s own ordering guard**](textools-bugs/19-mipcount2-lodmips-ordering-guard.md)
  — **reproduced; FIXED UPSTREAM in `1993bf6` (v3.1.1.4)** · `Tex.cs:1124-1126`. Two independent
  `>1`/`>2` guards disagree at exactly two mips, and `ToBytes`' ordering check then rejects the header
  its own constructor built. Our faithful reproduction is now a **divergence from the new oracle**;
  the entry's "What Part B owes" section is the authoritative statement of that outstanding work.

- [**#20 · `ValidateTexFileData` resizes NPOT textures using `Width` for both dimensions**](textools-bugs/20-validatetexfiledata-width-for-both-dims.md)
  — **reproduced** · `EndwalkerUpgrade.cs:2110`. A copy-pasted argument squishes a non-square NPOT
  source to a square, where the three sibling resize sites each round both dimensions correctly.
  Audited against the v3.1.1.4 re-pin: unaffected.

- [**#21 · `FixUpBrokenMipOffsets`' `MipCount` reduction is lost to the struct-copy, so `ValidateTexFileData` serializes a stale `MipCount`**](textools-bugs/21-fixupbrokenmipoffsets-struct-copy-mipcount.md)
  — **reproduced** · `Tex.cs:159-234` vs `EndwalkerUpgrade.cs:2116-2124`. `TexHeader` is a struct
  passed by value: the function's array writes escape (arrays are references) but its scalar
  `MipCount` write does not, so a trimmed file is rewritten claiming more mips than it has offsets
  for. Audited against the v3.1.1.4 re-pin: not fixed upstream.

- [**#22 · `ClearNulls` reads `WizardPageEntry.HasData` over a list it is about to remove nulls from**](textools-bugs/22-clearnulls-page-hasdata-null-deref.md)
  — **diverged** · `WizardData.cs:1253-1285` reading `:980-986`. A zero-option PMP group puts a literal
  `null` into `page.Groups`; the group-level prune is null-safe but the page-level predicate one
  statement earlier is not, so a page whose **first** group is that null makes ConsoleTools exit `-1`
  with **no output file and no message** (`Any` short-circuits, so an earlier real group shields it).
  We are null-safe, so the pack upgrades — the one case where the user-benefit bar needs no in-game
  comparison, because there is no TexTools output to compare against.

- [**#23 · `LoadPMP`'s ExtraFiles scan iterates the stale v3 `groups` list, duplicating a v4 pack's whole payload on save**](textools-bugs/23-loadpmp-extrafiles-stale-groups-list.md)
  — **diverged** · `PMP.cs · LoadPMP · 191-208` vs `· 234`. The v4 pull-back assigns `pmp.Groups` but
  the ExtraFiles scan still reads the local `groups` list, so a v4 pack's inline-group payload is
  misclassified and `/resave` writes every byte of it **twice**. Mentioned to the TexTools devs in
  Discord (informally); `AGENTS.md` evidence bar 3 — in-game verification — is still outstanding.
