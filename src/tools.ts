// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// src/tools.ts — the shapefile_* tools. Every tool returns a string
// (errors as "error: ..." lines, never thrown), per the module contract.

import { tool } from "ai";
import { z } from "zod";
import type { ModuleContext } from "@tablette/module-sdk";
import { DRAW_KIT } from "./drawKit.ts";
import {
  bboxOfCollection,
  bboxPolygon,
  circleFeature,
  compact,
  normalizeFeatures,
} from "./geometry.ts";
import { fetchOsmFeature } from "./osm.ts";
import type { FeatureCollection } from "./types.ts";
import { OSM_ATTRIBUTION } from "./prompts.ts";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SHAPES_DIR = "shapes";

function shapePath(name: string): string {
  return SHAPES_DIR + "/" + name + ".geojson";
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Read a shape file from the workspace; errors come back as strings. */
async function readShapeFile(
  ctx: ModuleContext,
  name: string,
): Promise<{ ok: true; collection: FeatureCollection } | { ok: false; error: string }> {
  const workspace = ctx.workspace;
  if (!workspace) {
    return { ok: false, error: "error: workspace not available in this mode" };
  }
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, error: "error: name must match ^[a-z0-9][a-z0-9-]*$" };
  }
  const path = shapePath(name);
  let raw: string;
  try {
    raw = await workspace.readFile(path);
  } catch {
    return { ok: false, error: "error: shapes/" + name + ".geojson not found (use shapefile_list)" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "error: shapes/" + name + ".geojson is not valid JSON" };
  }
  const collection = normalizeFeatures(parsed);
  if (!collection) {
    return { ok: false, error: "error: shapes/" + name + ".geojson holds no usable geometry" };
  }
  return { ok: true, collection };
}

export function createShapefileTools(ctx: ModuleContext) {
  return {
    shapefile_write: tool({
      description:
        "Write shapes to the workspace as shapes/<name>.geojson (a GeoJSON FeatureCollection). " +
        "Accepts a FeatureCollection, a single Feature or a bare geometry; label and kind are added.",
      inputSchema: z.object({
        name: z.string().min(1).describe("File name without extension, e.g. quimper-port"),
        features: z
          .unknown()
          .describe("GeoJSON FeatureCollection, Feature or bare geometry (lon/lat, EPSG:4326)"),
        label: z
          .string()
          .optional()
          .describe("Fallback label for features that do not carry one"),
      }),
      execute: async ({ name, features, label }) => {
        const start = ctx.now();
        if (!NAME_PATTERN.test(name)) {
          return "error: name must match ^[a-z0-9][a-z0-9-]*$";
        }
        if (!ctx.workspace) return "error: workspace not available in this mode";
        const collection = normalizeFeatures(features, label);
        if (!collection) {
          return "error: features hold no usable geometry (Point, LineString or Polygon)";
        }
        const path = shapePath(name);
        try {
          await ctx.workspace.writeFile(path, compact(collection));
        } catch (cause) {
          return "error: writing " + path + " failed (" + errorText(cause) + ")";
        }
        ctx.trace("shapefile_write", start, path + " (" + collection.features.length + " features)");
        const box = bboxOfCollection(collection);
        return (
          "wrote " +
          path +
          " — " +
          collection.features.length +
          " feature(s) " +
          (box ? "bbox [" + box.join(", ") + "]" : "")
        );
      },
    }),

    shapefile_read: tool({
      description:
        "Read a shape file (shapes/<name>.geojson) and return its GeoJSON plus a one-line summary.",
      inputSchema: z.object({
        name: z.string().min(1).describe("File name without extension"),
      }),
      execute: async ({ name }) => {
        const start = ctx.now();
        const result = await readShapeFile(ctx, name);
        if (!result.ok) return result.error;
        ctx.trace("shapefile_read", start, shapePath(name));
        const box = bboxOfCollection(result.collection);
        const kinds = result.collection.features
          .map((feature) => feature.geometry.type)
          .join(", ");
        return (
          "shapes/" +
          name +
          ".geojson — " +
          result.collection.features.length +
          " feature(s) (" +
          kinds +
          ") " +
          (box ? "bbox [" + box.join(", ") + "]" : "") +
          "\n" +
          compact(result.collection)
        );
      },
    }),

    shapefile_list: tool({
      description: "List the GeoJSON shape files in the workspace with a per-file summary.",
      inputSchema: z.object({}),
      execute: async () => {
        const start = ctx.now();
        if (!ctx.workspace) return "error: workspace not available in this mode";
        const files = (await ctx.workspace.listFiles()).filter(
          (file) => file.startsWith(SHAPES_DIR + "/") && file.endsWith(".geojson"),
        );
        if (files.length === 0) {
          return "no shape files in shapes/ yet (create one with shapefile_write)";
        }
        ctx.trace("shapefile_list", start, files.length + " file(s)");
        const lines: string[] = [];
        for (const file of files) {
          const name = file.slice(SHAPES_DIR.length + 1, -".geojson".length);
          const result = await readShapeFile(ctx, name);
          if (!result.ok) {
            lines.push(file + " — " + result.error);
            continue;
          }
          const box = bboxOfCollection(result.collection);
          lines.push(
            file +
              " — " +
              result.collection.features.length +
              " feature(s) " +
              (box ? "bbox [" + box.join(", ") + "]" : ""),
          );
        }
        return lines.join("\n");
      },
    }),

    shapefile_circle: tool({
      description:
        "Generate a circle polygon (GeoJSON) around a point, e.g. to outline '2 km around X'.",
      inputSchema: z.object({
        lat: z.number().min(-90).max(90).describe("Center latitude"),
        lon: z.number().min(-180).max(180).describe("Center longitude"),
        radius: z.number().min(1).max(2000000).describe("Radius in meters"),
        segments: z
          .number()
          .int()
          .min(8)
          .max(256)
          .optional()
          .describe("Ring vertices (default 64)"),
      }),
      execute: async ({ lat, lon, radius, segments }) => {
        const start = ctx.now();
        const feature = circleFeature(lat, lon, radius, segments ?? 64);
        ctx.trace("shapefile_circle", start, "r=" + Math.round(radius) + "m");
        const collection: FeatureCollection = { type: "FeatureCollection", features: [feature] };
        return "circle around (" + lat + ", " + lon + ") r=" + Math.round(radius) + "m\n" + compact(collection);
      },
    }),

    shapefile_bbox: tool({
      description:
        "Compute the bounding box of a shape file (or pasted GeoJSON) and return it as a polygon.",
      inputSchema: z.object({
        name: z.string().min(1).optional().describe("Workspace shape file name without extension"),
        features: z.unknown().optional().describe("GeoJSON to box directly, when not reading a file"),
      }),
      execute: async ({ name, features }) => {
        const start = ctx.now();
        let collection: FeatureCollection | null = null;
        if (features !== undefined) {
          collection = normalizeFeatures(features);
          if (!collection) return "error: features hold no usable geometry";
        } else if (name !== undefined) {
          const result = await readShapeFile(ctx, name);
          if (!result.ok) return result.error;
          collection = result.collection;
        } else {
          return "error: pass either name or features";
        }
        const box = bboxOfCollection(collection);
        if (!box) return "error: no coordinates to box";
        ctx.trace("shapefile_bbox", start, "[" + box.join(", ") + "]");
        const outline: FeatureCollection = {
          type: "FeatureCollection",
          features: [bboxPolygon(box)],
        };
        return "bbox [" + box.join(", ") + "]\n" + compact(outline);
      },
    }),

    shapefile_osm_feature: tool({
      description:
        "Fetch a real OpenStreetMap object (node, way or relation id) at compose time and return " +
        "its geometry as GeoJSON, e.g. to outline a building or trace a path. Attribution " +
        "'" + OSM_ATTRIBUTION + "' must be shown in apps built with this geometry.",
      inputSchema: z.object({
        type: z.enum(["node", "way", "relation"]).describe("OSM object type"),
        id: z.string().min(1).describe("OSM object id"),
      }),
      execute: async ({ type, id }) => {
        const start = ctx.now();
        const result = await fetchOsmFeature(ctx.fetch, type, id);
        if (!result.ok) return result.error;
        ctx.trace("shapefile_osm_feature", start, type + "/" + id);
        return (
          "osm " +
          type +
          "/" +
          id +
          " — " +
          result.geojson.features.length +
          " feature(s). Show '" +
          OSM_ATTRIBUTION +
          "' in any app built from this geometry.\n" +
          compact(result.geojson)
        );
      },
    }),

    shapefile_draw_kit: tool({
      description:
        "Return the Draw Kit script (dependency-free Leaflet drawing controls) to inline " +
        "verbatim into a map app's <script>; then call DrawKit.mount(map, { seed: DATA || null }).",
      inputSchema: z.object({}),
      execute: async () => {
        const start = ctx.now();
        ctx.trace("shapefile_draw_kit", start, String(DRAW_KIT.length) + " chars");
        return DRAW_KIT.trim();
      },
    }),
  };
}
