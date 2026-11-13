# module-shapefile — Architecture

`@tablette/module-shapefile` — a third-party Tablette module that makes it
easy to **draw and outline things** in the app: polygons, lines and points
sketched on map apps, saved as GeoJSON in the workspace, seeded from real
OpenStreetMap objects, and round-tripped into generated apps.

Status: design document (rev. 2 — adds the format strategy and the OSM
integration, based on the shapefile/GeoJSON references and the
openstreetmap/leaflet-osm plugin). Nothing is implemented yet.

## 1. Goals

- Let the user **outline things interactively** on a generated map app
  (draw a polygon, trace a boundary, drop markers) without leaving Tablette.
- **Persist** every drawn shape as GeoJSON in the workspace, so outlines
  survive app regeneration and can be reused across sessions.
- Let the **agent** create, read, derive and **seed** shapes: circle around
  a point, bounding box, or the geometry of a real OSM object (a building
  way, a path) to outline around.
- Keep the module fully compliant with the
  [third-party module guide](https://docs.tablette.bimr.net/guide/third-party-modules)
  and the Module SDK contract: no core imports, plain `tsc` build,
  `node --test` tests, `validateModules()` green.

## 2. Non-goals

- No server, no backend. The one external endpoint is the public OSM API
  (see section 9); everything else is local.
- No runtime calls from generated apps: shape data is inlined at compose
  time, like every other tablette map app.
- No geospatial processing library (no turf, no proj4). Geometry helpers
  are small, self-contained and documented; CRS is EPSG:4326 everywhere.
- **The Esri shapefile is not a storage format for this module.** The
  GeoJSON RFC 7946 format is canonical internally; the shapefile is a
  later import/export **bridge** for GIS interop (section 6), and never a
  format the module or a generated app reads or writes natively.

## 3. The three moving parts

The module is small because the host does the heavy lifting. It has three
parts, ordered by importance:

```
┌─────────────────────── tablette studio ────────────────────────┐
│                                                                │
│  agent (sketch/build modes)        generated map app           │
│    │ uses shapefile_* tools         │ embeds the Draw Kit      │
│    ▼                                 ▼                         │
│  ┌──────────────┐   workspace   ┌──────────────────┐           │
│  │ tools.ts     │◄─ shapes/ ───►│ drawKit.js (str) │           │
│  │   + osm.ts   │   *.geojson  └──────────────────┘           │
│  └──────┬───────┘                        │ user draws,       │
│         │            OSM API 0.6         │ exports GeoJSON  │
│         │  (compose-time fetch only)      ▼                  │
│         │                        shapes/<name>.geojson        │
│         ▼                                   │                 │
│  composed app DATA ◄────────────────────────┘                │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

1. **Draw Kit** (`src/drawKit.ts`) — a dependency-free Leaflet drawing
   component, shipped as a **string** the agent inlines into composed map
   apps. This is what makes outlining possible in the UI.
2. **Tools** (`src/tools.ts` + `src/osm.ts`) — agent-side `shapefile_*`
   tools to write, read, list, derive shapes in the workspace, and to pull
   real OSM geometry at compose time.
3. **Prompt** (`src/prompts.ts`) — instructions for the agent: when to
   embed the Draw Kit, how to persist shapes, how to seed from OSM, how to
   name files, what the user means by "outline this".

A `Surface` (Explore > Modules) is a phase-2 item; see section 10.

## 4. Package layout

Follows the guide's single-package shape exactly:

```
module-shapefile-v2/
  package.json          studioModule metadata + peer deps
  tsconfig.json         strict ESM, tsc is the whole build
  src/
    index.ts            re-exports the descriptor (declared entry)
    module.ts           the StudioModule object
    tools.ts            createTools(ctx)
    prompts.ts          prompt section + attribution
    osm.ts              OSM API 0.6 client: XML -> GeoJSON conversion
    drawKit.js          plain-JS drawing kit, shipped verbatim
    drawKit.ts          typed accessor: export const DRAW_KIT: string
    geometry.ts         bbox, circle, centroid helpers
    types.ts            GeoJSON types re-exported locally
  test/
    module.unit.ts      node --test: validate, prefixes, fake workspace
    geometry.unit.ts    node --test: circle, bbox edge cases
    osm.unit.ts         node --test: XML fixtures, no network
    fixtures/osm/       saved .xml responses for the parser tests
  docs/ARCHITECTURE.md  this document
  README.md
  LICENSE               MIT
```

`drawKit.js` is committed as plain `.js` and imported verbatim (no `?raw`
Vite feature — the guide forbids Vite-only imports). It is side-effect
free until called, so `tsc` copies it to `dist/` untouched and it ships
as-is.

## 5. Package metadata

```json
{
  "name": "@tablette/module-shapefile",
  "version": "0.1.0",
  "type": "module",
  "private": false,
  "studioModule": {
    "id": "shapefile",
    "entry": "./dist/index.js",
    "export": "shapefileModule"
  },
  "peerDependencies": {
    "@tablette/module-sdk": "^0.1.0",
    "ai": "^5.0.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@tablette/module-sdk": "^0.1.0",
    "typescript": "^5.7.0"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --test test/*.unit.ts"
  }
}
```

No `react` peer dependency in v0.1 — no Surface is shipped, so the guide's
"add react only if you ship a Surface" rule applies.

## 6. Format strategy

**GeoJSON (RFC 7946) is the only format the module stores, ships and
renders.**

- JSON-based, single-file, natively understood by Leaflet and therefore by
  every composed map app (`var DATA`).
- WGS84 longitude/latitude coordinate order, matching the whole tablette
  stack; no reprojection anywhere.
- Feature/FeatureCollection model with free-form `properties` — exactly
  what the Draw Kit produces and the workspace stores.

**Why the Esri shapefile cannot be the internal format** (from the Esri
spec, summarized in the [Wikipedia
article](https://en.wikipedia.org/wiki/Shapefile)):

| Shapefile constraint | Consequence for us |
|---|---|
| Multi-file trio (`.shp`, `.shx`, `.dbf`) with one prefix | Workspace files are single documents; three coupled binary files don't map onto `ModuleWorkspace` |
| dBase attributes: 10-char field names, 255 fields, 254-char text, text-stored floats | Our `label`/`kind`/`note` properties would be mangled |
| Nulls represented as zero (ESRI tooling) | Quantitative attributes cannot be trusted through a round trip |
| One shape type per file (spec); no mixed geometry | A FeatureCollection with outlines, paths and points cannot round-trip into one shapefile |
| No topology | Antimeridian/multi-part edge cases degrade, no storage gain |

**Shapefile as an import/export bridge (milestone M5).** The format stays
what it is in the GIS world — the interchange format everyone's GIS
software speaks. The module will expose:

- `shapefile_parse` (import): accepts the *text-encodable* portions of a
  zipped shapefile or a base64 `.dbf`+`.shp` pair pasted by the user,
  converts to GeoJSON per the mapping below, writes `shapes/<name>.geojson`.
- `shapefile_export` (export): converts a stored shape file back to the
  trio (base64 zip) for download outside the sandbox.

Conversion mapping, documented in the prompt and tests: mixed
FeatureCollections are split by geometry type; `properties` are truncated
to dBase limits with a `label` -> `lbl` fallback keeping the original in
`note`; nulls become `null`, never `0`; the module records conversion
provenance in a `_src` property. Binary parsing stays compose-time and
agent-side (the OSM fetch path, not the app path); generated apps still
never read shapefiles.

**TopoJSON** (a GeoJSON offspring that encodes topology, smaller files) is
noted as an optional future compaction for large shape sets; never
internal in v0.x.

## 7. The descriptor

`src/module.ts`:

```ts
import type { StudioModule } from "@tablette/module-sdk";
import { createShapefileTools } from "./tools.ts";
import { SHAPEFILE_PROMPT, SHAPEFILE_ATTRIBUTION } from "./prompts.ts";

export const shapefileModule: StudioModule = {
  id: "shapefile",
  label: "Shapefile",
  description: "Draw and outline shapes on map apps; persist them as GeoJSON.",
  version: "0.1.0",
  docs: "/modules/shapefile",
  modes: ["sketch", "explore", "build"],
  defaultEnabled: false,
  dataSources: [
    {
      id: "osm-api",
      label: "OpenStreetMap API 0.6",
      endpoint: "https://www.openstreetmap.org/api/0.6",
      auth: "none",
      cors: true,
      methods: ["GET"],
      license: "ODbL 1.0",
      licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      attribution: "Geometry from © OpenStreetMap contributors (ODbL)",
    },
  ],
  attribution: [SHAPEFILE_ATTRIBUTION],
  prompt: SHAPEFILE_PROMPT,
  createTools: createShapefileTools,
};
```

Why these modes: drawing support belongs to **sketch** (compose an app with
the Draw Kit), **build** (same composer, project mode) and **explore** (shape
files stay browsable). Match the pattern of `module-eindhoven`, which ships
`["sketch", "explore", "build"]`.

`defaultEnabled: false` — drawing is opt-in; a user who never outlines
should not carry the prompt.

Since the module now declares a data source, its `attribution` line and
the ODbL credit rule are part of the review contract: every app built from
OSM-derived geometry must visibly show `© OpenStreetMap contributors`.

## 8. Tools

All names prefixed `shapefile_` (registry requirement). Every tool takes
zod input, returns a **string** (errors as `error: …`, never throws), and
uses `ctx.workspace`, `ctx.now`, `ctx.trace`, and — for the OSM tool only —
`ctx.fetch`.

| Tool | Input | Output | Purpose |
|------|-------|--------|---------|
| `shapefile_write` | `name`, `features` (FeatureCollection, Feature or bare Geometry), optional `label` per feature | summary line + path | Write `shapes/<name>.geojson` to the workspace. Normalizes to FeatureCollection, adds `label`/`kind` properties and `_src` provenance. |
| `shapefile_read` | `name` | summary + compact GeoJSON | Read and return a shape file: feature count, geometry kinds, bbox, then the GeoJSON. |
| `shapefile_list` | — | file list with per-file summary | List `shapes/*.geojson` in the workspace. |
| `shapefile_circle` | `lat`, `lon`, `radius` (m), optional `segments` | GeoJSON Polygon | Generate a circle polygon (for "outline 2 km around X"). |
| `shapefile_bbox` | `name` or raw features | bbox array + polygon GeoJSON | Compute a bounding box of a shape file or pasted GeoJSON. |
| `shapefile_osm_feature` | `type` (`node` \| `way` \| `relation`), `id` | compact GeoJSON FeatureCollection | Fetch the OSM object at compose time and convert its XML to GeoJSON, for outlining around real geometry (see section 9). |

Workspace conventions (enforced by `shapefile_write`, documented in the
prompt):

- path: `shapes/<name>.geojson`, `name` = `^[a-z0-9][a-z0-9-]*$`
- always a FeatureCollection at the top level
- per-feature properties: `label` (string), `kind` (one of
  `outline | path | point`), optional `note`, optional `_src` (provenance,
  e.g. `osm:way/52477381`)

### Design notes

- `shapefile_write` accepts the agent's usual output — a bare Feature or a
  bare Geometry — and normalizes; agents produce both, and the validator
  being strict here would cause retry loops.
- `shapefile_read` returns a compact GeoJSON (no pretty-printing): shapes
  go back into `var DATA` in composed apps, so keeping them dense matters.
- No `shapefile_delete` in v0.1: the workspace UI already deletes files,
  and a destructive tool is review friction for zero user value.
- Circle generation: spherical radius approximation with equirectangular
  correction at the target latitude; 64 segments default, min 8, max 256.
  Documented formula, no library.

## 9. OSM integration (the leaflet-osm pattern)

[openstreetmap/leaflet-osm](https://github.com/openstreetmap/leaflet-osm)
is the closest reference for what this module does with OSM: a Leaflet
plugin (one BSD-licensed JS file) that renders OSM tile layers
(`L.OSM.Mapnik`) and turns OSM API responses into vector layers
(`L.OSM.DataLayer` from `api/0.6/node/<id>` or `/way/<id>/full` XML).

The smartest way to integrate is to **reuse the pattern, not the
dependency**:

- `L.OSM.DataLayer` converts OSM XML to geometry **in the browser at
  runtime**. Tablette forbids runtime data calls in generated apps
  (apps are static; the tile relay exists precisely because the sandbox
  can't do ordinary fetching). So the conversion moves to compose time:
  **`shapefile_osm_feature` fetches the XML via `ctx.fetch` (agent-side)
  and `src/osm.ts` converts it to GeoJSON**, which the agent inlines into
  `DATA` or persists with `shapefile_write`. The generated app only ever
  sees GeoJSON.
- `L.OSM.Mapnik` tile conventions are already tablette's domain
  (`config.tileUrl` + attribution in `renderAppHtml()`); the module adds
  nothing there, and never ships tile-layer code.
- `src/osm.ts` re-implements the ~100 lines of way/node XML → GeoJSON
  conversion rather than vendoring the plugin, keeping the module
  dependency-free and Node-testable against XML fixtures. If any code is
  ever copied verbatim, the BSD notice is preserved per its terms.

Practical shape of the OSM tool:

- endpoint: `GET https://www.openstreetmap.org/api/0.6/<type>/<id>`(+`/full`
  for ways and relations) — anonymous, CORS-enabled, JSON/XML; usage stays
  read-only and bounded (one object per call, agent-driven, a handful of
  calls per compose), which is what both the OSM usage policy and the
  module review expect.
- conversion: way → LineString/Polygon (closed ways with area tags become
  Polygons), node → Point, relation → MultiPolygon for boundary/multipolygon
  types; tags copied to `properties`; `_src: "osm:<type>/<id>"` provenance.
- errors are strings: unknown type, 404 (`error: osm feature not found`),
  non-CORS or offline (`error: osm fetch failed …`).
- attribution is load-bearing: the tool output reminds the agent that any
  app built with this geometry must show `© OpenStreetMap contributors`
  (ODbL) — same rule tablette's map composer already enforces for tiles.

What this buys the module: "outline the buildings around X", "trace this
path" and "shade this park" all become one compose-time seed plus the user
adjusting vertices, instead of hand-drawing from scratch on a blank map.

## 10. Draw Kit (`src/drawKit.js`)

A single plain-JavaScript IIFE the agent inlines into a composed map app
script to add drawing controls to its Leaflet map. Constraints that shape
the design:

- **No dependencies.** Generated apps stay static: Leaflet 1.9.4 from the
  pinned CDN is the only allowed vendor, so the kit hand-rolls the small
  geometry interactions (vertex editing, snapping) on top of Leaflet's own
  DOM events. No Leaflet.draw, no leaflet-osm, no turf.
- **Sandboxed iframe.** The Viewer renders apps in a `srcdoc` iframe with
  opaque origin (`allow-scripts`): no network fetches beyond tiles, and
  the download button is not guaranteed. Export therefore offers two
  paths, both client-side: a modal with the GeoJSON in a `<textarea>` plus
  a copy button, and a best-effort `Blob` download link that degrades
  gracefully when blocked.
- **Persistence is the agent's job.** The kit cannot write the workspace;
  the prompt instructs the agent to watch for exported GeoJSON pasted in
  chat, call `shapefile_write`, then re-compose the app with the shapes
  inlined in `DATA`. Round trip: draw → export → paste →
  `shapefile_write` → re-compose with shapes visible → draw more.

Kit API (attached to `window.DrawKit` when inlined):

```js
DrawKit.mount(map, {
  seed: <GeoJSON or null>,   // existing shapes to display, from var DATA
  onExport: null,            // optional callback; default: show modal
});
```

Controls: draw polygon (outline), draw line (path), place point, select /
edit vertices, delete feature, export all as one FeatureCollection. The
control palette is plain Leaflet Control buttons with the app's CSS
variables — generated apps each have their own style, so the kit ships no
aesthetics beyond structural CSS injected alongside.

`seed` commonly comes from OSM objects pulled with `shapefile_osm_feature`
(outline around a real building, then adjust), or from previously drawn
workspace shapes.

Edge cases: shapes crossing the antimeridian are left as-is (Leaflet
renders them, the prompt notes the limitation); circle clock-hand
direction is not enforced (GeoJSON winding rule is advisory in practice).

## 11. Surface (phase 2 — not in v0.1)

An optional `Surface.tsx` in Explore:

- lists `shapes/*.geojson` via `host.workspace`,
- lets the user pick a shape file and **onUse("Outline shapes/<name> in a
  map app")** hands a prompt back to Sketch,
- shows a read-only GeoJSON copy block.

Deferred because: it adds the `react` peer dependency, needs a map preview
to be genuinely useful, and none of it blocks the core drawing loop. A
drawing *editor* surface will re-evaluate after v0.1 feedback.

## 12. Prompt section (summary)

`SHAPEFILE_PROMPT` covers, in order:

1. When the user asks to outline/draw/trace — embed the Draw Kit
   (verbatim, tell it the exact string literal source) and seed `DATA`
   with existing workspace shapes when they exist.
2. When the user names a real OSM thing ("outline this building"), fetch
   it first with `shapefile_osm_feature`; never hand-guess OSM geometry.
3. File conventions (`shapes/<name>.geojson`, properties, naming regex).
4. Round-trip rule: exported GeoJSON pasted in chat must be persisted with
   `shapefile_write` before the next compose.
5. Attribution: show the module credit line in apps built with shapes, and
   `© OpenStreetMap contributors` (ODbL) whenever OSM-derived geometry is
   included.
6. Limitations: GeoJSON only, EPSG:4326, no binary `.shp` in v0.1, sandbox
   download limits.

## 13. Testing and validation

Mirrors the guide's checklist:

- `test/module.unit.ts` — `validateModules([shapefileModule])` returns `[]`;
  every `createTools` key starts with `shapefile_`; tools never throw for
  a stub context (fetch rejects — only `shapefile_osm_feature` calls it).
- `test/geometry.unit.ts` — circle at equator vs high latitude, bbox of
  empty input rejected as `error:`, write/read round-trip through a fake
  `ModuleWorkspace` (in-memory Map).
- `test/osm.unit.ts` — `src/osm.ts` against saved XML fixtures (node, open
  way, closed way with `area=yes` boundary way, multipolygon relation);
  no network in unit tests; fetch is injected via the context.
- Isolation grep in CI: `! grep -rn "src/agent|src/forge|src/app|src/map" src`.
- Node 24 (or 22.18+ with type stripping).

## 14. Milestones

| Phase | Scope | Done when |
|-------|-------|-----------|
| M0 | Scaffold: package.json, tsconfig, descriptor with two tools (`shapefile_write`, `shapefile_read`), tests green | `npm run build && npm test` green in a clean clone |
| M1 | Geometry: `shapefile_list`, `shapefile_circle`, `shapefile_bbox` + tests | unit tests cover latitudes and error strings |
| M2 | OSM: `src/osm.ts` XML→GeoJSON parsing, `shapefile_osm_feature` tool, fixture tests | open way, closed way, node and relation fixtures convert exactly |
| M3 | Draw Kit: polygon/line/point, edit, delete, export modal | kit usable in a hand-made Leaflet page from `dist/` |
| M4 | Prompt + prompt integration test; run inside tablette as a vendored dependency | module appears in catalogue, agent outlines a real OSM building in sketch mode |
| M5 | Submission: README, LICENSE, docs page `/modules/shapefile`, issue on the modules forge | — |
| M6 | Shapefile bridge: `shapefile_parse` / `shapefile_export` with the section 6 mapping; optional TopoJSON compaction | documented round trip with QGIS, tests on fixture shapefiles |

## 15. Submission path

Per the guide: push to this GitHub repository, then open an issue titled
`module: shapefile` on https://git.bimr.net/rvba/tablette-modules with the
repo URL, commit hash, modes (`sketch, explore, build`), tool names, and
the single data source (OSM API 0.6, ODbL, attribution
`© OpenStreetMap contributors`). The maintainers vendor, publish to the
`@tablette` scope and regenerate the core registry.

## 16. References

- [Esri shapefile (overview)](https://en.wikipedia.org/wiki/Shapefile) —
  format constraints summarized in section 6 (dBase limits, single shape
  type, no topology).
- [GeoJSON / RFC 7946 (overview)](https://en.wikipedia.org/wiki/GeoJSON) —
  the canonical internal format; WGS84, Feature/FeatureCollection model;
  TopoJSON noted as future compaction.
- [openstreetmap/leaflet-osm](https://github.com/openstreetmap/leaflet-osm) —
  the OSM-plugin pattern (`L.OSM.DataLayer`, `L.OSM.Mapnik`) that section 9
  adapts to compose-time fetching; BSD-licensed.
- [Third-party modules guide](https://docs.tablette.bimr.net/guide/third-party-modules)
  and [Module SDK](https://docs.tablette.bimr.net/reference/module-sdk) —
  the contract this architecture complies with.
