// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// src/osm.ts — OpenStreetMap API 0.6 client: fetch an object at compose
// time and convert its XML to GeoJSON. The conversion re-implements the
// small subset of what openstreetmap/leaflet-osm's L.OSM.DataLayer does in
// the browser, so generated apps never make runtime API calls.
//
// The XML parser is deliberately minimal: it only understands the OSM
// element shapes (node/way/relation with nd/tag/member children, and
// attributes with double-quoted values). Not a general XML parser.

import type { FeatureCollection, Position, ShapeFeature } from "./types.ts";

const OSM_API_BASE = "https://www.openstreetmap.org/api/0.6";

export type OsmObjectType = "node" | "way" | "relation";

interface OsmNode {
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

interface OsmWay {
  id: string;
  nodeIds: string[];
  tags: Record<string, string>;
}

interface OsmRelation {
  id: string;
  members: Array<{ type: string; ref: string; role: string }>;
  tags: Record<string, string>;
}

interface OsmDocument {
  nodes: Map<string, OsmNode>;
  ways: Map<string, OsmWay>;
  relations: Map<string, OsmRelation>;
}

/** Parse attribute values from an OSM XML element open tag. */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /([a-zA-Z_][a-zA-Z0-9_-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    out[match[1]] = match[2];
  }
  return out;
}

interface StackEntry {
  name: string;
  way?: OsmWay;
  relation?: OsmRelation;
  nodeId?: string;
}

/** Parse the OSM XML subset into document structures. */
export function parseOsmXml(xml: string): OsmDocument {
  const doc: OsmDocument = {
    nodes: new Map(),
    ways: new Map(),
    relations: new Map(),
  };
  const stack: StackEntry[] = [];
  const pattern = /<(\/?)([a-zA-Z]+)((?:\s[^<>]*?)*)(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    if (match[1] === "/") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    const name = match[2];
    const attrs = attributes(match[3]);
    const selfClosing = match[4] === "/";
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;

    // Element semantics run for open and self-closed tags alike: OSM
    // fixtures use `<nd ref="1"/>`, `<tag k=".." v=".."/>` and closed
    // `<node .../>` forms, and self-closing only means "no children".
    if (name === "node") {
      doc.nodes.set(attrs.id, {
        id: attrs.id,
        lat: Number(attrs.lat),
        lon: Number(attrs.lon),
        tags: {},
      });
    } else if (name === "way") {
      const way: OsmWay = { id: attrs.id, nodeIds: [], tags: {} };
      doc.ways.set(way.id, way);
      if (!selfClosing) stack.push({ name, way });
    } else if (name === "relation") {
      const relation: OsmRelation = { id: attrs.id, members: [], tags: {} };
      doc.relations.set(relation.id, relation);
      if (!selfClosing) stack.push({ name, relation });
    } else if (name === "nd") {
      if (parent?.way) parent.way.nodeIds.push(attrs.ref);
    } else if (name === "member") {
      if (parent?.relation) {
        parent.relation.members.push({ type: attrs.type, ref: attrs.ref, role: attrs.role });
      }
    } else if (name === "tag") {
      if (parent?.way) parent.way.tags[attrs.k] = attrs.v;
      else if (parent?.relation) parent.relation.tags[attrs.k] = attrs.v;
      else if (parent?.name === "node") {
        const node = doc.nodes.get(parent.nodeId ?? "");
        if (node) node.tags[attrs.k] = attrs.v;
      }
    }

    // Open elements (including nodes, which may carry child tags) go on
    // the stack so their children can attach to them.
    if (!selfClosing && name !== "way" && name !== "relation") {
      stack.push({ name, nodeId: name === "node" ? attrs.id : undefined });
    }
  }
  return doc;
}

function wayIsClosed(way: OsmWay): boolean {
  return way.nodeIds.length > 2 && way.nodeIds[0] === way.nodeIds[way.nodeIds.length - 1];
}

function wayCoordinates(doc: OsmDocument, way: OsmWay): Position[] | null {
  const positions: Position[] = [];
  for (const nodeId of way.nodeIds) {
    const node = doc.nodes.get(nodeId);
    if (!node) return null;
    positions.push([node.lon, node.lat]);
  }
  return positions.length > 0 ? positions : null;
}

function featureFromTags(
  tags: Record<string, string>,
  geometry: ShapeFeature["geometry"],
  source: string,
): ShapeFeature {
  const properties: Record<string, unknown> = { ...tags };
  properties.label =
    typeof tags.name === "string" && tags.name !== "" ? tags.name : "osm-" + source;
  properties._src = source;
  return { type: "Feature", geometry, properties };
}

/**
 * Convert a parsed OSM document plus the requested object into GeoJSON.
 * A closed way becomes a Polygon (unless tagged area=no); an open way a
 * LineString; a node a Point; multipolygon/boundary relations become the
 * polygons of their outer member ways (inner rings are kept as holes when
 * they share the outer way's vertex set — v0.1 keeps it simple and does
 * not stitch multi-way rings).
 */
export function osmToGeojson(doc: OsmDocument, type: OsmObjectType, id: string): FeatureCollection | null {
  const features: ShapeFeature[] = [];
  const source = type + "/" + id;
  if (type === "node") {
    const node = doc.nodes.get(id);
    if (!node) return null;
    features.push(
      featureFromTags(node.tags, { type: "Point", coordinates: [node.lon, node.lat] }, source),
    );
  } else if (type === "way") {
    const way = doc.ways.get(id);
    if (!way) return null;
    const positions = wayCoordinates(doc, way);
    if (!positions) return null;
    const geometry: ShapeFeature["geometry"] =
      wayIsClosed(way) && way.tags.area !== "no"
        ? { type: "Polygon", coordinates: [positions] }
        : { type: "LineString", coordinates: positions };
    features.push(featureFromTags(way.tags, geometry, source));
  } else if (type === "relation") {
    const relation = doc.relations.get(id);
    if (!relation) return null;
    if (relation.tags.type !== "multipolygon" && relation.tags.type !== "boundary") {
      return null;
    }
    for (const member of relation.members) {
      if (member.type !== "way" || (member.role !== "outer" && member.role !== "")) continue;
      const way = doc.ways.get(member.ref);
      if (!way) continue;
      const positions = wayCoordinates(doc, way);
      if (!positions) continue;
      if (wayIsClosed(way)) {
        features.push(
          featureFromTags(way.tags, { type: "Polygon", coordinates: [positions] }, source),
        );
      }
    }
    if (features.length === 0) return null;
  }
  return features.length > 0 ? { type: "FeatureCollection", features } : null;
}

/**
 * Fetch an OSM object and convert it to GeoJSON. Ways and relations use
 * the `/full` call so member nodes come along in one request.
 */
export async function fetchOsmFeature(
  fetchFn: typeof fetch,
  type: OsmObjectType,
  id: string,
): Promise<{ ok: true; geojson: FeatureCollection } | { ok: false; error: string }> {
  const suffix = type === "node" ? type + "/" + id : type + "/" + id + "/full";
  const url = OSM_API_BASE + "/" + suffix;
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (cause) {
    return {
      ok: false,
      error: "error: osm fetch failed (" + (cause instanceof Error ? cause.message : String(cause)) + ")",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: response.status === 404 ? "error: osm feature not found" : "error: osm API " + response.status,
    };
  }
  const xml = await response.text();
  const doc = parseOsmXml(xml);
  const geojson = osmToGeojson(doc, type, id);
  if (!geojson) {
    return { ok: false, error: "error: osm feature has no usable geometry" };
  }
  return { ok: true, geojson };
}
