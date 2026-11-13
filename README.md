# @tablette/module-shapefile

A [tablette](https://docs.tablette.bimr.net) third-party module that makes it
easy to **draw and outline things** in map apps: interactive drawing controls
inlined into generated Leaflet apps, shapes persisted as GeoJSON in the
workspace, and compose-time geometry seeding (circles, bounding boxes, real
OpenStreetMap objects).

## Tools

| Tool | What it does |
|------|--------------|
| `shapefile_write` | Write `shapes/<name>.geojson` to the workspace (normalizes FeatureCollection / Feature / bare geometry) |
| `shapefile_read` | Read a shape file back as GeoJSON with a summary |
| `shapefile_list` | List workspace shape files |
| `shapefile_circle` | Generate a circle polygon around a point |
| `shapefile_bbox` | Compute a bounding box as a polygon |
| `shapefile_osm_feature` | Fetch a real OSM node/way/relation and return its geometry as GeoJSON |
| `shapefile_draw_kit` | Return the dependency-free Leaflet Draw Kit to inline into a map app |

Shapes are GeoJSON (RFC 7946, EPSG:4326). Esri shapefiles are a later
import/export bridge (see `ARCHITECTURE.md`); the module never stores or
serves binary `.shp`.

## Develop

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node --test test/*.unit.ts
```

## License

MIT — see LICENSE. Geometry from OpenStreetMap is ODbL; apps built with
`shapefile_osm_feature` output must show `© OpenStreetMap contributors`.
