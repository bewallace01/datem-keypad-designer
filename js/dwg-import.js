// js/dwg-import.js
// DWG / DWT parser using libredwg-web (WASM port of LibreDWG).
//
// Returns the same shape as parseDxfLayers in dxf-import.js so the existing
// layer-picker UI can be reused directly. The libredwg wrapper + WASM binary
// total ~14 MB; we lazy-load both via dynamic import so the base page payload
// is unaffected unless the user actually drops a DWG/DWT.

let libredwgPromise = null;

async function loadLibredwg() {
  if (!libredwgPromise) {
    libredwgPromise = (async () => {
      const mod = await import("../vendor/libredwg/libredwg-web.js");
      // LibreDwg.create(path) loads the wasm + glue from the given dir.
      const inst = await mod.LibreDwg.create("./vendor/libredwg/wasm/");
      return { LibreDwg: mod.LibreDwg, Dwg_File_Type: mod.Dwg_File_Type, inst };
    })();
  }
  return libredwgPromise;
}

// Parse a DWG/DWT once and return both layers and blocks. Loads the WASM
// module on demand (lazy). The wrapper handles the bottom-up vs top-down
// concerns; we just walk db.tables and db.entities.
export async function parseDwgFile(arrayBuffer) {
  const { Dwg_File_Type, inst } = await loadLibredwg();
  const dwg = inst.dwg_read_data(arrayBuffer, Dwg_File_Type.DWG);
  if (!dwg) throw new Error("libredwg couldn't read the file");
  const db = inst.convert(dwg);

  const layerEntries = (db && db.tables && db.tables.LAYER && db.tables.LAYER.entries) || [];
  const blockEntries = (db && db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [];

  // Walk all entities once. We need:
  //   1. layer entity counts (anything on a layer)
  //   2. block insert usage by (blockName, layer)
  const entityCounts = {};
  const insertUsage = {}; // blockName -> { byLayer: {layer: count}, total }
  for (const ent of db.entities || []) {
    const layerName = ent.layer || ent.layerName || ent.Layer;
    if (layerName) entityCounts[layerName] = (entityCounts[layerName] || 0) + 1;
    // libredwg's INSERT entities expose the block name under a variety of
    // property names depending on version; try the common ones.
    const type = (ent.type || ent.entityType || "").toString().toUpperCase();
    if (type === "INSERT" || type === "ACDBBLOCKREFERENCE") {
      const blockName = ent.name || ent.blockName || ent.block;
      if (blockName) {
        if (!insertUsage[blockName]) insertUsage[blockName] = { byLayer: {}, total: 0 };
        const l = layerName || "0";
        insertUsage[blockName].byLayer[l] = (insertUsage[blockName].byLayer[l] || 0) + 1;
        insertUsage[blockName].total++;
      }
    }
  }

  const layers = layerEntries
    .filter((l) => l.name && l.name !== "0" && !l.name.startsWith("*"))
    .map((l) => ({
      name: l.name,
      aci: typeof l.colorIndex === "number" ? Math.abs(l.colorIndex) : 7,
      off: !!l.off,
      frozen: !!l.frozen,
      locked: !!l.locked,
      linetype: l.lineType || "Continuous",
      lineweight: typeof l.lineweight === "number" ? l.lineweight : -3,
      entityCount: entityCounts[l.name] || 0,
    }));

  const blocks = blockEntries
    .filter((b) => b.name && !b.name.startsWith("*"))
    .map((b) => {
      const u = insertUsage[b.name];
      let dominantLayer = null, total = 0;
      if (u) {
        total = u.total;
        let best = null, bestN = 0;
        for (const [layer, n] of Object.entries(u.byLayer)) {
          if (n > bestN) { bestN = n; best = layer; }
        }
        dominantLayer = best;
      }
      // libredwg doesn't expose entity counts per block as easily; estimate
      // via the entities array's ownership chain isn't reliable, so we
      // report 0 here and let the UI omit the count.
      return { name: b.name, entityCount: 0, dominantLayer, totalInserts: total };
    });

  inst.dwg_free(db);
  return { layers, blocks };
}

// Back-compat shim — existing callers expect just the layers array.
export async function parseDwgLayers(arrayBuffer) {
  const { layers } = await parseDwgFile(arrayBuffer);
  return layers;
}
