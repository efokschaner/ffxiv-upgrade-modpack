# 5. `TTModel.GetMaterialIndex` folds "not found" to index 0

**Status:** reproduced · **Where:** `TTModel.cs:1419-1430` (see `src/mdl/model/tt-model.ts:224`)

Returns `index > 0 ? index : 0` — note `> 0`, not `>= 0`. A material that `IndexOf` fails to find
(`-1`) is silently mapped to material 0 rather than reported. (Index 0 itself round-trips correctly
by luck: it maps to 0 either way.)

**Us:** preserved verbatim.

**Upstream fix:** `>= 0`, with an explicit error (or an explicit documented default) for `-1`.
