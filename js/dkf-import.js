// js/dkf-import.js
// Lossy v1 importer for DAT/EM Keypad (.dkf) files.
//
// Reads a .dkf and produces a project object compatible with the app schema.
// Features the v1 schema doesn't model are dropped and summarized in the
// returned `dropped` report:
//   - multiple layers (keeps active or first only)
//   - multi-cell button spans (keeps the master cell as 1x1)
//   - HEADER flag, JUMP LAYER, BITMAP NAME, font styling
//   - stacked LABELs are joined with " / "
//   - background color snapped to the nearest category in COLORS palette
//
// See TASKS.md "P0 -> Tasks" for round-trip + schema-extension follow-ups.

import { COLORS, newId, normalizeMacro } from "./state.js";

const DKF_COLS = 14;

// The editor convention stores macros in DAT/EM's native form (literal {RET}
// tokens). On import we keep {RET} as-is and just normalize any cancel
// prefixes ({ESC}{ESC}, ^C^C) that may have come from third-party .dkf files
// — DAT/EM's keystroke injection doesn't honor them either way.
function dkfToMacro(data) {
  return normalizeMacro(data);
}

function parseRgb(s) {
  const [r, g, b] = s.split(";").map((n) => parseInt(n.trim(), 10));
  return [r, g, b];
}

function hexToRgbArr(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nearestColorId([r, g, b]) {
  let best = COLORS[COLORS.length - 1];
  let bestDist = Infinity;
  for (const c of COLORS) {
    const [cr, cg, cb] = hexToRgbArr(c.hex);
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best.id;
}

export function parseDkf(text) {
  const lines = text.replace(/\r/g, "").split("\n");

  let projectName = "Imported keypad";
  let activeLayer = null;
  for (const line of lines) {
    if (line.startsWith("Filename:")) {
      const fn = line.slice("Filename:".length).trim();
      const base = fn.split(/[\\/]/).pop() || fn;
      projectName = base.replace(/\.dkf$/i, "") || projectName;
    } else if (line.startsWith("ACTIVE_LAYER:")) {
      activeLayer = line.slice("ACTIVE_LAYER:".length).trim();
    }
    if (line.startsWith("LAYER:")) break;
  }

  const layers = [];
  let currentLayer = null;
  let currentButton = null;
  let currentLabel = null;

  const flushButton = () => {
    if (currentButton && currentLayer) {
      currentLayer.buttons.set(currentButton.n, currentButton);
    }
    currentButton = null;
    currentLabel = null;
  };
  const flushLayer = () => {
    flushButton();
    if (currentLayer) layers.push(currentLayer);
    currentLayer = null;
  };

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith("LAYER:")) {
      flushLayer();
      currentLayer = { name: line.slice("LAYER:".length).trim(), buttons: new Map() };
      continue;
    }

    const btnMatch = line.match(/^BUTTON:(\d+)/);
    if (btnMatch) {
      flushButton();
      currentButton = {
        n: parseInt(btnMatch[1], 10),
        shape: [1, 1],
        startButton: null,
        bgColor: null,
        data: null,
        labels: [],
        header: false,
        jumpLayer: null,
      };
      continue;
    }

    if (!currentButton) continue;

    const trimmed = line.replace(/^\t+/, "");
    const depth = line.length - trimmed.length;

    if (depth === 1) {
      currentLabel = null;
      if (trimmed.startsWith("BUTTON SHAPE:")) {
        const [w, h] = trimmed.slice("BUTTON SHAPE:".length).trim().split(/\s+/);
        currentButton.shape = [parseInt(w, 10) || 1, parseInt(h, 10) || 1];
      } else if (trimmed.startsWith("START BUTTON:")) {
        currentButton.startButton = parseInt(trimmed.slice("START BUTTON:".length).trim(), 10);
      } else if (trimmed.startsWith("BACKGROUND COLOR:")) {
        currentButton.bgColor = parseRgb(trimmed.slice("BACKGROUND COLOR:".length).trim());
      } else if (trimmed.startsWith("DATA:")) {
        currentButton.data = trimmed.slice("DATA:".length).trim();
      } else if (trimmed.startsWith("HEADER:")) {
        currentButton.header = trimmed.slice("HEADER:".length).trim().toUpperCase() === "TRUE";
      } else if (trimmed.startsWith("JUMP LAYER:")) {
        currentButton.jumpLayer = trimmed.slice("JUMP LAYER:".length).trim();
      } else if (trimmed === "LABEL:" || trimmed.startsWith("LABEL:")) {
        currentLabel = { text: "", isText: true, bitmap: null };
        currentButton.labels.push(currentLabel);
      }
    } else if (depth >= 2 && currentLabel) {
      if (trimmed.startsWith("LABEL TEXT:")) {
        currentLabel.text = trimmed.slice("LABEL TEXT:".length).replace(/^\s/, "");
      } else if (trimmed.startsWith("BITMAP NAME:")) {
        currentLabel.bitmap = trimmed.slice("BITMAP NAME:".length).trim();
      } else if (trimmed.startsWith("IS TEXT:")) {
        currentLabel.isText = trimmed.slice("IS TEXT:".length).trim().toUpperCase() === "TRUE";
      }
      // WEIGHT, HEIGHT, FONTNAME, FOREGROUND COLOR, PITCH & FAMILY: ignored in v1
    }
  }
  flushLayer();

  if (!layers.length) {
    throw new Error("No LAYER blocks found — doesn't look like a .dkf file");
  }

  const layer = layers.find((l) => l.name === activeLayer) || layers[0];

  const dropped = {
    extraLayers: layers.length - 1,
    jumpLayers: 0,
    stackedLabels: 0,
  };

  const buttons = {};
  for (const [n, b] of layer.buttons) {
    if (b.startButton != null) continue; // slave cell of a multi-cell button — owner emits the content

    if (b.jumpLayer) dropped.jumpLayers++;

    const row = Math.floor((n - 1) / DKF_COLS);
    const col = (n - 1) % DKF_COLS;

    const textLabels = b.labels.filter((l) => l.isText !== false && l.text);
    const bitmap = b.labels.find((l) => l.bitmap || l.isText === false)?.bitmap;
    if (textLabels.length > 1) dropped.stackedLabels++;

    const hasContent = b.data || textLabels.length || bitmap || b.header;
    if (!hasContent) continue;

    const label = textLabels.length
      ? textLabels.map((l) => l.text).join(" / ")
      : ""; // bitmap-only buttons have no text label

    const [w, h] = b.shape;
    buttons[`${row},${col}`] = {
      label: (label || "").slice(0, 30),
      color: b.bgColor ? nearestColorId(b.bgColor) : "neutral",
      commands: b.data ? dkfToMacro(b.data) : "",
      notes: "",
      ...(w > 1 ? { width: w } : {}),
      ...(h > 1 ? { height: h } : {}),
      ...(b.header ? { header: true } : {}),
      ...(bitmap ? { bitmap } : {}),
    };
  }

  let maxRow = 0;
  let maxCol = 0;
  for (const [key, btn] of Object.entries(buttons)) {
    const [r, c] = key.split(",").map(Number);
    const w = btn.width || 1;
    const h = btn.height || 1;
    if (r + h - 1 > maxRow) maxRow = r + h - 1;
    if (c + w - 1 > maxCol) maxCol = c + w - 1;
  }
  const rows = Math.min(20, Math.max(1, maxRow + 1));
  const cols = Math.min(20, Math.max(1, maxCol + 1));

  return {
    project: {
      id: newId(),
      name: projectName,
      rows,
      cols,
      context: "",
      buttons,
    },
    dropped,
  };
}

export function summarizeDropped(dropped) {
  const parts = [];
  const plural = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`;
  if (dropped.extraLayers) parts.push(`${plural(dropped.extraLayers, "extra layer")} skipped`);
  if (dropped.jumpLayers) parts.push(`${plural(dropped.jumpLayers, "JUMP LAYER")} dropped`);
  if (dropped.stackedLabels) parts.push(`${plural(dropped.stackedLabels, "stacked label")} joined`);
  return parts.length ? parts.join(", ") : "no features dropped";
}

// Walk a parsed .dkf project (the inner `project` returned by parseDkf) and
// produce a Project-Context text block that the AI generator can consume.
// Extracts:
//   - Layer codes used in -LAYER{RET}SET{RET}<NAME>{RET}{RET} switches, with
//     the button label as a best-effort description
//   - Block symbols used in -INSERT{RET}<NAME>{RET} calls, same treatment
//   - DAT/EM and Civil 3D drawing tools observed (AUTOARC3D, PSQR2D,
//     AECCDRAWFEATURELINES, AECCCREATEPTMANUAL)
//   - Summit / Capture / OSNAP operator controls present
// Output is plain text with section headers, padded columns, and explicit
// <FILL IN description> markers where the source button had no label.
export function deriveContextFromDkf(project, filename) {
  const layers = new Map();
  const blocks = new Map();
  const tools = new Set();
  const controls = new Set();

  const TOOL_PATTERNS = [
    [/AECCDRAWFEATURELINES/i, "Civil 3D feature line (_AECCDRAWFEATURELINES) — DTM breaklines"],
    [/AECCCREATEPTMANUAL/i,   "Civil 3D COGO point (_AECCCREATEPTMANUAL) — spot elevations"],
    [/PSQR2D/i,               "DAT/EM PSQR2D — 90° corner squaring for buildings"],
    [/AUTOARC3D/i,            "DAT/EM AUTOARC3D — auto-arc 3D polyline for curves"],
  ];

  const CONTROL_PATTERNS = [
    /Driver/i, /RaiseZ/i, /LowerZ/i, /ZLock/i, /ZUnlock/i, /AutoLevel/i,
    /ZoomIn/i, /ZoomOut/i, /NextStereoPair/i, /PreviousStereoPair/i,
    /ModelExtents/i, /Recenter/i,
    /CallCmd\s+EndFeature/i, /CallCmd\s+UndoLastVertex/i,
    /'_-osnap\{RET\}\w+/i,
  ];

  const note = (map, name, label) => {
    const key = name.trim();
    if (!key) return;
    const e = map.get(key) || { label: "", count: 0 };
    if (!e.label && label) e.label = label;
    e.count++;
    map.set(key, e);
  };

  for (const btn of Object.values(project.buttons || {})) {
    if (btn.header) continue;
    const cmd = btn.commands || "";
    if (!cmd) continue;

    // Editor macros are in {RET}-token form: `-LAYER{RET}SET{RET}NAME{RET}{RET}`
    // and `-INSERT{RET}NAME{RET}`. Capture the NAME between the appropriate
    // {RET} bracketing.
    const layerRe = /-LAYER\{RET\}(?:SET|S)\{RET\}([^{]+?)\{RET\}\{RET\}/gi;
    let m;
    while ((m = layerRe.exec(cmd)) !== null) note(layers, m[1], btn.label);

    const blockRe = /-INSERT\{RET\}([^{]+?)\{RET\}/gi;
    while ((m = blockRe.exec(cmd)) !== null) note(blocks, m[1], btn.label);

    for (const [re, name] of TOOL_PATTERNS) if (re.test(cmd)) tools.add(name);
    for (const re of CONTROL_PATTERNS) {
      const hit = cmd.match(re);
      if (hit) controls.add(hit[0]);
    }
  }

  const lines = [];
  lines.push("Project type: Derived from imported .dkf — review and edit before saving");
  if (filename) lines.push(`Source .dkf: ${filename}`);
  lines.push(`Layer-switch buttons: ${[...layers.values()].reduce((a, b) => a + b.count, 0)}`);
  lines.push(`Block-insert buttons: ${[...blocks.values()].reduce((a, b) => a + b.count, 0)}`);
  lines.push("");
  lines.push("Client: <FILL IN>");
  lines.push("Project name: <FILL IN>");
  lines.push("Map scale: <FILL IN>");
  lines.push("Coordinate system: <FILL IN>");
  lines.push("");

  const section = (title, map) => {
    if (!map.size) return;
    lines.push(title);
    const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const pad = Math.max(...sorted.map(([n]) => n.length)) + 2;
    for (const [name, info] of sorted) {
      lines.push(`${name.padEnd(pad)}${info.label || "<FILL IN description>"}`);
    }
    lines.push("");
  };

  section("LAYER CODES (extracted from -LAYER{RET}SET{RET}… commands)", layers);
  section("BLOCK SYMBOLS (extracted from -INSERT{RET}… commands)", blocks);

  if (tools.size) {
    lines.push("DRAWING TOOLS USED");
    for (const t of [...tools].sort()) lines.push(`- ${t}`);
    lines.push("");
  }
  if (controls.size) {
    lines.push("OPERATOR CONTROLS PRESENT");
    for (const c of [...controls].sort()) lines.push(`- ${c}`);
    lines.push("");
  }

  lines.push("NOTES");
  lines.push("- This block was auto-derived from the imported .dkf. Edit freely.");
  lines.push("- Add project-specific notes: client, scale, accuracy class, deliverables.");
  lines.push("- The AI generator uses everything here when designing new keypads.");

  return lines.join("\n") + "\n";
}
