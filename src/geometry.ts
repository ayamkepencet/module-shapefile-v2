// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// src/geometry.ts — GeoJSON normalization and the small geometry helpers.
// No geospatial library: every formula here is documented inline.

import type {
  BBox,
  FeatureCollection,
  Position,
  ShapeFeature,
  ShapeGeometry,
  ShapeKind,
} from "./types.ts";

export const R_EARTH_M = 6371008.8;

const KIND_FOR_GEOMETRY: Record<ShapeGeometry["type"], ShapeKind> = {
  Point: "point",
  LineString: "path",
  Polygon: "outline",
};

/** Map a geometry type to the module's shape kind vocabulary. */
export function kindForGeometry(geometry: ShapeGeometry): ShapeKind {
  return KIND_FOR_GEOMETRY[geometry.type];
}

function knownGeometry(value: unknown): ShapeGeometry | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (
    (candidate.type === "Point" ||
      candidate.type === "LineString" ||
      candidate.type === "Polygon") &&
    Array.isArray(candidate.coordinates)
  ) {
    return candidate as ShapeGeometry;
  }
  return null;
}

/**
 * Normalize agent output (FeatureCollection, Feature or bare geometry) into
 * a FeatureCollection whose features carry `label` and `kind` properties.
 * Returns null when the input holds no usable geometry.
 */
export function normalizeFeatures(
  input: unknown,
  fallbackLabel?: string,
): FeatureCollection | null {
  const collected: ShapeFeature[] = [];

  const pushFeature = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (record.type === "FeatureCollection" && Array.isArray(record.features)) {
      for (const feature of record.features) pushFeature(feature);
      return;
    }
    const geometry = knownGeometry(
      record.type === "Feature" ? record.geometry : record,
    );
    if (!geometry) return;
    const source = (record.properties as Record<string, unknown>) ?? {};
    const properties: Record<string, unknown> = { ...source };
    if (typeof properties.label !== "string" || properties.label === "") {
      properties.label =
        (fallbackLabel ?? "") !== ""
          ? (fallbackLabel as string)
          : "shape-" + (collected.length + 1);
    }
    if (typeof properties.kind !== "string" || properties.kind === "") {
      properties.kind = kindForGeometry(geometry);
    }
    collected.push({ type: "Feature", geometry, properties });
  };

  pushFeature(input);
  if (collected.length === 0) return null;
  return { type: "FeatureCollection", features: collected };
}

/** Bounding box of a normalized collection, or null when it is empty. */
export function bboxOfCollection(collection: FeatureCollection): BBox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  const visit = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return;
    if (
      coordinates.length === 2 &&
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number"
    ) {
      west = Math.min(west, coordinates[0]);
      south = Math.min(south, coordinates[1]);
      east = Math.max(east, coordinates[0]);
      north = Math.max(north, coordinates[1]);
      return;
    }
    for (const child of coordinates) visit(child);
  };

  for (const feature of collection.features) {
    visit(feature.geometry.coordinates);
  }
  if (west === Infinity || west > east || south > north) return null;
  return [west, south, east, north];
}

/** A polygon covering the bounding box [west, south, east, north]. */
export function bboxPolygon(box: BBox): ShapeFeature {
  const [west, south, east, north] = box;
  const ring: Position[] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: { label: "bbox", kind: "outline" },
  };
}

/**
 * Circle as a GeoJSON polygon ring, `segments` vertices around
 * (lon, lat). Equirectangular correction: the longitude step is
 * divided by cos(lat) so the ring is a true circle on the ground
 * (accurate to a few percent of the radius at mid latitudes, which
 * is what compose-time seeding needs).
 */
export function circleRing(
  lat: number,
  lon: number,
  radiusM: number,
  segments = 64,
): Position[] {
  const step = (2 * Math.PI) / segments;
  const ring: Position[] = [];
  for (let index = 0; index < segments; index += 1) {
    const bearing = index * step;
    const dy = radiusM * Math.sin(bearing) / R_EARTH_M;
    const dx = (radiusM * Math.cos(bearing)) / (R_EARTH_M * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
    ring.push([
      lon + (dx * 180) / Math.PI,
      lat + (dy * 180) / Math.PI,
    ]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/** Circle feature centered on (lat, lon) with the given radius in meters. */
export function circleFeature(
  lat: number,
  lon: number,
  radiusM: number,
  segments = 64,
): ShapeFeature {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [circleRing(lat, lon, radiusM, segments)] },
    properties: { label: "circle r=" + Math.round(radiusM) + "m", kind: "outline" },
  };
}

/** Compact JSON — no whitespace, since shapes are inlined into app HTML. */
export function compact(value: unknown): string {
  return JSON.stringify(value);
}
