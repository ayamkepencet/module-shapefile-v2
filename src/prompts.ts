// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// src/prompts.ts — the module prompt section and attribution lines.

export const SHAPEFILE_ATTRIBUTION =
  "Outlines drawn with the shapefile module (module-shapefile)";

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

export const SHAPEFILE_PROMPT = `## Shapefile (drawing shapes)

When the user wants to outline, draw, trace or shade things on a map app:

1. **Embed the drawing controls.** Call \`shapefile_draw_kit\` and inline the returned script verbatim into the app's \`<script>\`, after the Leaflet map is created; add \`DrawKit.mount(map, { seed: DATA || null })\` to the app script. The kit has no dependencies beyond Leaflet.
2. **Seed shapes.** If workspace \`shapes/*.geojson\` files exist, read them with \`shapefile_read\` and inline them as the app's \`var DATA\` (one FeatureCollection).
3. **Seed from OSM.** When the user names a real OSM object (a building, a path, with an id or a clear reference), fetch its geometry first with \`shapefile_osm_feature\` and never hand-guess OSM geometry.
4. **Persist the round trip.** GeoJSON exported from the Draw Kit and pasted in chat must be persisted with \`shapefile_write\` before the next compose, then re-composed with the shapes inlined so the user keeps drawing on top of them.

Conventions: shapes live in \`shapes/<name>.geojson\` as a FeatureCollection; each feature carries \`label\` (string) and \`kind\` (\`outline\` | \`path\` | \`point\`) properties — \`shapefile_write\` adds them automatically. \`shapefile_circle\` and \`shapefile_bbox\` generate seed geometry.

Attribution: show "${SHAPEFILE_ATTRIBUTION}" in apps built with drawn shapes, and "${OSM_ATTRIBUTION}" whenever geometry from \`shapefile_osm_feature\` is included.

Limitations: GeoJSON only (EPSG:4326, longitude/latitude order); no binary .shp support yet; the sandboxed viewer blocks downloads, so Draw Kit exports are shared as text (a modal with a copyable textarea) — paste them in chat to persist.`;
