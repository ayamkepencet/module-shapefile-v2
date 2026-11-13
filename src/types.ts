// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// src/types.ts — local GeoJSON (RFC 7946) subset used by the module.
// Kept dependency-free so the package typechecks and tests in plain Node.

export type Position = [number, number];

export type PointGeometry = { type: "Point"; coordinates: Position };
export type LineStringGeometry = { type: "LineString"; coordinates: Position[] };
export type PolygonGeometry = {
  type: "Polygon";
  coordinates: Position[][];
};

export type ShapeGeometry = PointGeometry | LineStringGeometry | PolygonGeometry;

export interface ShapeFeature {
  type: "Feature";
  geometry: ShapeGeometry;
  properties: Record<string, unknown>;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: ShapeFeature[];
}

/** Feature kinds the Draw Kit and the tools agree on. */
export type ShapeKind = "outline" | "path" | "point";

/** Bounding box: [west, south, east, north]. */
export type BBox = [number, number, number, number];
