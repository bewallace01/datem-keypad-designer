// js/dxf-import.js
// Parse the LAYER table out of an AutoCAD DXF file and turn selected layers
// into keypad buttons.
//
// DXF is text: pairs of (group-code, value) lines. We only need a tiny slice:
// the LAYER table inside the TABLES section.
//
// Layer properties we read:
//   2   - layer name
//   6   - linetype
//   62  - ACI color; negative value means the layer is OFF
//   70  - flags (bit 0 = frozen, bit 2 = locked)
//   370 - lineweight

// Walk the ENTITIES section and tally entities-per-layer. Layers in the
// LAYER table with zero entities here are "defined but unused" — they exist
// for organizational reasons but the compiler hasn't collected anything on
// them yet, so they probably aren't worth a keypad button for this project.
function countEntitiesByLayer(lines) {
  const counts = {};
  let i = 0;
  while (i < lines.length - 3) {
    if (lines[i].trim() === "0" && lines[i + 1] === "SECTION" &&
        lines[i + 2].trim() === "2" && lines[i + 3] === "ENTITIES") {
      i += 4;
      break;
    }
    i++;
  }
  if (i >= lines.length) return counts;
  let currentLayer = null;
  while (i < lines.length - 1) {
    const code = lines[i].trim();
    const val = lines[i + 1];
    if (code === "0") {
      if (val === "ENDSEC") break;
      if (currentLayer != null) counts[currentLayer] = (counts[currentLayer] || 0) + 1;
      currentLayer = null;
    } else if (code === "8" && currentLayer == null) {
      currentLayer = val;
    }
    i += 2;
  }
  if (currentLayer != null) counts[currentLayer] = (counts[currentLayer] || 0) + 1;
  return counts;
}

export function parseDxfLayers(text) {
  const lines = text.split(/\r?\n/);
  const entityCounts = countEntitiesByLayer(lines);
  const layers = [];

  // Find the LAYER table: pattern is `0\nTABLE\n2\nLAYER`.
  let i = 0;
  for (; i < lines.length - 3; i++) {
    if (
      lines[i].trim() === "0" &&
      lines[i + 1] === "TABLE" &&
      lines[i + 2].trim() === "2" &&
      lines[i + 3] === "LAYER"
    ) {
      i += 4;
      break;
    }
  }
  if (i >= lines.length) return layers;

  let current = null;
  while (i < lines.length - 1) {
    const code = lines[i].trim();
    const val = lines[i + 1];

    if (code === "0") {
      if (current) layers.push(current);
      if (val === "ENDTAB") break;
      if (val === "LAYER") {
        current = { name: "", aci: 7, linetype: "Continuous", flags: 0, lineweight: -3 };
      } else {
        current = null;
      }
    } else if (current) {
      switch (code) {
        case "2":   current.name = val; break;
        case "6":   current.linetype = val; break;
        case "62":  current.aci = parseInt(val, 10); break;
        case "70":  current.flags = parseInt(val, 10) || 0; break;
        case "370": current.lineweight = parseInt(val, 10) || -3; break;
      }
    }
    i += 2;
  }

  return layers
    .filter((l) => l.name && l.name !== "0" && !l.name.startsWith("*"))
    .map((l) => ({
      name: l.name,
      aci: Math.abs(l.aci),
      off: l.aci < 0,
      frozen: (l.flags & 1) !== 0,
      locked: (l.flags & 4) !== 0,
      linetype: l.linetype,
      lineweight: l.lineweight,
      entityCount: entityCounts[l.name] || 0,
    }));
}

// First letter is the discipline per AIA/NCS layer-naming convention. We use
// it for grouping the layer list in the UI. "Misc" catches anything that
// doesn't follow the convention.
export function disciplineOf(name) {
  const m = name.match(/^([A-Z])-/);
  if (!m) return "Misc";
  const code = m[1];
  return ({
    V: "V — Vector / existing",
    C: "C — Civil",
    L: "L — Landscape",
    A: "A — Architectural",
    M: "M — Mechanical",
    P: "P — Plumbing",
    S: "S — Structural",
    E: "E — Electrical",
    X: "X — Xref / placeholder",
    G: "G — General",
    Q: "Q — Equipment",
    F: "F — Fire protection",
    T: "T — Telecom",
    R: "R — Resource",
  }[code] || `${code} — Other`);
}

// Map a layer name to one of our COLORS category ids using name patterns.
// More specific patterns win — order matters.
export function categoryForLayer(name) {
  const n = name.toUpperCase();
  if (/\b(ROAD|PAVE|CURB|SIDEWALK|SDWK|DRIVE|PARK|PARKING|TRAFF)\b/.test(n)) return "roads";
  if (/\b(UTIL|POWR|POWER|ELEC|COMM|TELE|TELCO|GAS|FUEL|WATR|WATER|SSWR|SEWER|STRM|STORM|HYDR|FIRE)\b/.test(n)) return "utility";
  if (/\b(TOPO|DTM|BRKL|BREAKLINE|SPOT|CONT|CONTOUR|RIDGE|MASS|SURF|SURFACE)\b/.test(n)) return "dtm";
  return "layer";
}

// Compress a layer name into a short label. Strips the leading discipline
// letter, replaces dashes with spaces, title-cases, truncates to 14 chars.
export function labelFromName(name, maxLen = 14) {
  const stripped = name.replace(/^[A-Z]-/, "");
  const parts = stripped.split("-").map((p) => p.replace(/_+/g, " "));
  // Drop a leading category prefix that duplicates the assigned category
  // (e.g. "UTIL-POWR-POLE" -> "Powr Pole" since the button is already in the
  // "utility" color). Only drop if there are enough parts left to be useful.
  if (parts.length >= 2 && /^(ROAD|UTIL|TOPO|DTM)$/i.test(parts[0])) parts.shift();
  let label = parts
    .join(" ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  if (label.length > maxLen) label = label.slice(0, maxLen).trim();
  return label || name.slice(0, maxLen);
}

// Enumerate block definitions from a DXF. Returns one entry per real block
// with:
//   - name: the block name (group code 2 in BLOCK records)
//   - entityCount: how many entities the definition contains
//   - dominantLayer: the layer most INSERT entities of this block use in
//     the drawing (or null if the block was never inserted)
//   - totalInserts: how many INSERTs of this block exist in the model
//
// Anonymous blocks (names starting with `*`, e.g. `*Model_Space`) are filtered.
export function parseDxfBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = walkBlocksSection(lines);
  const usage = findInsertUsage(lines);
  for (const b of blocks) {
    const u = usage[b.name];
    if (u) {
      b.dominantLayer = u.layer;
      b.totalInserts = u.total;
    } else {
      b.dominantLayer = null;
      b.totalInserts = 0;
    }
  }
  return blocks;
}

function walkBlocksSection(lines) {
  const blocks = [];
  let i = 0;
  for (; i < lines.length - 3; i++) {
    if (lines[i].trim() === "0" && lines[i + 1] === "SECTION" &&
        lines[i + 2].trim() === "2" && lines[i + 3] === "BLOCKS") {
      i += 4;
      break;
    }
  }
  if (i >= lines.length) return blocks;
  let current = null;
  let entity = null;
  const finishEntity = () => { if (entity && current) current.entities.push(entity); entity = null; };
  while (i < lines.length - 1) {
    const code = lines[i].trim();
    const val = lines[i + 1];
    if (code === "0") {
      if (val === "ENDSEC") { finishEntity(); break; }
      if (val === "BLOCK") {
        finishEntity();
        current = { name: "", entities: [] };
      } else if (val === "ENDBLK") {
        finishEntity();
        if (current) blocks.push(current);
        current = null;
      } else if (current) {
        finishEntity();
        entity = startEntity(val);
      }
    } else if (entity) {
      addEntityProp(entity, code, val);
    } else if (current && code === "2" && !current.name) {
      current.name = val;
    }
    i += 2;
  }
  return blocks
    .filter((b) => b.name && !b.name.startsWith("*"))
    .map((b) => ({ name: b.name, entities: b.entities, entityCount: b.entities.length }));
}

// Entity types we know how to render in the preview canvas. Other types are
// parsed loosely (or ignored) so they don't disrupt the walker.
function startEntity(type) {
  if (type === "LINE")        return { type: "LINE", x1: 0, y1: 0, x2: 0, y2: 0 };
  if (type === "CIRCLE")      return { type: "CIRCLE", cx: 0, cy: 0, r: 0 };
  if (type === "ARC")         return { type: "ARC", cx: 0, cy: 0, r: 0, startAngle: 0, endAngle: 0 };
  if (type === "LWPOLYLINE")  return { type: "LWPOLYLINE", vertices: [], closed: false };
  if (type === "POLYLINE")    return { type: "POLYLINE", vertices: [], closed: false };
  // Unknown type — still emit a placeholder so it gets counted but not drawn.
  return { type: type, ignored: true };
}

function addEntityProp(entity, code, val) {
  if (entity.ignored) return;
  const n = parseFloat(val);
  switch (entity.type) {
    case "LINE":
      if (code === "10") entity.x1 = n;
      else if (code === "20") entity.y1 = n;
      else if (code === "11") entity.x2 = n;
      else if (code === "21") entity.y2 = n;
      break;
    case "CIRCLE":
      if (code === "10") entity.cx = n;
      else if (code === "20") entity.cy = n;
      else if (code === "40") entity.r = n;
      break;
    case "ARC":
      if (code === "10") entity.cx = n;
      else if (code === "20") entity.cy = n;
      else if (code === "40") entity.r = n;
      else if (code === "50") entity.startAngle = n;
      else if (code === "51") entity.endAngle = n;
      break;
    case "LWPOLYLINE":
      if (code === "10") entity.vertices.push({ x: n, y: 0 });
      else if (code === "20" && entity.vertices.length) entity.vertices[entity.vertices.length - 1].y = n;
      else if (code === "70") entity.closed = (parseInt(val, 10) & 1) === 1;
      break;
    case "POLYLINE":
      if (code === "70") entity.closed = (parseInt(val, 10) & 1) === 1;
      break;
  }
}

function findInsertUsage(lines) {
  let i = 0;
  for (; i < lines.length - 3; i++) {
    if (lines[i].trim() === "0" && lines[i + 1] === "SECTION" &&
        lines[i + 2].trim() === "2" && lines[i + 3] === "ENTITIES") {
      i += 4;
      break;
    }
  }
  if (i >= lines.length) return {};
  const byBlock = {}; // name -> { byLayer: {layer: count}, total }
  let inInsert = false;
  let curName = null;
  let curLayer = null;
  const commit = () => {
    if (!inInsert || !curName) return;
    const lname = curLayer || "0";
    if (!byBlock[curName]) byBlock[curName] = { byLayer: {}, total: 0 };
    byBlock[curName].byLayer[lname] = (byBlock[curName].byLayer[lname] || 0) + 1;
    byBlock[curName].total++;
  };
  while (i < lines.length - 1) {
    const code = lines[i].trim();
    const val = lines[i + 1];
    if (code === "0") {
      if (val === "ENDSEC") { commit(); break; }
      commit();
      inInsert = val === "INSERT";
      curName = null;
      curLayer = null;
    } else if (inInsert) {
      if (code === "2") curName = val;
      else if (code === "8") curLayer = val;
    }
    i += 2;
  }
  const dominant = {};
  for (const [name, agg] of Object.entries(byBlock)) {
    let best = null, bestN = 0;
    for (const [layer, n] of Object.entries(agg.byLayer)) {
      if (n > bestN) { bestN = n; best = layer; }
    }
    dominant[name] = { layer: best, total: agg.total };
  }
  return dominant;
}

// Build a button that switches to the block's dominant layer (or override)
// and runs -INSERT for the block. Macro stops at the insertion point prompt
// so the operator clicks in the drawing to place the symbol.
//
// Options:
//   layer       — layer to switch to before insert (default: block.dominantLayer or "0")
//   scale       — uniform XYZ scale baked in via AutoCAD's -INSERT "S" option
//   rotation    — rotation in degrees baked in via the "R" option
export function buttonFromBlock(block, opts = {}) {
  const layer = opts.layer || opts.layerOverride || block.dominantLayer || "0";
  const scale = parseFloat(opts.scale);
  const rotation = parseFloat(opts.rotation);
  const label = compressBlockName(block.name);

  // Insert chain — the trailing `;` leaves AutoCAD at the insertion-point
  // prompt for the operator's click.
  let insert = `-INSERT{RET}${block.name}{RET}`;
  if (scale && scale !== 1) insert += `S{RET}${scale}{RET}`;
  if (rotation) insert += `R{RET}${rotation}{RET}`;

  const cmds = layer === "0"
    ? insert
    : `-LAYER{RET}SET{RET}${layer}{RET}{RET}${insert}`;

  const notes = [
    `Insert block ${block.name}`,
    scale && scale !== 1 ? `scale ${scale}` : null,
    rotation ? `rotation ${rotation}°` : null,
    block.totalInserts ? `used ${block.totalInserts}× on ${block.dominantLayer}` : null,
  ].filter(Boolean).join(" · ");

  return { label, color: categoryForLayer(layer), commands: cmds, notes };
}

function compressBlockName(name, maxLen = 14) {
  // Strip common namespace prefixes (e.g. "ESP - " on this template's blocks)
  // and the leading domain word "Proposed"/"Existing" if it pushes the
  // distinctive part out of the visible label.
  let s = name
    .replace(/^[A-Z]{2,5}\s*[-_]\s*/, "")
    .replace(/^(Proposed|Existing|New)\s*[-_]?\s*/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  // If still too long, prefer the last word(s) (e.g. "Gate Valve" out of
  // "Water Proposed Gate Valve") since those carry the meaning.
  if (s.length > maxLen) {
    const words = s.split(" ").filter(Boolean);
    let trimmed = "";
    for (let i = words.length - 1; i >= 0; i--) {
      const cand = words.slice(i).join(" ");
      if (cand.length > maxLen) break;
      trimmed = cand;
    }
    s = trimmed || s.slice(0, maxLen);
  }
  return (s || name).trim().slice(0, maxLen).trim();
}

// Pick the drawing tool to start after switching to the layer. Defaults
// match DAT/EM-compiler convention: buildings/right-angle features use
// Capture's PSQR2D (place-square auto-corners), linear features use
// AUTOARC3D, breaklines use Civil 3D feature lines, spots become COGO points.
// _3DPOLY is intentionally avoided.
export function drawingToolForLayer(name) {
  const n = name.toUpperCase();
  // Breaklines → Civil 3D feature line (becomes a surface breakline)
  if (/\b(BRKL|BREAKLINE)\b/.test(n)) return "_AECCDRAWFEATURELINES";
  // Spot elevations → COGO point
  if (/\b(SPOT|SPOTS|SPOT-ELEV)\b/.test(n)) return "_AECCCREATEPTMANUAL";
  // Annotation / text layers — no drawing tool default
  if (/\b(ANNO|TEXT|LABEL|DIM|HATCH|PATT)\b/.test(n)) return null;
  // Point-like features (poles, manholes, valves, hydrants, signs, individual trees)
  if (/\b(POLE|MH|MNHL|VLV|VALV|HYDR|HYDRANT|SIGN|TREE|MARK|MARKER)\b/.test(n)) return "_POINT";
  // Right-angle features → PSQR2D (DAT/EM place-square; auto-orthogonal corners)
  if (/\b(BLDG|BUILD|BUILDING|STRUC|STRUCT|STRC|FOUND|DECK|PORCH|PATIO|SHED|GARAGE)\b/.test(n)) return "PSQR2D";
  // Everything else linear → AUTOARC3D (DAT/EM Capture's 3D auto-arc)
  return "AUTOARC3D";
}

// Build a button object for a single layer. If `linkedBlock` is provided, the
// macro switches the layer AND runs -INSERT for that block (one-press
// collection workflow). Otherwise if `includeDrawingTool` is true, it chains
// the inferred drawing tool (3D polyline, feature line, etc.).
export function buttonFromLayer(layer, { includeDrawingTool = true, linkedBlock = null } = {}) {
  let tool = null;
  if (linkedBlock) tool = `-INSERT{RET}${linkedBlock.name}{RET}`;
  else if (includeDrawingTool) tool = drawingToolForLayer(layer.name);
  const commands = tool
    ? `-LAYER{RET}SET{RET}${layer.name}{RET}{RET}${tool}`
    : `-LAYER{RET}SET{RET}${layer.name}{RET}{RET}`;
  // When a block is linked, prefer the block's friendlier short name as the
  // label — it reads more like the action ("Utility Pole") than the layer
  // identifier ("V-UTIL-POWR-POLE").
  const label = linkedBlock ? compressBlockName(linkedBlock.name) : labelFromName(layer.name);
  return {
    label,
    color: categoryForLayer(layer.name),
    commands,
    notes: linkedBlock
      ? `Switches to ${layer.name} and inserts block "${linkedBlock.name}"`
      : `Layer from CAD template${layer.off ? " (was OFF in template)" : ""}`,
  };
}

// Pair each layer to its "most natural" block — the block whose dominant
// insertion target is that layer. A layer can have at most one linked block;
// a block is paired to at most one layer. Returns a Map<layerName, block>.
export function computeLayerBlockBindings(layers, blocks) {
  const map = new Map();
  const layersByName = new Set(layers.map((l) => l.name));
  for (const b of blocks) {
    if (!b.dominantLayer || b.totalInserts === 0) continue;
    if (!layersByName.has(b.dominantLayer)) continue;
    const existing = map.get(b.dominantLayer);
    if (!existing || b.totalInserts > existing.totalInserts) {
      map.set(b.dominantLayer, b);
    }
  }
  return map;
}

// Pretty label for a category id, used as section header text.
export const CATEGORY_LABELS = {
  roads:   "ROADS",
  utility: "UTILITIES",
  dtm:     "DTM",
  layer:   "LAYERS",
  mixed:   "MIXED",
  neutral: "OTHER",
  summit:  "SUMMIT",
  cad:     "CAD",
  capture: "CAPTURE",
  osnap:   "OSNAP",
};

// Group order — display roads first, generic "layer" bucket last.
export const CATEGORY_ORDER = ["roads", "utility", "dtm", "layer"];

// Workflow-order priorities used to sort layers within each category before
// they get packed into the grid. Lower number = earlier in the row. Matches
// the typical mental order an operator uses during stereo compilation:
// centerline before edge, primary utility before incidentals, breaklines
// before spots. Unknown patterns fall to the end alphabetically (priority
// 999) so the ordering is stable for layers we don't recognize.
const WORKFLOW_PRIORITY = [
  // Roads — collect from centerline outward
  [/\b(ROAD_?CL|RDCL|CENTERLINE|CL)\b/, 10],
  [/\b(ROAD_?EOP|EOP|EDGE)\b/,           20],
  [/\b(CURB|GUTTER)\b/,                   30],
  [/\b(DRIVE|DRIVEWAY|DRWY)\b/,           40],
  [/\b(SIDEWALK|SDWK|WALK)\b/,            50],
  [/\b(PAVE|PAVEMENT)\b/,                 60],
  [/\b(PARK|PARKING|LOT)\b/,              70],
  [/\b(TRAFF|MEDIAN|ISLAND)\b/,           80],
  [/\b(FENCE|WALL|GUARD)\b/,              90],
  // Utility — power/comm above ground, then wet utilities
  [/\b(POWR|POWER|ELEC)\b/,              110],
  [/\b(POLE|GUY)\b/,                     120],
  [/\b(COMM|TELE|TELCO|FIBER)\b/,        130],
  [/\b(WATR|WATER|HYDR|HYDRANT)\b/,      140],
  [/\b(SSWR|SEWER|SANI)\b/,              150],
  [/\b(STRM|STORM)\b/,                   160],
  [/\b(GAS|FUEL)\b/,                     170],
  [/\b(MH|MNHL|MANHOLE|VLV|VALVE)\b/,    180],
  // DTM — surface inputs in collection order
  [/\b(BRKL|BREAKLINE|RIDGE|DRAIN)\b/,   210],
  [/\b(SPOT|SPOTS)\b/,                   220],
  [/\b(CONT|CONTOUR)\b/,                 230],
  [/\b(MASS|MASSP)\b/,                   240],
  [/\b(OBSCURE|OBSC)\b/,                 250],
  [/\b(SURF|SURFACE|DTM|TOPO)\b/,        260],
];

function workflowOrderKey(name) {
  const n = (name || "").toUpperCase();
  for (const [re, p] of WORKFLOW_PRIORITY) if (re.test(n)) return p;
  return 999;
}

function sortLayersByWorkflow(layers) {
  return [...layers].sort((a, b) => {
    const pa = workflowOrderKey(a.name);
    const pb = workflowOrderKey(b.name);
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}

export function groupLayersByCategory(layers) {
  const groups = {};
  for (const l of layers) {
    const c = categoryForLayer(l.name);
    (groups[c] = groups[c] || []).push(l);
  }
  // Sort group keys: known order first, then anything else alphabetically.
  const known = CATEGORY_ORDER.filter((c) => groups[c]);
  const rest = Object.keys(groups).filter((c) => !CATEGORY_ORDER.includes(c)).sort();
  return [...known, ...rest].map((c) => ({
    category: c,
    layers: sortLayersByWorkflow(groups[c]),
  }));
}

// Default control buttons prepended to DWG/DXF imports — Summit stereo
// controls, drawing tools, Capture call-commands, and OSNAP toggles. Two rows
// at the top, no project-specific layer references. Operators can edit/move
// these like any other button. Buttons whose column exceeds the user's grid
// width are skipped silently (no overflow). Rows used: 0 and 1.
export const DEFAULT_CONTROL_BUTTONS = [
  // Row 0 — Summit stereo controls + view nav
  { row: 0, col: 0,  label: "Driver",     color: "summit",  commands: "Driver",             notes: "Accept point at cursor (Summit's most-used keyword)" },
  { row: 0, col: 1,  label: "Raise Z",    color: "summit",  commands: "RaiseZ",             notes: "Move stereo cursor up in elevation" },
  { row: 0, col: 2,  label: "Lower Z",    color: "summit",  commands: "LowerZ",             notes: "Move stereo cursor down in elevation" },
  { row: 0, col: 3,  label: "Z Lock",     color: "summit",  commands: "ZLock",              notes: "Lock cursor at constant Z (roofs, water surfaces)" },
  { row: 0, col: 4,  label: "Z Unlock",   color: "summit",  commands: "ZUnlock",            notes: "Release Z lock" },
  { row: 0, col: 5,  label: "Auto Level", color: "summit",  commands: "AutoLevel",          notes: "Auto-level cursor on ground" },
  { row: 0, col: 6,  label: "Zoom In",    color: "summit",  commands: "ZoomIn",             notes: "Image zoom in" },
  { row: 0, col: 7,  label: "Zoom Out",   color: "summit",  commands: "ZoomOut",            notes: "Image zoom out" },
  { row: 0, col: 8,  label: "Next Pair",  color: "summit",  commands: "NextStereoPair",     notes: "Move to next stereo pair" },
  { row: 0, col: 9,  label: "Prev Pair",  color: "summit",  commands: "PreviousStereoPair", notes: "Move to previous stereo pair" },
  { row: 0, col: 10, label: "Model Ext",  color: "summit",  commands: "ModelExtents",       notes: "Zoom to current model extents" },
  { row: 0, col: 11, label: "Recenter",   color: "summit",  commands: "Recenter",           notes: "Recenter cursor in view" },
  // Row 1 — Drawing tools, Capture call-commands, OSNAP toggles
  { row: 1, col: 1,  label: "Auto Arc",   color: "capture", commands: "AUTOARC3D",                  notes: "DAT/EM Capture 3D auto-arc — default linear collection" },
  { row: 1, col: 2,  label: "Feat Line",  color: "cad",     commands: "_AECCDRAWFEATURELINES",      notes: "Civil 3D feature line (use for breaklines)" },
  { row: 1, col: 3,  label: "COGO Point", color: "cad",     commands: "_AECCCREATEPTMANUAL",        notes: "Civil 3D COGO point (good for spot elevations)" },
  { row: 1, col: 4,  label: "End Feat",   color: "capture", commands: "CallCmd EndFeature",         notes: "End the current feature being collected" },
  { row: 1, col: 5,  label: "Undo Vtx",   color: "capture", commands: "CallCmd UndoLastVertex",     notes: "Back up one vertex on active feature" },
  { row: 1, col: 6,  label: "PSQR 2D",    color: "capture", commands: "PSQR2D",                     notes: "DAT/EM place-square — auto-orthogonal corners for buildings" },
  { row: 1, col: 7,  label: "Endpoint",   color: "osnap",   commands: "'_-osnap{RET}end",           notes: "Transparent OSNAP to endpoint" },
  { row: 1, col: 8,  label: "Intersect",  color: "osnap",   commands: "'_-osnap{RET}int",           notes: "Transparent OSNAP to intersection" },
  { row: 1, col: 9,  label: "Midpoint",   color: "osnap",   commands: "'_-osnap{RET}mid",           notes: "Transparent OSNAP to midpoint" },
  { row: 1, col: 10, label: "Nearest",    color: "osnap",   commands: "'_-osnap{RET}nea",           notes: "Transparent OSNAP to nearest" },
  { row: 1, col: 11, label: "Snap None",  color: "osnap",   commands: "'_-osnap{RET}none",          notes: "Turn off OSNAP" },
];

// One row past the last default-control row; layer placement should start
// here when the controls block is enabled.
export const DEFAULT_CONTROLS_NEXT_ROW = 2;
