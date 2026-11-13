// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// test/osm.unit.ts — OSM XML -> GeoJSON conversion, against fixtures only.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ModuleContext } from "@tablette/module-sdk";
import { shapefileModule, fetchOsmFeature, osmToGeojson, parseOsmXml } from "../src/index.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURES), "utf8");
}

test("node fixture converts to a Point with tags", () => {
  const doc = parseOsmXml(fixture("node.xml"));
  const geojson = osmToGeojson(doc, "node", "164979149");
  assert.ok(geojson);
  assert.equal(geojson.features.length, 1);
  const feature = geojson.features[0];
  assert.equal(feature.geometry.type, "Point");
  assert.deepEqual(feature.geometry.coordinates, [-4.5433424, 47.9490211]);
  assert.equal(feature.properties.name, "Test Node");
  assert.equal(feature.properties._src, "node/164979149");
  assert.equal(feature.properties.label, "Test Node");
});

test("closed way becomes a Polygon, open way stays a LineString", () => {
  const doc = parseOsmXml(fixture("ways-full.xml"));
  const building = osmToGeojson(doc, "way", "52477381");
  assert.ok(building);
  assert.equal(building.features[0].geometry.type, "Polygon");
  assert.equal(building.features[0].properties.label, "Test Building");

  const path = osmToGeojson(doc, "way", "900000001");
  assert.ok(path);
  assert.equal(path.features[0].geometry.type, "LineString");
  assert.equal(path.features[0].geometry.coordinates.length, 3);
});

test("multipolygon relation yields its outer member polygons", () => {
  const doc = parseOsmXml(fixture("relation-full.xml"));
  const geojson = osmToGeojson(doc, "relation", "700001");
  assert.ok(geojson);
  assert.equal(geojson.features.length, 1);
  assert.equal(geojson.features[0].geometry.type, "Polygon");
});

test("osmToGeojson returns null for a missing object", () => {
  const doc = parseOsmXml(fixture("node.xml"));
  assert.equal(osmToGeojson(doc, "way", "42"), null);
});

test("fetchOsmFeature wires fetch -> parse -> convert and surfaces errors as strings", async () => {
  async function fakeFetch(url: string): Promise<Response> {
    assert.ok(String(url).endsWith("/way/52477381/full"), String(url));
    return new Response(fixture("ways-full.xml"), { status: 200 });
  }

  const result = await fetchOsmFeature(fakeFetch as typeof fetch, "way", "52477381");
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.geojson.features[0].geometry.type, "Polygon");
  }

  async function notFound(): Promise<Response> {
    return new Response("gone", { status: 404 });
  }
  const missing = await fetchOsmFeature(notFound as typeof fetch, "way", "1");
  assert.ok(!missing.ok);
  if (!missing.ok) assert.match(missing.error, /^error: osm feature not found/);
});

test("the osm tool composes attribution and GeoJSON", async () => {
  const context: ModuleContext = {
    settings: {},
    enabled: new Set(["shapefile"]),
    credits: [],
    trace: () => {},
    now: () => 0,
    async fetch(_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
      return new Response(fixture("ways-full.xml"), { status: 200 });
    },
  };
  const tools = shapefileModule.createTools(context);
  const call = tools.shapefile_osm_feature as unknown as {
    execute: (input: unknown) => Promise<string>;
  };
  const output = await call.execute({ type: "way", id: "52477381" });
  assert.match(output, /osm way\/52477381/);
  assert.match(output, /© OpenStreetMap contributors/);
  assert.ok(output.includes("FeatureCollection"));
});
