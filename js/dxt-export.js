// js/dxt-export.js
// Build a minimal AutoCAD DXF containing a LAYER table.
//
// AutoCAD opens the resulting `.dxf` like any drawing; the user then
// "Save As" → choose .dwt to land a clean drawing template that already
// has every layer the keypad / PDF references. We can't write .dwt
// (binary) directly from the browser without a heavy library, but DXF is
// text-based and well documented — AutoCAD reads it identically.
//
// DXF group-code reference for LAYER entries:
//   0=entity type, 2=name, 70=flags, 62=color (ACI), 6=linetype name,
//   370=lineweight (1/100mm, -3 = ByLayer default), 290=plotting flag.

// Walk a project's buttons, pull every layer name referenced in
// `-LAYER{RET}SET{RET}<name>{RET}{RET}` macros. Quoted names are
// unquoted; names with leading/trailing whitespace are trimmed.
export function extractLayerNamesFromProject(project) {
  const set = new Set();
  const re = /-LAYER\{RET\}SET\{RET\}([^{]+?)\{RET\}\{RET\}/gi;
  for (const btn of Object.values(project.buttons || {})) {
    const cmd = btn.commands || "";
    let m;
    while ((m = re.exec(cmd)) !== null) {
      const name = m[1].trim().replace(/^"|"$/g, "").trim();
      if (name) set.add(name);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// AutoCAD layer names can't contain < > / \ " : ? * | , = `. Strip / replace
// them; collapse runs of whitespace into a single underscore.
export function sanitizeLayerName(name) {
  return (name || "")
    .replace(/[<>/\\":?*|,=`]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 255);
}

function dxfPair(code, value) {
  return `${code}\n${value}`;
}

function buildHeader() {
  return [
    dxfPair(0, "SECTION"),
    dxfPair(2, "HEADER"),
    dxfPair(9, "$ACADVER"),
    dxfPair(1, "AC1027"), // AutoCAD 2013+ — Civil 3D 2018 and 2022 both read it
    dxfPair(9, "$INSUNITS"),
    dxfPair(70, 0),
    dxfPair(0, "ENDSEC"),
  ].join("\n");
}

function buildTables(layers) {
  const lines = [
    dxfPair(0, "SECTION"),
    dxfPair(2, "TABLES"),
    // LTYPE table — only CONTINUOUS, the safe default. Layers reference
    // it by name (group code 6). AutoCAD recreates standard linetypes
    // (HIDDEN, DASHED, etc.) on open if a layer requests one we didn't
    // define; the missing-linetype warning is harmless.
    dxfPair(0, "TABLE"),
    dxfPair(2, "LTYPE"),
    dxfPair(70, 1),
    dxfPair(0, "LTYPE"),
    dxfPair(2, "CONTINUOUS"),
    dxfPair(70, 0),
    dxfPair(3, "Solid line"),
    dxfPair(72, 65),
    dxfPair(73, 0),
    dxfPair(40, 0.0),
    dxfPair(0, "ENDTAB"),
    // LAYER table
    dxfPair(0, "TABLE"),
    dxfPair(2, "LAYER"),
    dxfPair(70, layers.length + 1),
    // "0" layer must exist in every DXF — AutoCAD treats it as the
    // default reserved layer.
    dxfPair(0, "LAYER"),
    dxfPair(2, "0"),
    dxfPair(70, 0),
    dxfPair(62, 7),
    dxfPair(6, "CONTINUOUS"),
    dxfPair(370, -3),
  ];
  for (const layer of layers) {
    lines.push(
      dxfPair(0, "LAYER"),
      dxfPair(2, sanitizeLayerName(layer.name)),
      dxfPair(70, 0),
      dxfPair(62, layer.color ?? 7),
      dxfPair(6, layer.linetype || "CONTINUOUS"),
      dxfPair(370, layer.lineweight != null ? layer.lineweight : -3),
    );
  }
  lines.push(dxfPair(0, "ENDTAB"));
  lines.push(dxfPair(0, "ENDSEC"));
  return lines.join("\n");
}

function buildEmptyEntities() {
  // No entities — drawing is empty except for layer definitions.
  return [
    dxfPair(0, "SECTION"),
    dxfPair(2, "ENTITIES"),
    dxfPair(0, "ENDSEC"),
  ].join("\n");
}

// Layer object shape:
//   { name, color?, linetype?, lineweight?, description? }
// color = AutoCAD Color Index (1-255), default 7 (white/black ByLayer)
// linetype = name from LTYPE table; we only emit CONTINUOUS so anything
//            else triggers a benign "missing linetype" notice in AutoCAD
// lineweight = 1/100mm units (e.g. 25 = 0.25mm), -3 = ByLayer default
export function buildLayerDxf(layers) {
  const parts = [buildHeader(), buildTables(layers), buildEmptyEntities(), dxfPair(0, "EOF")];
  return parts.join("\n") + "\n";
}
