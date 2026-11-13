// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// test/geometry.unit.ts — geometry helpers and the circle/bbox tools.

import test from "node:test";
import assert from "node:assert/strict";
import type { ModuleContext } from "@tablette/module-sdk";
import { shapefileModule } from "../src/index.ts";
import {
  bboxOfCollection,
  bboxPolygon,
  circleFeature,
  normalizeFeatures,
} from "../src/geometry.ts";

function context(): ModuleContext {
  return {
    settings: {},
    enabled: new Set(["shapefile"]),
    credits: [],
    trace: () => {},
    now: () => 0,
    fetch: (() => Promise.reject(new Error("no network in unit tests"))) as typeof fetch,
  };
}

/** Call a tool's execute with a loosely-typed input. */
function run(
  execute: (input: never) => Promise<unknown>,
  input: unknown,
): Promise<unknown> {
  return execute(input as never);
}

test("normalizeFeatures fills label and kind", () => {
  const collection = normalizeFeatures({
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  });
  assert.ok(collection);
  assert.equal(collection.features.length, 1);
  assert.equal(collection.features[0].properties.kind, "outline");
  assert.equal(collection.features[0].properties.label, "shape-1");
});

test("normalizeFeatures flattens nested collections and keeps custom labels", () => {
  const collection = normalizeFeatures({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [2, 3] },
        properties: { label: "keep-me" },
      },
    ],
  });
  assert.ok(collection);
  assert.equal(collection.features[0].properties.label, "keep-me");
  assert.equal(collection.features[0].properties.kind, "point");
});

test("circle geometry is a closed ring with plausible radius", () => {
  const feature = circleFeature(0, 0, 1000, 64);
  const ring = feature.geometry.coordinates[0];
  assert.equal(ring[0][0], ring[ring.length - 1][0]);
  assert.equal(ring[0][1], ring[ring.length - 1][1]);
  assert.equal(ring.length, 65); // 64 vertices + closing duplicate

  // Second vertex at the equator: 1km east is ~0.009 degrees of longitude.
  const equatorStep = ring[1][0];
  assert.ok(Math.abs(equatorStep - 0.008964) < 0.001, String(equatorStep));

  // At Paris latitude the longitude step grows by 1/cos(48.85) ~ 1.5196.
  const paris = circleFeature(48.85, 2.35, 1000, 64);
  const parisStep = paris.geometry.coordinates[0][1][0] - 2.35;
  assert.ok(Math.abs(parisStep / equatorStep - 1.5196) < 0.02, String(parisStep));
});

test("bbox helpers box points and polygonize a box", () => {
  const collection = normalizeFeatures({ type: "Point", coordinates: [1, 2] });
  assert.ok(collection);
  const box = bboxOfCollection(collection);
  assert.deepEqual(box, [1, 2, 1, 2]);
  assert.equal(bboxPolygon([1, 2, 3, 4]).geometry.type, "Polygon");
  assert.deepEqual(bboxPolygon([1, 2, 3, 4]).geometry.coordinates[0], [
    [1, 2],
    [3, 2],
    [3, 4],
    [1, 4],
    [1, 2],
  ]);
});

test("shapefile_circle tool returns GeoJSON", async () => {
  const tools = shapefileModule.createTools(context());
  const result = (await run(tools.shapefile_circle.execute, {
    lat: 48.85,
    lon: 2.35,
    radius: 500,
    segments: 16,
  })) as string;
  assert.match(result, /circle around \(48\.85, 2\.35\) r=500m/);
  assert.ok(result.includes("FeatureCollection"));
});

test("shapefile_bbox boxes pasted features", async () => {
  const tools = shapefileModule.createTools(context());
  const result = (await run(tools.shapefile_bbox.execute, {
    features: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-4.6, 48.0] },
          properties: {},
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-4.5, 48.1] },
          properties: {},
        },
      ],
    },
  })) as string;
  assert.match(result, /bbox \[-4\.6, 48, -4\.5, 48\.1\]/);
});
