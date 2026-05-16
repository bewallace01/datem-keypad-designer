// js/dxt-export.js
// Two emit modes for the "Gen Layers" workflow:
//
//   1. buildLayerLisp(layers) — preferred. Produces a LOADLAYERS.lsp that
//      runs `-LAYER N` per entry in any drawing. The user loads it via
//      APPLOAD (same flow as LBPLACE), then File → Save As → DWG Template
//      to lock the layer table into a .dwt. Always works — no DXF spec
//      bookkeeping required.
//
//   2. buildLayerDxf(layers) — fallback. Minimal AC1009 (R12) DXF with
//      just LAYER and LTYPE tables. R12 is the simplest format AutoCAD
//      still reads; modern releases (AC1014+) add handles, subclass
//      markers, BLOCK_RECORD, OBJECTS dictionary requirements that are
//      a pain to emit correctly. Civil 3D 2022 reads R12 fine but some
//      installs still reject minimal DXFs we hand-build, hence the LISP
//      escape hatch.

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

// Detect which status-prefix Property Filters make sense for a given
// list of layers. Returns [{name, pattern}, ...] for use by buildLayerLisp.
// We only emit a filter when at least one layer actually matches its
// pattern — no point cluttering the Layer Properties Manager with empty
// Existing/Future/Proposed groups.
export function detectLayerFilterPatterns(layers) {
  const names = layers.map((l) => (l.name || "").toUpperCase());
  const buckets = [
    { name: "Existing",  pattern: "E-*",        re: /^E[-_]/  },
    { name: "Future",    pattern: "F-*",        re: /^F[-_]/  },
    { name: "Proposed",  pattern: "P-*",        re: /^P[-_]/  },
    { name: "Roads",     pattern: "*ROAD*",     re: /ROAD|PAVE|EOP|CURB/ },
    { name: "Drainage",  pattern: "*DRAIN*",    re: /DRAIN|DITCH|RIP-?RAP|CULVERT|STORM|INLET|HYDRO/ },
    { name: "DTM",       pattern: "*DTM*",      re: /BREAK|GROUND|GRADE|SPOT|CONTOUR|DTM|RIDGE/ },
    { name: "Utilities", pattern: "*UTIL*",     re: /POLE|UTIL|POWER|TELE|GAS|FIBER|LIGHT|SIGN/ },
    { name: "Vegetation",pattern: "*TREE*",     re: /TREE|VEG|GRASS|SHRUB|WOODS/ },
    { name: "Buildings", pattern: "*BLDG*",     re: /BLDG|BUILD|STRUC|FOUND|DECK|PORCH|PATIO|SHED|GARAGE/ },
  ];
  return buckets.filter((b) => names.some((n) => b.re.test(n)));
}

// Build an AutoLISP routine that creates every layer via -LAYER N in the
// current drawing. AutoCAD/Civil 3D applies it identically on any version
// (no DXF spec quirks). Workflow:
//   1. Save the output as LOADLAYERS.lsp
//   2. In AutoCAD: APPLOAD → pick it → Load
//   3. Type LOADLAYERS at the command line → layers are created
//   4. Manually create filters in Layer Properties Manager from the
//      printed pattern list (or skip — colors alone are still useful).
//   5. File → Save As → DWG Template (*.dwt) → done
//
// `command` is a special form in AutoLISP and cannot be applied directly
// via (vl-catch-all-apply 'command …) — modern AutoCAD throws
// "bad order function: COMMAND" if you try. Wrap it inside a lambda and
// apply that lambda instead.
//
// Filter creation used to be automated here, but modern AutoCAD stores
// filters as an XML blob on the LayerTable's extension dictionary (NOT
// the ACAD_LAYERFILTERS named dictionary), and emitting that format
// from AutoLISP without an AutoCAD instance to test against is too
// fragile. LOADLAYERS now PRINTS the recommended patterns at the end of
// its run so the user can paste them into the Layer Properties Manager
// (right-click tree pane → New Property Filter → paste name + pattern).
export function buildLayerLisp(layers, { projectName = "", filterPatterns = null } = {}) {
  const stamp = new Date().toISOString().slice(0, 10);
  const patterns = filterPatterns || detectLayerFilterPatterns(layers);
  const lines = [
    `;; LOADLAYERS.lsp — auto-generated layer loader`,
    `;; Project: ${projectName || "(unnamed)"}`,
    `;; Generated: ${stamp}`,
    `;; ${layers.length} layer${layers.length === 1 ? "" : "s"}, ${patterns.length} suggested filter pattern${patterns.length === 1 ? "" : "s"}`,
    `;;`,
    `;; Usage:`,
    `;;   1. In AutoCAD/Civil 3D, run APPLOAD → load this file.`,
    `;;   2. At the command line, type LOADLAYERS → Enter.`,
    `;;   3. (Optional) Read the printed filter patterns, then create them`,
    `;;      manually: open LAYER → left tree pane → right-click → New`,
    `;;      Property Filter → paste name and pattern.`,
    `;;   4. File → Save As → DWG Template (*.dwt) to lock the layer table`,
    `;;      (and any filters you created) into a project template.`,
    ``,
    `(defun add-layer (name color / err)`,
    `  (setq err (vl-catch-all-apply`,
    `              (function (lambda () (command "-LAYER" "N" name "C" color name "")))))`,
    `  (not (vl-catch-all-error-p err)))`,
    ``,
    `(defun c:LOADLAYERS ( / made failed *error*)`,
    `  (defun *error* (msg) (princ (strcat "\\nError: " msg)) (princ))`,
    `  (setq made 0 failed 0)`,
    `  (princ "\\nCreating layers...")`,
  ];
  for (const layer of layers) {
    const name = sanitizeLayerName(layer.name);
    if (!name) continue;
    const color = Number.isInteger(layer.color) ? layer.color : 7;
    const safeName = name.replace(/"/g, '\\"');
    lines.push(
      `  (if (add-layer "${safeName}" ${color})`,
      `      (setq made (1+ made)) (setq failed (1+ failed)))`,
    );
  }
  lines.push(
    `  (princ (strcat "\\n" (itoa made) " layer(s) created"`,
    `                  (if (> failed 0) (strcat ", " (itoa failed) " failed") "")`,
    `                  ". Save As DWG Template to lock the layer table."))`,
  );
  if (patterns.length) {
    lines.push(
      ``,
      `  (princ "\\n\\nRecommended Property Filters to create manually in the Layer Properties Manager:")`,
      `  (princ "\\n  (right-click left tree pane -> New Property Filter -> enter name and Layer name pattern)")`,
    );
    for (const p of patterns) {
      const safeName = p.name.replace(/"/g, '\\"');
      const safePattern = p.pattern.replace(/"/g, '\\"');
      lines.push(`  (princ "\\n    ${safeName.padEnd(12)}  pattern: ${safePattern}")`);
    }
  }
  lines.push(
    `  (princ))`,
    ``,
    `(princ "\\nLOADLAYERS loaded. Type LOADLAYERS to run.")`,
    `(princ)`,
  );
  return lines.join("\n") + "\n";
}
