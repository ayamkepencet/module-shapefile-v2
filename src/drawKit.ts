// SPDX-FileCopyrightText: 2026 module-shapefile-v2 contributors
// SPDX-License-Identifier: MIT

// src/drawKit.ts — the Draw Kit source, exported as a string.
//
// The kit is plain JavaScript with no dependency beyond Leaflet itself.
// The agent inlines the source verbatim into a composed map app (via the
// shapefile_draw_kit tool), so it must stay browser-only, side-effect
// isolated until DrawKit.mount() is called, and free of template literals
// inside the String.raw block below (backticks and ${ would break it).

const KIT_SOURCE = String.raw`
/* Draw Kit v0.1 — dependency-free Leaflet drawing controls.
   Embed verbatim in the app <script> after the Leaflet map is created, then
   call DrawKit.mount(map, { seed: <GeoJSON FeatureCollection or null> }). */
window.DrawKit = (function () {
  "use strict";

  var OUTLINE = "outline", PATH = "path", POINT = "point";

  function kindForGeometry(type) {
    if (type === "Polygon") return "outline";
    if (type === "LineString") return "path";
    return "point";
  }

  function mount(map, opts) {
    opts = opts || {};
    var shapes = [];        // [{ geometry: {type, coordinates}, properties }]
    var layers = [];        // parallel: Leaflet layer per shape
    var counters = { outline: 0, path: 0, point: 0 };
    var mode = null;
    var draft = [];         // draft vertices while outline/path is active
    var draftLayer = null;
    var handles = [];       // edit handles for the shape being edited

    injectStyle();

    // ---- palette ---------------------------------------------------------

    var Palette = L.Control.extend({
      options: { position: "topright" },
      onAdd: function () {
        var box = L.DomUtil.create("div", "drawkit-palette");
        addButtons(box, [
          ["Outline", OUTLINE],
          ["Path", PATH],
          ["Point", POINT],
          ["Edit", "edit"],
          ["Delete", "delete"],
          ["Export", "export"]
        ]);
        return box;
      }
    });
    map.addControl(new Palette());
    map.doubleClickZoom.disable();

    function addButtons(box, defs) {
      for (var index = 0; index < defs.length; index += 1) {
        (function (pair) {
          var btn = L.DomUtil.create("button", "drawkit-btn", box);
          btn.textContent = pair[0];
          L.DomEvent.on(btn, "click", function (event) {
            L.DomEvent.preventDefault(event);
            L.DomEvent.stopPropagation(event);
            if (mode === pair[1]) {
              setMode(null);
            } else {
              setMode(pair[1]);
            }
          });
        })(defs[index]);
      }
    }

    function setMode(next) {
      mode = next;
      cancelDraft();
      endEdit();
      if (mode === OUTLINE || mode === PATH) {
        document.body.style.cursor = "crosshair";
      } else {
        document.body.style.cursor = "";
      }
    }

    // ---- styles ----------------------------------------------------------

    function injectStyle() {
      if (document.getElementById("drawkit-style")) return;
      var style = document.createElement("style");
      style.id = "drawkit-style";
      style.textContent =
        ".drawkit-palette{background:rgba(255,255,255,.92);padding:8px;border-radius:8px;" +
        "box-shadow:0 2px 8px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:4px}" +
        ".drawkit-btn{font:600 12px/1.2 system-ui,sans-serif;padding:6px 10px;border:1px solid #ccc;" +
        "border-radius:6px;background:#fff;cursor:pointer;text-align:center}" +
        ".drawkit-btn:hover{background:#f0f7ff}.drawkit-active{background:#3770c9;color:#fff}" +
        ".drawkit-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;" +
        "align-items:center;justify-content:center;z-index:10000}" +
        ".drawkit-modal-box{background:#fff;border-radius:8px;padding:16px;width:min(90vw,600px);" +
        "display:flex;flex-direction:column;gap:8px}" +
        ".drawkit-modal-box textarea{width:100%;height:200px;font:12px/1.4 monospace;border:1px solid #ccc}" +
        ".drawkit-modal-row{display:flex;gap:8px;justify-content:flex-end}" +
        ".drawkit-hint{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
        "background:rgba(0,0,0,.7);color:#fff;font:12px system-ui;padding:6px 12px;border-radius:6px;" +
        "z-index:9999;pointer-events:none}";
      document.head.appendChild(style);
    }

    var hint = null;
    function showHint(text) {
      hideHint();
      hint = document.createElement("div");
      hint.className = "drawkit-hint";
      hint.textContent = text;
      document.body.appendChild(hint);
    }
    function hideHint() {
      if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
      hint = null;
    }

    // ---- geometry helpers ------------------------------------------------

    function toPosition(latlng) { return [latlng.lng, latlng.lat]; }

    function extractPositions(feature) {
      var geometry = feature.geometry;
      var out = [];
      function visit(value) {
        if (!Array.isArray(value)) return;
        if (value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number") {
          out.push([value[0], value[1]]);
          return;
        }
        for (var i = 0; i < value.length; i += 1) visit(value[i]);
      }
      visit(geometry.coordinates);
      return out;
    }

    // ---- feature layers --------------------------------------------------

    function addShape(feature) {
      if (!feature.properties) feature.properties = {};
      if (!feature.properties.label) {
        var kind = kindForGeometry(feature.geometry.type);
        counters[kind] += 1;
        feature.properties.label = kind + "-" + counters[kind];
      }
      if (!feature.properties.kind) feature.properties.kind = kindForGeometry(feature.geometry.type);
      var container = L.geoJSON(feature, {
        style: { color: "#3770c9", weight: 2, fillColor: "#3770c9", fillOpacity: 0.15 }
      });
      container.addTo(map);
      var index = shapes.length;
      shapes.push(feature);
      layers.push(container);
      container.eachLayer(function (layer) {
        layer.on("click", function () { onFeatureClick(index); });
      });
      return index;
    }

    function removeShape(index) {
      if (index < 0 || index >= shapes.length) return;
      map.removeLayer(layers[index]);
      shapes.splice(index, 1);
      layers.splice(index, 1);
      var stale = handles;
      endEdit();
      for (var i = 0; i < stale.length; i += 1) map.removeLayer(stale[i]);
    }

    function onFeatureClick(index) {
      if (mode === "delete") {
        removeShape(index);
      } else if (mode === "edit") {
        startEdit(index);
      }
    }

    // ---- drawing modes ---------------------------------------------------

    map.on("click", function (event) {
      if (mode === OUTLINE || mode === PATH) {
        draft.push(event.latlng);
        redrawDraft();
      } else if (mode === POINT) {
        addShape({
          type: "Feature",
          geometry: { type: "Point", coordinates: toPosition(event.latlng) },
          properties: {}
        });
      }
    });

    map.on("dblclick", function (event) {
      if (mode !== OUTLINE && mode !== PATH) return;
      L.DomEvent.stopPropagation(event);
      // The double-click already fired a click that appended a duplicate
      // vertex; drop it before finishing.
      if (draft.length > 1) draft.pop();
      finishDraft();
    });

    function redrawDraft() {
      if (draftLayer) { map.removeLayer(draftLayer); draftLayer = null; }
      if (draft.length === 0) return;
      var latlngs = draft.slice();
      var previewShape = mode === OUTLINE && draft.length > 2;
      if (previewShape) latlngs.push(draft[0]);
      var options = { color: "#d97706", weight: 2, dashArray: "6 4" };
      draftLayer = previewShape ? L.polygon(latlngs, options) : L.polyline(latlngs, options);
      draftLayer.addTo(map);
      if (draft.length === 1) {
        showHint(mode === OUTLINE ? "Click to add vertices, double-click to close the outline"
                                  : "Click to add vertices, double-click to end the path");
      }
    }

    function cancelDraft() {
      draft = [];
      if (draftLayer) { map.removeLayer(draftLayer); draftLayer = null; }
      hideHint();
    }

    function finishDraft() {
      if (mode === OUTLINE && draft.length >= 3) {
        var positions = [];
        for (var i = 0; i < draft.length; i += 1) positions.push(toPosition(draft[i]));
        positions.push(positions[0]);
        addShape({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [positions] },
          properties: {}
        });
      } else if (mode === PATH && draft.length >= 2) {
        var line = [];
        for (var j = 0; j < draft.length; j += 1) line.push(toPosition(draft[j]));
        addShape({
          type: "Feature",
          geometry: { type: "LineString", coordinates: line },
          properties: {}
        });
      }
      cancelDraft();
    }

    // ---- vertex editing ---------------------------------------------------

    function startEdit(index) {
      endEdit();
      var positions = extractPositions(shapes[index]);
      for (var i = 0; i < positions.length; i += 1) {
        var handle = L.marker([positions[i][1], positions[i][0]], { draggable: true });
        (function (marker, position) {
          marker.on("drag", function () {
            var center = marker.getLatLng();
            position[0] = center.lng;
            position[1] = center.lat;
            redrawFeature(index);
          });
        })(handle, positions[i]);
        handle.addTo(map);
        handles.push(handle);
      }
      showHint("Drag handles to edit, click the map to finish");
    }

    function endEdit() {
      for (var i = 0; i < handles.length; i += 1) map.removeLayer(handles[i]);
      handles = [];
    }

    function redrawFeature(index) {
      map.removeLayer(layers[index]);
      var container = L.geoJSON(shapes[index], {
        style: { color: "#3770c9", weight: 2, fillColor: "#3770c9", fillOpacity: 0.15 }
      });
      container.addTo(map);
      layers[index] = container;
      var keep = index;
      container.eachLayer(function (layer) {
        layer.on("click", function () { onFeatureClick(keep); });
      });
    }

    map.on("click", function () {
      if (mode === "edit") { endEdit(); hideHint(); }
    });

    // ---- export -----------------------------------------------------------

    function exportShapes() {
      var text = JSON.stringify({ type: "FeatureCollection", features: shapes });
      showExportModal(text);
    }

    function showExportModal(text) {
      var modal = document.createElement("div");
      modal.className = "drawkit-modal";
      var box = document.createElement("div");
      box.className = "drawkit-modal-box";
      var title = document.createElement("strong");
      title.textContent = "Shapes (GeoJSON) — copy or download, then paste in chat to persist";
      var area = document.createElement("textarea");
      area.readOnly = true;
      area.value = text;
      var row = document.createElement("div");
      row.className = "drawkit-modal-row";
      var copy = document.createElement("button");
      copy.className = "drawkit-btn";
      copy.textContent = "Copy";
      var download = document.createElement("button");
      download.className = "drawkit-btn";
      download.textContent = "Download";
      var close = document.createElement("button");
      close.className = "drawkit-btn";
      close.textContent = "Close";
      row.appendChild(copy);
      row.appendChild(download);
      row.appendChild(close);
      box.appendChild(title);
      box.appendChild(area);
      box.appendChild(row);
      modal.appendChild(box);
      document.body.appendChild(modal);

      L.DomEvent.on(copy, "click", function () {
        area.select();
        area.setSelectionRange(0, 999999);
        var done = document.execCommand("copy");
        area.setSelectionRange(0, 0);
        copy.textContent = done ? "Copied" : "Select & copy manually";
      });
      L.DomEvent.on(download, "click", function () {
        try {
          var blob = new Blob([text], { type: "application/geo+json" });
          var link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = "shapes.geojson";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (cause) {
          download.textContent = "Download blocked";
        }
      });
      L.DomEvent.on(close, "click", function () {
        if (modal.parentNode) modal.parentNode.removeChild(modal);
      });
    }

    // ---- seed -------------------------------------------------------------

    if (opts.seed && typeof opts.seed === "object" && Array.isArray(opts.seed.features)) {
      for (var seedIndex = 0; seedIndex < opts.seed.features.length; seedIndex += 1) {
        addShape(opts.seed.features[seedIndex]);
      }
    }

    return {
      shapes: shapes,
      export: exportShapes
    };
  }

  return { mount: mount, version: "0.1.0" };
})();
`;

/** The Draw Kit source, as a string for the shapefile_draw_kit tool. */
export const DRAW_KIT: string = KIT_SOURCE;
