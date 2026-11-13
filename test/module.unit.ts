// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// test/module.unit.ts — descriptor validation and tool contract.

import test from "node:test";
import assert from "node:assert/strict";
import { validateModules } from "@tablette/module-sdk";
import type { ModuleContext, ModuleWorkspace } from "@tablette/module-sdk";
import { shapefileModule, DRAW_KIT, SHAPEFILE_PROMPT } from "../src/index.ts";

/** In-memory ModuleWorkspace for the write/read/list round trip. */
function fakeWorkspace(): ModuleWorkspace & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const listeners: Array<(files: string[]) => void> = [];
  return {
    files,
    listFiles: async () => [...files.keys()],
    readFile: async (path) => {
      if (!files.has(path)) throw new Error("not found: " + path);
      return files.get(path) as string;
    },
    writeFile: async (path, content) => {
      files.set(path, content);
      for (const listener of listeners) listener([...files.keys()]);
    },
    exists: async (path) => files.has(path),
    openFile: async () => {},
    subscribeFiles: (listener) => {
      listeners.push(listener);
      return () => {};
    },
  };
}

function context(overrides: Partial<ModuleContext> = {}): ModuleContext {
  return {
    settings: {},
    enabled: new Set(["shapefile"]),
    credits: [],
    trace: () => {},
    now: () => 0,
    fetch: (() => Promise.reject(new Error("no network in unit tests"))) as typeof fetch,
    ...overrides,
  };
}

test("descriptor is valid", () => {
  assert.deepEqual(validateModules([shapefileModule]), []);
});

test("descriptor fields follow the contract", () => {
  assert.equal(shapefileModule.id, "shapefile");
  assert.equal(shapefileModule.version, "0.1.0");
  assert.ok(shapefileModule.modes.length > 0);
  assert.ok(shapefileModule.dataSources.length === 1);
  assert.ok(SHAPEFILE_PROMPT.length > 0);
});

test("tools carry the module prefix and never throw for a stub context", () => {
  const tools = shapefileModule.createTools(context());
  const names = Object.keys(tools);
  assert.ok(names.length >= 6);
  for (const name of names) {
    assert.ok(name.startsWith("shapefile_"), name);
  }
});

test("draw kit ships and mentions Leaflet mount", () => {
  assert.ok(DRAW_KIT.includes("DrawKit.mount"));
  assert.ok(DRAW_KIT.includes("window.DrawKit"));
});

test("shapefile_write then shapefile_read round-trips through the workspace", async () => {
  const workspace = fakeWorkspace();
  const tools = shapefileModule.createTools(context({ workspace }));

  const written = (await tools.shapefile_write.execute({
    name: "test-outline",
    features: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-4.6, 48.0],
            [-4.59, 48.0],
            [-4.59, 48.01],
            [-4.6, 48.0],
          ],
        ],
      },
      properties: {},
    },
  } as never)) as string;
  assert.match(written, /wrote shapes\/test-outline\.geojson/);

  const read = (await tools.shapefile_read.execute({
    name: "test-outline",
  } as never)) as string;
  assert.match(read, /1 feature\(s\)/);
  assert.ok(read.includes("FeatureCollection"));

  const listed = (await tools.shapefile_list.execute({} as never)) as string;
  assert.match(listed, /shapes\/test-outline\.geojson/);
});

test("shapefile_write rejects invalid names and empty geometry", async () => {
  const tools = shapefileModule.createTools(context({ workspace: fakeWorkspace() }));
  const badName = (await tools.shapefile_write.execute({
    name: "Bad Name!",
    features: { type: "Point", coordinates: [0, 0] },
  } as never)) as string;
  assert.match(badName, /^error: name/);

  const empty = (await tools.shapefile_write.execute({
    name: "empty",
    features: { type: "FeatureCollection", features: [] },
  } as never)) as string;
  assert.match(empty, /^error: /);
});

test("shapefile_read reports a missing file as an error string", async () => {
  const tools = shapefileModule.createTools(context({ workspace: fakeWorkspace() }));
  const result = (await tools.shapefile_read.execute({ name: "nope" } as never)) as string;
  assert.match(result, /^error: shapes\/nope\.geojson not found/);
});

test("tools fail gracefully without a workspace", async () => {
  const tools = shapefileModule.createTools(context());
  const write = (await tools.shapefile_write.execute({
    name: "x",
    features: { type: "Point", coordinates: [0, 0] },
  } as never)) as string;
  assert.match(write, /^error: workspace not available/);
});
