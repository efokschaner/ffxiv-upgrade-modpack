// Rebuilds every synthetic modpack under test/corpus/synthetic/ (all gitignored, so a fresh clone
// starts empty and regenerates them here). Run via `npm run synthetics`.
//
// Each builder writes its pack as an import side effect, so it also still runs standalone, e.g.
// `npx tsx scripts/generate-synthetics/build-synthetic-f1.ts`.

import "./build-synthetic-f1";
import "./build-synthetic-case-mismatch";
import "./build-synthetic-trailing-dot";
