// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// src/index.ts — public entry: exports the descriptor (the studioModule
// export) plus the pieces tests and diagnostics may need.

export { shapefileModule } from "./module.ts";
export { createShapefileTools } from "./tools.ts";
export { DRAW_KIT } from "./drawKit.ts";
export { SHAPEFILE_PROMPT, SHAPEFILE_ATTRIBUTION, OSM_ATTRIBUTION } from "./prompts.ts";
export {
  bboxOfCollection,
  bboxPolygon,
  circleFeature,
  circleRing,
  compact,
  kindForGeometry,
  normalizeFeatures,
} from "./geometry.ts";
export { fetchOsmFeature, osmToGeojson, parseOsmXml } from "./osm.ts";
export type { FeatureCollection, ShapeFeature, ShapeGeometry } from "./types.ts";
