# PMP: re-saving a Penumbra v4 modpack duplicates every inline-group payload file

*A self-contained bug report written for the xivModdingFramework / TexTools maintainers. Confirmed
against TexTools **v3.1.1.4** (release asset `FFXIV_TexTools_v3.1.1.4b.zip`, xivModdingFramework
commit `8e2a2603f963ceb38062798c128b7f4efd966e11`). Written 2026-08-06.*

## Summary

`PMP.LoadPMP` computes the set of "extra" (unreferenced) files in a modpack from the wrong list when
the pack uses the Penumbra **v4** manifest layout, where groups live inline in `meta.json` instead of
in separate `group_*.json` files. A payload file referenced only by a v4 inline group is misclassified
as an extra file. (A file referenced by an inline group *and* by `DefaultData` escapes, since the
`DefaultData` scan is correct — see §3.)

That misclassification is harmless on the write paths that do not preserve extra files, but
`ConsoleTools.exe /resave` asks for them to be preserved. There, each such file is written **twice**
into the output archive: once verbatim at its original archive path (as an "extra" file), and once at
the regenerated deduplicated path the group option actually points at. Where those two paths differ —
the normal case — both copies survive into the zip. Files referenced by `DefaultData` are unaffected,
which makes the asymmetry easy to see in a single pack.

The trigger is structural rather than version-gated: it needs a `meta.json` that carries inline
`Groups`, which only the v4 layout produces. A v3 pack, whose groups live in `group_*.json` files, is
unaffected.

## Where the defect is

Line numbers are from `xivModdingFramework/Mods/FileTypes/PMP.cs` at `8e2a2603`, except where noted.

### 1. `LoadPMP` builds a local list from the on-disk group files (`:191-208`)

```csharp
            var groups = new List<PMPGroupJson>();

            var files = Directory.GetFiles(path);

            foreach (var file in files)
            {
                if (Path.GetFileName(file).StartsWith("group_") && Path.GetFileName(file).ToLower().EndsWith(".json"))
                {
                    var group = JsonConvert.DeserializeObject<PMPGroupJson>(File.ReadAllText(file), new JsonSerializerSettings
                    {
                        NullValueHandling = NullValueHandling.Ignore
                    });
                    if (group != null)
                    {
                        groups.Add(group);
                    }
                }
            }
```

This loop looks only on disk. A pack whose groups live inline in `meta.json` has nothing here for it
to find, so `groups` ends up **empty**.

### 2. The v4 pull-back assigns `pmp.Groups`, not `groups` (`:210-225`)

```csharp
            var pmp = new PMPJson()
            {
                Meta = meta,
                DefaultMod = defaultOption,
                Groups = groups
            };

            if((meta.Groups != null && meta.Groups.Count > 0) || meta.DefaultData != null)
            {
                // Pull v4 style Penumbra data back to v3 style for use internally.
                pmp.Groups = meta.Groups ?? new List<PMPGroupJson>();
                pmp.DefaultMod = meta.DefaultData;

                meta.Groups = new List<PMPGroupJson>();
                meta.DefaultData = null;
            }
```

After `:220`, `pmp.Groups` holds the inline groups. The local `groups` variable is still the empty
list from step 1.

### 3. The referenced-file scan iterates the stale local list (`:232-265`)

```csharp
            var allPmpFiles = new HashSet<string>();

            foreach (var g in groups)
            {
```

…and, for standard options (`:252-264`):

```csharp
                foreach(var o in g.Options)
                {
                    var op = o as PmpStandardOptionJson;
                    if (op != null)
                    {
                        ValidateOption(op);
                        foreach (var kv in op.Files)
                        {
                            var zipPath = kv.Value;
                            allPmpFiles.Add(zipPath.ToLower());
                        }
                    }
                }
```

For a pack whose groups are inline, this loop has nothing to iterate, so no inline group's files reach
`allPmpFiles`.

The `DefaultMod` scan immediately below (`:267-276`) reads the **pulled-back** value and is therefore
correct:

```csharp
            var defOp = pmp.DefaultMod as PmpStandardOptionJson;
            if(defOp != null)
            {
                ValidateOption(defOp);
                foreach (var kv in defOp.Files)
                {
                    var zipPath = kv.Value;
                    allPmpFiles.Add(zipPath.ToLower());
                }
            }
```

That difference between `:234` and `:267` is the whole bug.

### 4. Everything not in `allPmpFiles` becomes an extra file (`:278-280`)

```csharp
            // Log the unused files that were contained in the PMP.
            var unusedFiles = IOUtil.GetFilesInFolder(path).Select(x => x.Substring(path.Length + 1).ToLower()).Where(x => !allPmpFiles.Contains(x) && !IsPmpJsonFile(x)).ToList();
            pmp.ExtraFiles = new HashSet<string>(unusedFiles);
```

`WizardData.FromPmp` (`xivModdingFramework/Mods/WizardData.cs:1124-1127`) carries that set forward,
keyed by the archive-relative path:

```csharp
            foreach(var f in pmp.ExtraFiles)
            {
                data.ExtraFiles.Add(f, Path.GetFullPath(Path.Combine(unzipPath, f)));
            }
```

### 5. On save, both writers fire (`WizardData.cs`)

`WizardData.WritePmp` copies every extra file into the staging folder at its original archive path
(`:1496-1507`):

```csharp
                if (saveExtraFiles && ExtraFiles.Count > 0)
                {
                    foreach (var file in ExtraFiles)
                    {
                        if (File.Exists(file.Value))
                        {
                            var path = Path.GetFullPath(Path.Combine(tempFolder, file.Key));
                            Directory.CreateDirectory(Path.GetDirectoryName(path));
                            File.Copy(IOUtil.MakeLongPath(file.Value), IOUtil.MakeLongPath(path), true);
                        }
                    }
                }
```

Independently, the group loop further down writes the same bytes into the same staging folder at the
regenerated path (`:1600-1619`):

```csharp
                // This both constructs the JSON structure and writes our files to their
                // real location in the folder tree in the temp folder.
                var page = 0;
                foreach (var p in DataPages)
                {
                    var numGroupsThisPage = 0;
                    foreach (var g in p.Groups)
                    {
```

via `WizardGroupEntry.ToPmpGroup` (`WizardData.cs:895`), which reaches `PMP.PopulatePmpStandardOption`
(called at `WizardData.cs:541`, defined at `PMP.cs:964`):

```csharp
                        var writePath = Path.Combine(workingPath, fi.PmpPath);
                        Directory.CreateDirectory(Path.GetDirectoryName(writePath));
                        File.WriteAllBytes(writePath, data);

                        // Penumbra likes backslashes?  Or do they write with system separator?
                        // Path.DirectorySeparatorChar
                        opt.Files.Add(fi.Path, fi.PmpPath.Replace("/", "\\"));
```

The staging folder is then zipped whole, so both copies land in the output.

## Scope — which entry points actually reach it

`saveExtraFiles` defaults to `false` (`WizardData.cs:1479`, and `:1331` on `WriteModpack`), so most
callers never take the verbatim-copy branch. Three call sites pass `true`:

| Call site | Reaches the bug? |
| --- | --- |
| `FFXIV_TexTools_UI/ConsoleTools/Program.cs:211` (`/resave`) | **Yes.** `WizardData.FromModpack(src)` uses the default `enforceCompatibility = false`, so a v4 pack loads. |
| `xivModdingFramework/Mods/ModpackUpgrader.cs:246` (`/upgrade`) | No. `UpgradeModpack:226-238` throws `NotImplementedException` for `Meta.FileVersion > 3` bound for a `.pmp`/`.ttmp2` destination, and raw-copies otherwise, before any save happens. |
| `FFXIV_TexTools_UI/FFXIV_TexTools/Helpers/ModpackUpgraderWrapper.cs:99` (GUI "Upgrade Modpack") | No. It calls the `UpgradeModpack(string, bool)` overload (`ModpackUpgrader.cs:54`), which loads via `WizardData.FromModpack(path, true)` (`:63`) → `PMP.LoadPMP(..., enforceCompatibility: true)` → the `meta.FileVersion > 3` throw at `PMP.cs:176-179`. |

So `/resave` is the one live path today.

Where `saveExtraFiles` is `false` the misclassification is inert rather than destructive:
`WizardData.ExtraFiles` (declared `:1094`, filled `:1126`) has no reader outside the gated block at
`:1496-1498` (`ShrinkRay.cs:74` also touches it, but only to clear it — it never reads it), so each
payload file is still written exactly once, by the group loop. **No files are lost.**

## Reproduction

1. Build a minimal v4 `.pmp` — a zip containing exactly three members:

   ```
   meta.json
   files/v4_group.bin           (4 bytes: A1 A2 A3 A4)
   files/v4_default.bin         (4 bytes: B1 B2 B3 B4)
   ```

   `meta.json`:

   ```json
   {
     "FileVersion": 4,
     "Name": "PMP v4 ExtraFiles Repro",
     "Author": "synthetic",
     "Description": "",
     "Version": "1.0.0",
     "Website": "",
     "Image": "",
     "Identifier": "00000000-0000-4000-8000-00000000f001",
     "LastWrite": "2024-01-01T00:00:00.0000000+00:00",
     "ModTags": [],
     "Groups": [
       {
         "Version": 0,
         "Name": "V4 Payload",
         "Description": "",
         "Image": "",
         "Page": 0,
         "Priority": 0,
         "Type": "Single",
         "DefaultSettings": 0,
         "Identifier": "00000000-0000-4000-8000-00000000f002",
         "Options": [
           {
             "Name": "On",
             "Description": "",
             "Image": "",
             "Files": {
               "chara/dummy/v4_group.bin": "files\\v4_group.bin"
             }
           }
         ]
       }
     ],
     "DefaultData": {
       "Version": 0,
       "Files": {
         "chara/dummy/v4_default.bin": "files\\v4_default.bin"
       }
     }
   }
   ```

   Two details matter. The two payload files must have **different contents** (identical bytes are
   collapsed onto one shared path by the content-hash pass in
   `PMPExtensions.ResolveDuplicates` (`Mods/FileTypes/PmpExtensions.cs:476`), which muddles the
   picture). And the archive member names
   (`files/...`) must differ from the paths TexTools regenerates (`<option folder>/<game path>`), or
   the duplicate lands on the same name and is invisible.

2. Run `ConsoleTools.exe /resave <in.pmp> <out.pmp>`.

3. List the members of `out.pmp`.

## Observed

```
meta.json                                973 bytes
default/chara/dummy/v4_default.bin         4 bytes
files/v4_group.bin                         4 bytes   <-- duplicate
v4 payload/chara/dummy/v4_group.bin        4 bytes
```

`files/v4_group.bin` and `v4 payload/chara/dummy/v4_group.bin` are byte-identical (`A1 A2 A3 A4`).
Nothing in the written `meta.json` points at `files/v4_group.bin` — its option entry reads

```json
"Files": { "chara/dummy/v4_group.bin": "v4 payload\\chara\\dummy\\v4_group.bin" }
```

so Penumbra never reads the duplicate; it is dead weight.

Note the asymmetry: `files/v4_default.bin` is **absent** from the output. `DefaultData`'s file was
classified correctly by the `pmp.DefaultMod` scan at `PMP.cs:267-276`, so it was written once, at
`default/chara/dummy/v4_default.bin`. Same pack, same save, two different outcomes — the only
difference is which of the two scans saw the file.

## Expected

Each payload file appears once, at its regenerated path — the same as for an equivalent v3 input.

## Impact

A v4 pack re-saved via `/resave` carries a redundant copy of every inline-group payload file whose
archive path differs from the path TexTools regenerates for it (`<option folder>/<game path>`) — the
normal case, since a pack is only laid out that way if TexTools itself wrote it. So for a typical
pack, where the bulk of the payload sits in groups rather than `DefaultData`, the output is roughly
twice the necessary size. The pack still installs and behaves correctly in Penumbra, since
the duplicated members are unreferenced — the symptom is size and confusion, not breakage. It does
not compound across repeated re-saves: the second pass regenerates the same paths and overwrites in
place.

## Suggested fix

Iterate the list the pull-back actually populates:

```diff
- foreach (var g in groups)
+ foreach (var g in pmp.Groups)
```

at `PMP.cs:234`. For a v3 pack `meta.Groups` is empty and `meta.DefaultData` is null, so the pull-back
at `:217` does not fire and `pmp.Groups` is still the `groups` assigned at `:214` — v3 behaviour is
unchanged.

One consequence worth being aware of, for the mixed input shape where a pack has on-disk
`group_*.json` members *and* the pull-back at `:217` fires. Note that guard is wider than "has inline
groups": a non-null `meta.DefaultData` fires it on its own, and `:220` then assigns
`meta.Groups ?? new List<PMPGroupJson>()` — so the on-disk groups are dropped from `pmp.Groups`
either way, whether they are replaced by an inline set or by an empty list.

For such a pack, those discarded groups' files are today counted as referenced by `:234` (it is still
reading the on-disk list) even though nothing downstream writes them. After this change they are no
longer counted, so they become extra files. That is the accurate classification — nothing in the
written output points at them — but it is a behaviour change for that unusual input shape.
