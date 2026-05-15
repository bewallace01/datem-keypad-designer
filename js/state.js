// js/state.js
// Application state: projects, current project, button data structure.

import { loadState, saveState } from "./storage.js";

export const COLORS = [
  { id: "summit",  hex: "#a78bfa", name: "Summit Keyword" },
  { id: "cad",     hex: "#5ba2f7", name: "AutoCAD / Civil 3D" },
  { id: "capture", hex: "#5fce9d", name: "Capture CallCmd" },
  { id: "osnap",   hex: "#f47272", name: "OSNAP / Snap" },
  { id: "layer",   hex: "#ec7cd1", name: "Layer / Style" },
  { id: "roads",   hex: "#fbbf24", name: "Roads / Pavement" },
  { id: "utility", hex: "#ef4444", name: "Utilities / Power" },
  { id: "dtm",     hex: "#d946ef", name: "DTM / Surface" },
  { id: "mixed",   hex: "#f0b56a", name: "Macro / Mixed" },
  { id: "neutral", hex: "#5a6273", name: "Other" },
];

export const state = {
  currentId: null,
  projects: {},
};

export function newId() {
  return "p_" + Math.random().toString(36).slice(2, 10);
}

export function curr() {
  return state.projects[state.currentId];
}

export function colorByID(id) {
  return COLORS.find((c) => c.id === id) || COLORS[COLORS.length - 1];
}

// Normalize a macro string to the {RET}-token editor convention. Idempotent.
//
// Background: earlier versions stored macros in AutoCAD CUI form (^C^C cancel,
// `;` for Enter, `;;` to exit -LAYER, newlines for chained commands). The
// .dkf exporter then translated those into DAT/EM keystroke tokens. DAT/EM's
// keystroke injection does NOT honor `^C^C` as cancel (it arrives as literal
// text "^C^C-LAYER..." and breaks the next prompt), and `;;\n` produces three
// {RET}s back-to-back — the third Enter re-invokes the previous command and
// eats the next step. The working format omits any cancel prefix, uses
// literal {RET} tokens, and writes `-LAYER{RET}SET{RET}NAME{RET}{RET}` (two
// closes, no extra). This function converts legacy macros into that shape.
export function normalizeMacro(commands) {
  if (!commands) return commands || "";
  let s = commands;
  // Strip legacy cancel sequences in either form. DAT/EM's keystroke
  // injection doesn't honor them and the working examples have no cancel.
  s = s.replace(/\^C\^C/g, "").replace(/\^C/g, "");
  s = s.replace(/\{ESC\}\{ESC\}/g, "").replace(/\{ESC\}/g, "");
  s = s.replace(/^\s+/, "");
  // `;;\n` is redundant — `;;` already exits -LAYER; the extra {RET} from
  // the newline would re-invoke the last command and break the chained step.
  s = s.replace(/;;\n/g, ";;");
  // `-LAYER;S;NAME` -> `-LAYER;SET;NAME` to match the working format. Done
  // before the `;` -> `{RET}` pass so the lookahead anchors cleanly.
  s = s.replace(/(-LAYER;)S(?=;)/gi, "$1SET");
  // Convert separators to literal {RET} tokens.
  s = s.replace(/[;\n]/g, "{RET}");
  // Upgrade the `{RET}`-form shortcut too — third-party .dkf files often
  // emit `-LAYER{RET}S{RET}NAME{RET}{RET}` directly (skipping the semicolon
  // form entirely), so the previous pass wouldn't catch them. AutoCAD
  // accepts `S` as a shortcut but DAT/EM's keystroke stream is more
  // reliable with the full word.
  s = s.replace(/(-LAYER\{RET\})S(?=\{RET\})/gi, "$1SET");
  return s;
}

// Map every cell a project's buttons cover (master + slaves) to the master's
// "row,col" key. Used by the renderer, exporter, and editor save-validation
// so they share the same view of which cells are claimed.
export function cellOwnerMap(project) {
  const owner = {};
  for (const [key, btn] of Object.entries(project.buttons)) {
    const [r, c] = key.split(",").map(Number);
    const w = btn.width || 1;
    const h = btn.height || 1;
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        owner[`${r + dr},${c + dc}`] = key;
      }
    }
  }
  return owner;
}

function migrateProjectMacros(project) {
  let changed = 0;
  for (const btn of Object.values(project.buttons || {})) {
    const before = btn.commands || "";
    const after = normalizeMacro(before);
    if (after !== before) {
      btn.commands = after;
      changed++;
    }
  }
  return changed;
}

export async function init() {
  const loaded = await loadState();
  if (loaded && loaded.projects && Object.keys(loaded.projects).length) {
    Object.assign(state, loaded);
  } else {
    seedDefault();
  }
  if (!state.currentId || !state.projects[state.currentId]) {
    state.currentId = Object.keys(state.projects)[0];
  }
  // One-shot migration: any saved macros still using AutoCAD CUI convention
  // (^C^C cancel, `;` Enter, `;;` exit-LAYER, `\n` chain) get rewritten to the
  // {RET}-token editor convention that DAT/EM actually executes.
  let migrated = 0;
  for (const p of Object.values(state.projects)) {
    migrated += migrateProjectMacros(p);
  }
  if (migrated > 0) await saveState(state);
}

export async function persist() {
  await saveState(state);
}

// ---------------------------------------------------------------------------
// Undo / redo
//
// Each entry on the undo stack is a deep snapshot of the current project's
// state taken *before* a mutation. Callers wrap mutating handlers with a
// `recordChange()` at the top so the snapshot is "the state right before this
// change". History is per-project and capped at MAX_UNDO entries.
//
// recordChange()      push current project onto undo, clear redo
// undo()              pop undo → apply, push current onto redo
// redo()              pop redo → apply, push current onto undo
// resetHistory()      clear both stacks (call on project switch / import)
// ---------------------------------------------------------------------------
const MAX_UNDO = 50;
const undoStack = [];
const redoStack = [];

function snapshotProject() {
  const p = curr();
  return p ? JSON.parse(JSON.stringify(p)) : null;
}

export function recordChange() {
  const snap = snapshotProject();
  if (!snap) return;
  undoStack.push(snap);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

export function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export async function undo() {
  if (!undoStack.length) return false;
  const cur = snapshotProject();
  const prev = undoStack.pop();
  if (cur) redoStack.push(cur);
  state.projects[prev.id] = prev;
  state.currentId = prev.id;
  await saveState(state);
  return true;
}

export async function redo() {
  if (!redoStack.length) return false;
  const cur = snapshotProject();
  const next = redoStack.pop();
  if (cur) undoStack.push(cur);
  state.projects[next.id] = next;
  state.currentId = next.id;
  await saveState(state);
  return true;
}

function seedDefault() {
  const id = newId();
  state.projects[id] = {
    id,
    name: "Stereo Compilation (sample)",
    rows: 6,
    cols: 8,
    context:
      "Aerial photogrammetry stereo compilation project. Standard planimetric and topographic feature collection. Layer naming convention:\n" +
      "- BLDG (building outlines)\n" +
      "- ROAD_EOP (edge of pavement)\n" +
      "- ROAD_CL (road centerline)\n" +
      "- CURB (curb)\n" +
      "- DRIVE (driveway)\n" +
      "- SIDEWALK (sidewalk)\n" +
      "- FENCE (fence)\n" +
      "- HYDRO_EDGE (water edge)\n" +
      "- VEG (vegetation/treeline)\n" +
      "- BREAKLINE (topographic breakline)\n" +
      "- SPOT (spot elevation as COGO point)\n" +
      "- OBSCURE (obscure area boundary)",
    buttons: {
      "0,0": { label: "Driver",     color: "summit",  commands: "Driver",  notes: "Accept point / digitize at cursor (most-used Summit keyword)" },
      "0,1": { label: "Raise Z",    color: "summit",  commands: "RaiseZ",  notes: "Move stereo cursor up in elevation" },
      "0,2": { label: "Lower Z",    color: "summit",  commands: "LowerZ",  notes: "Move stereo cursor down in elevation" },
      "0,3": { label: "Z Lock",     color: "summit",  commands: "ZLock",   notes: "Lock cursor at constant Z (use for roof outlines, water surfaces)" },
      "0,4": { label: "Z Unlock",   color: "summit",  commands: "ZUnlock", notes: "Release Z lock and return to ground driving" },
      "0,5": { label: "Auto Level", color: "summit",  commands: "AutoLevel", notes: "Auto-level cursor on ground" },
      "0,6": { label: "Zoom In",    color: "summit",  commands: "ZoomIn",  notes: "Image zoom in" },
      "0,7": { label: "Zoom Out",   color: "summit",  commands: "ZoomOut", notes: "Image zoom out" },

      "1,1": { label: "Auto Arc",     color: "capture", commands: "AUTOARC3D", notes: "DAT/EM Capture 3D auto-arc — default linear collection tool" },
      "1,2": { label: "Feature Line", color: "cad",     commands: "_AECCDRAWFEATURELINES", notes: "Civil 3D feature line - use for breaklines that go into a surface" },
      "1,3": { label: "COGO Point",   color: "cad",     commands: "_AECCCREATEPTMANUAL", notes: "Civil 3D COGO point - good for spot elevations" },
      "1,4": { label: "End Feat",     color: "capture", commands: "CallCmd EndFeature", notes: "Capture: end the current feature being collected" },
      "1,5": { label: "Undo Vertex",  color: "capture", commands: "CallCmd UndoLastVertex", notes: "Back up one vertex on the active feature" },

      "2,0": { label: "Building",   color: "layer", commands: "-LAYER{RET}SET{RET}BLDG{RET}{RET}PSQR2D", notes: "Switch to BLDG layer and start PSQR2D — auto-squares 90° corners" },
      "2,1": { label: "Road EOP",   color: "layer", commands: "-LAYER{RET}SET{RET}ROAD_EOP{RET}{RET}",   notes: "Switch to ROAD_EOP (edge of pavement)" },
      "2,2": { label: "Road CL",    color: "layer", commands: "-LAYER{RET}SET{RET}ROAD_CL{RET}{RET}",    notes: "Switch to ROAD_CL (road centerline)" },
      "2,3": { label: "Curb",       color: "layer", commands: "-LAYER{RET}SET{RET}CURB{RET}{RET}",       notes: "Switch to CURB layer" },
      "2,4": { label: "Driveway",   color: "layer", commands: "-LAYER{RET}SET{RET}DRIVE{RET}{RET}",      notes: "Switch to DRIVE layer" },
      "2,5": { label: "Sidewalk",   color: "layer", commands: "-LAYER{RET}SET{RET}SIDEWALK{RET}{RET}",   notes: "Switch to SIDEWALK layer" },
      "2,6": { label: "Fence",      color: "layer", commands: "-LAYER{RET}SET{RET}FENCE{RET}{RET}",      notes: "Switch to FENCE layer" },
      "2,7": { label: "Hydro Edge", color: "layer", commands: "-LAYER{RET}SET{RET}HYDRO_EDGE{RET}{RET}", notes: "Switch to HYDRO_EDGE (water edge)" },

      "3,0": { label: "Breakline",  color: "dtm",   commands: "-LAYER{RET}SET{RET}BREAKLINE{RET}{RET}_AECCDRAWFEATURELINES", notes: "Switch to BREAKLINE and start a Civil 3D feature line" },
      "3,1": { label: "Spot Elev",  color: "mixed", commands: "-LAYER{RET}SET{RET}SPOT{RET}{RET}_AECCCREATEPTMANUAL", notes: "Switch to SPOT layer and place a COGO point" },
      "3,2": { label: "Vegetation", color: "layer", commands: "-LAYER{RET}SET{RET}VEG{RET}{RET}",     notes: "Switch to VEG (vegetation/treeline)" },
      "3,3": { label: "Obscure",    color: "layer", commands: "-LAYER{RET}SET{RET}OBSCURE{RET}{RET}", notes: "Switch to OBSCURE layer" },

      "4,0": { label: "Endpoint",  color: "osnap", commands: "'_-osnap{RET}end",  notes: "Transparent OSNAP to endpoint" },
      "4,1": { label: "Intersect", color: "osnap", commands: "'_-osnap{RET}int",  notes: "Transparent OSNAP to intersection" },
      "4,2": { label: "Nearest",   color: "osnap", commands: "'_-osnap{RET}nea",  notes: "Transparent OSNAP to nearest" },
      "4,3": { label: "Snap None", color: "osnap", commands: "'_-osnap{RET}none", notes: "Turn off OSNAP" },

      "5,0": { label: "Next Pair",  color: "summit", commands: "NextStereoPair",     notes: "Move to next stereo pair in project" },
      "5,1": { label: "Prev Pair",  color: "summit", commands: "PreviousStereoPair", notes: "Move to previous stereo pair" },
      "5,2": { label: "Model Ext",  color: "summit", commands: "ModelExtents",       notes: "Zoom to extents of current stereo model" },
      "5,3": { label: "Recenter",   color: "summit", commands: "Recenter",           notes: "Recenter cursor in view" },
    },
  };
  state.currentId = id;
}
