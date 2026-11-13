// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// src/module.ts — the Studio module descriptor.

import type { StudioModule } from "@tablette/module-sdk";
import { createShapefileTools } from "./tools.ts";
import { SHAPEFILE_ATTRIBUTION, SHAPEFILE_PROMPT } from "./prompts.ts";

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
