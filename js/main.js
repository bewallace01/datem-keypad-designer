// js/main.js
// Entry point. Wires all modules together and exposes window-level handlers
// for the inline onclick attributes in index.html.

import { state, curr, newId, init, persist, recordChange, resetHistory, undo, redo, canUndo, canRedo } from "./state.js";
import { renderAll, toast, openModal, closeModal, setButtonClickHandler, setSelectionChangeHandler, setCellDropHandler, getSelection, clearSelection } from "./ui.js";
import {
  openEdit,
  closeSide,
  cancelSide,
  saveButton,
  clearButton,
  generateCommand,
  attachExampleClicks,
} from "./editor.js";
import {
  buildTextExport,
  buildJsonExport,
  importJsonBackup,
  downloadFile,
  safeFileName,
} from "./export.js";
import { buildDkfExport, dkfClampWarning, dkfFilename } from "./dkf.js";
import { buildZip } from "./zip.js";
import { dataUrlToBytes } from "./bmp.js";
import { parseDkf, summarizeDropped, deriveContextFromDkf } from "./dkf-import.js";
import { parseDxfLayers, parseDxfBlocks, buttonFromLayer, buttonFromBlock, groupLayersByCategory, CATEGORY_LABELS, disciplineOf, computeLayerBlockBindings, DEFAULT_CONTROL_BUTTONS, DEFAULT_CONTROLS_NEXT_ROW } from "./dxf-import.js";
import { renderBlockPreview, blockToBmpDataUrl } from "./block-render.js";
import { parseDwgFile } from "./dwg-import.js";
import { cellOwnerMap } from "./state.js";
import { generateLayout, describeLayers } from "./ai.js";
import { icons, populateIcons } from "./icons.js";
import { initDrawIcon, getResult as getDrawnIconResult, hasInk as drawHasInk } from "./draw.js";
import { makeBitmapName } from "./bmp.js";
import { COLORS } from "./state.js";
import { CONTEXT_TEMPLATES, DEFAULT_TEMPLATE } from "./context-templates.js";

let exportMode = "text";

// =========================================================================
// PROJECT MANAGEMENT
// =========================================================================
async function newProject() {
  const name = prompt("Project name?", "New Project");
  if (!name) return;
  const id = newId();
  state.projects[id] = {
    id,
    name,
    rows: 6,
    cols: 8,
    context: "",
    buttons: {},
  };
  state.currentId = id;
  resetHistory();
  await persist();
  renderAll();
  toast(`Created "${name}"`);
}

async function renameProject() {
  const p = curr();
  const name = prompt("Rename project:", p.name);
  if (!name) return;
  recordChange();
  p.name = name;
  await persist();
  renderAll();
}

async function duplicateProject() {
  const src = curr();
  const id = newId();
  state.projects[id] = JSON.parse(JSON.stringify(src));
  state.projects[id].id = id;
  state.projects[id].name = src.name + " (copy)";
  state.currentId = id;
  resetHistory();
  await persist();
  renderAll();
  toast("Duplicated project");
}

async function deleteProject() {
  if (Object.keys(state.projects).length === 1) {
    toast("Can't delete the last project");
    return;
  }
  const p = curr();
  if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
  delete state.projects[state.currentId];
  state.currentId = Object.keys(state.projects)[0];
  resetHistory();
  await persist();
  renderAll();
  toast("Project deleted");
}

// =========================================================================
// TEMPLATES
// =========================================================================
// Track initial values of text inputs/textareas in a modal so we can warn
// before discarding typed changes on close. Each open handler that wants
// protection calls `snapshotModalInputs(id)`; `cancelModal(id)` (and the ESC
// handler) call `isModalDirty(id)` to decide whether to prompt.
const modalSnapshots = new Map();

function snapshotModalInputs(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  const snap = new Map();
  modal.querySelectorAll("textarea, input[type=text], input[type=search]").forEach((el) => {
    snap.set(el.id || el.name || el, el.value);
  });
  modalSnapshots.set(modalId, snap);
}

function isModalDirty(modalId) {
  const snap = modalSnapshots.get(modalId);
  if (!snap) return false;
  const modal = document.getElementById(modalId);
  if (!modal) return false;
  for (const el of modal.querySelectorAll("textarea, input[type=text], input[type=search]")) {
    const key = el.id || el.name || el;
    const initial = snap.get(key) ?? "";
    if (el.value !== initial) return true;
  }
  return false;
}

function cancelModal(modalId) {
  if (isModalDirty(modalId) && !confirm("Discard your changes?")) return;
  closeModal(modalId);
  modalSnapshots.delete(modalId);
}

function openGuide() {
  openModal("guideModal");
}

function closeProjectMenu() {
  document.querySelectorAll("details.menu-popover[open]").forEach((d) => d.open = false);
}

function cancelDrawnIcon() {
  if (drawHasInk() && !confirm("Discard the current drawing?")) return;
  closeModal("drawIconModal");
}

async function saveDrawnIcon() {
  const p = curr();
  if (!p) return;
  let filename = (document.getElementById("drawFilename").value || "").trim();
  if (!filename) filename = makeBitmapName("icon", (p.customBitmaps || {}));
  if (!/\.bmp$/i.test(filename)) filename += ".bmp";
  const { bmpDataUrl } = getDrawnIconResult();
  recordChange();
  if (!p.customBitmaps) p.customBitmaps = {};
  p.customBitmaps[filename] = bmpDataUrl;
  const fBitmap = document.getElementById("fBitmap");
  if (fBitmap) fBitmap.value = filename;
  // Trigger the editor's preview refresh if the side panel is open
  fBitmap && fBitmap.dispatchEvent(new Event("input"));
  await persist();
  renderAll();
  closeModal("drawIconModal");
  toast(`Saved ${filename}`);
}

async function toggleTemplate() {
  const p = curr();
  if (!p) return;
  recordChange();
  if (p.isTemplate) delete p.isTemplate;
  else p.isTemplate = true;
  await persist();
  renderAll();
  toast(p.isTemplate ? `"${p.name}" is now a template` : `"${p.name}" is no longer a template`);
}

function openTemplatePicker() {
  const listEl = document.getElementById("templatePickerList");
  listEl.innerHTML = "";
  const projects = Object.values(state.projects);
  const tpl = projects.filter((p) => p.isTemplate).sort((a, b) => a.name.localeCompare(b.name));
  const rest = projects.filter((p) => !p.isTemplate).sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...tpl, ...rest];
  if (!ordered.length) {
    listEl.innerHTML = `<div style="color:var(--text-dim);padding:12px">No projects to pick from.</div>`;
    openModal("templatePickerModal");
    return;
  }
  for (const p of ordered) {
    const buttonCount = Object.keys(p.buttons || {}).length;
    const row = document.createElement("div");
    row.className = "template-row" + (p.isTemplate ? " is-template" : "");
    row.innerHTML = `
      <div class="template-row-main">
        <span class="template-row-name">${p.isTemplate ? "★ " : ""}${escapeHtmlText(p.name)}</span>
        <span class="template-row-meta">${p.rows}×${p.cols} grid · ${buttonCount} buttons</span>
      </div>
      <button class="primary">Use this</button>
    `;
    row.querySelector("button").addEventListener("click", () => cloneFromTemplate(p.id));
    listEl.appendChild(row);
  }
  openModal("templatePickerModal");
}

function escapeHtmlText(s) {
  return String(s).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

async function cloneFromTemplate(srcId) {
  const src = state.projects[srcId];
  if (!src) return;
  const name = prompt(`Name for the new project (cloned from "${src.name}"):`, src.name + " (copy)");
  if (!name) return;
  const id = newId();
  const clone = JSON.parse(JSON.stringify(src));
  clone.id = id;
  clone.name = name;
  delete clone.isTemplate; // the clone is a working project, not another template
  state.projects[id] = clone;
  state.currentId = id;
  resetHistory();
  await persist();
  renderAll();
  closeModal("templatePickerModal");
  toast(`Created "${name}" from ${src.isTemplate ? "template" : "project"} "${src.name}"`);
}

// =========================================================================
// GRID
// =========================================================================
function clampSpansToGrid(p) {
  for (const [key, btn] of Object.entries(p.buttons)) {
    const [r, c] = key.split(",").map(Number);
    if (r >= p.rows || c >= p.cols) {
      delete p.buttons[key];
      continue;
    }
    if (btn.width && c + btn.width > p.cols) btn.width = p.cols - c;
    if (btn.height && r + btn.height > p.rows) btn.height = p.rows - r;
    if (btn.width === 1) delete btn.width;
    if (btn.height === 1) delete btn.height;
  }
}

async function changeGrid(dRows, dCols) {
  const p = curr();
  const newRows = Math.max(1, Math.min(20, p.rows + dRows));
  const newCols = Math.max(1, Math.min(20, p.cols + dCols));
  if (newRows === p.rows && newCols === p.cols) return;
  recordChange();
  p.rows = newRows;
  p.cols = newCols;
  clampSpansToGrid(p);
  await persist();
  renderAll();
}

async function applyPreset(val) {
  if (!val) return;
  const [r, c] = val.split(",").map(Number);
  const p = curr();
  if (p.rows === r && p.cols === c) return;
  recordChange();
  p.rows = r;
  p.cols = c;
  clampSpansToGrid(p);
  await persist();
  renderAll();
}

async function clearAll() {
  if (!confirm("Clear all buttons in this project?")) return;
  recordChange();
  curr().buttons = {};
  await persist();
  renderAll();
  toast("Cleared all buttons");
}

// =========================================================================
// CONTEXT MODAL
// =========================================================================
function openContext() {
  const p = curr();
  document.getElementById("contextText").value = p.context || "";
  document.getElementById("contextProjectName").textContent = p.name;
  // Populate the baseline-template dropdown the first time the modal opens.
  // Subsequent opens keep the dropdown's current selection so an operator
  // who edits multiple projects in a session keeps their pick.
  const sel = document.getElementById("contextTemplate");
  if (!sel.options.length) {
    for (const [id, t] of Object.entries(CONTEXT_TEMPLATES)) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = t.label;
      sel.appendChild(opt);
    }
    sel.value = DEFAULT_TEMPLATE;
  }
  // Bind the .dkf and .txt file inputs once. We reset .value on each change
  // so picking the same file twice in a row still fires the change event.
  const dkfInput = document.getElementById("contextDkfFile");
  if (!dkfInput.dataset.bound) {
    dkfInput.dataset.bound = "1";
    dkfInput.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      await deriveContextFromDkfFile(f);
    });
  }
  const txtInput = document.getElementById("contextTxtFile");
  if (!txtInput.dataset.bound) {
    txtInput.dataset.bound = "1";
    txtInput.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      await loadContextFromTextFile(f);
    });
  }
  openModal("contextModal");
  snapshotModalInputs("contextModal");
}

function insertContextTemplate() {
  const sel = document.getElementById("contextTemplate");
  const tpl = CONTEXT_TEMPLATES[sel.value];
  if (!tpl) return;
  setContextTextWithConfirm(tpl.text);
}

function setContextTextWithConfirm(newText) {
  const ta = document.getElementById("contextText");
  if (ta.value.trim() && !confirm("Replace the current context? Click Cancel to keep what you have.")) return false;
  ta.value = newText;
  ta.focus();
  ta.setSelectionRange(0, 0);
  ta.scrollTop = 0;
  return true;
}

async function deriveContextFromDkfFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const { project } = parseDkf(text);
    const derived = deriveContextFromDkf(project, file.name);
    if (setContextTextWithConfirm(derived)) {
      toast(`Context derived from ${file.name}`);
    }
  } catch (e) {
    console.error(e);
    toast(`Couldn't read ${file.name}: ${e.message}`);
  }
}

async function loadContextFromTextFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    if (setContextTextWithConfirm(text)) {
      toast(`Loaded ${file.name}`);
    }
  } catch (e) {
    console.error(e);
    toast(`Couldn't read ${file.name}: ${e.message}`);
  }
}

function saveContextToFile() {
  const p = curr();
  const text = document.getElementById("contextText").value;
  if (!text.trim()) { toast("Nothing to save — textarea is empty"); return; }
  const base = safeFileName(p.name || "project") + "_context";
  downloadFile(`${base}.txt`, text);
  toast(`Saved ${base}.txt`);
}

async function saveContext() {
  const p = curr();
  const newText = document.getElementById("contextText").value;
  if (newText === p.context) { closeModal("contextModal"); return; }
  recordChange();
  p.context = newText;
  await persist();
  closeModal("contextModal");
  toast("Project context saved");
}

// =========================================================================
// AUTOFILL MODAL
// =========================================================================
function openAutofill() {
  const p = curr();
  document.getElementById("autofillGridSize").textContent = `${p.rows} × ${p.cols}`;
  document.getElementById("autofillNoContext").style.display =
    p.context && p.context.trim() ? "none" : "block";
  document.getElementById("autofillExtra").value = "";
  document.getElementById("autofillStatus").textContent = "";
  document.getElementById("autofillStatus").className = "ai-status";
  document.getElementById("autofillBtn").disabled = false;
  document.getElementById("autofillBtn").textContent = "Generate layout";
  openModal("autofillModal");
  snapshotModalInputs("autofillModal");
}

async function doAutofill() {
  const p = curr();
  const fillMode = document.querySelector('input[name="fillMode"]:checked').value;
  const extra = document.getElementById("autofillExtra").value.trim();
  const btn = document.getElementById("autofillBtn");
  const status = document.getElementById("autofillStatus");

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Designing layout...';
  status.textContent = "";
  status.className = "ai-status";

  try {
    const buttons = await generateLayout({
      rows: p.rows,
      cols: p.cols,
      projectContext: p.context || "",
      fillMode,
      occupiedCells: fillMode === "empty" ? Object.keys(p.buttons) : [],
      extraInstructions: extra,
    });

    recordChange();
    if (fillMode === "replace") p.buttons = {};

    let added = 0,
      skipped = 0,
      outOfBounds = 0;
    const validColors = COLORS.map((c) => c.id);
    for (const b of buttons) {
      if (typeof b.row !== "number" || typeof b.col !== "number") continue;
      if (b.row < 0 || b.row >= p.rows || b.col < 0 || b.col >= p.cols) {
        outOfBounds++;
        continue;
      }
      const key = `${b.row},${b.col}`;
      if (fillMode === "empty" && p.buttons[key]) {
        skipped++;
        continue;
      }
      const color = validColors.includes(b.color) ? b.color : "neutral";
      p.buttons[key] = {
        label: (b.label || "").slice(0, 30),
        color,
        commands: b.commands || "",
        notes: b.notes || "",
      };
      added++;
    }

    await persist();
    renderAll();

    let summary = `✓ Added ${added} buttons`;
    if (skipped) summary += `, skipped ${skipped} occupied`;
    if (outOfBounds) summary += `, ${outOfBounds} out of bounds`;
    summary += ".";

    status.textContent = summary;
    status.className = "ai-status success";
    setTimeout(() => closeModal("autofillModal"), 1500);
    toast(`Generated ${added} buttons`);
  } catch (e) {
    console.error(e);
    status.textContent = "Auto-fill failed: " + e.message;
    status.className = "ai-status error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate layout";
  }
}

// =========================================================================
// EXPORT / IMPORT
// =========================================================================
function renderExport(mode) {
  if (mode === "dkf") return buildDkfExport(curr());
  if (mode === "json") return buildJsonExport();
  if (mode === "zip") return renderZipPreview(curr());
  return buildTextExport();
}

function renderZipPreview(p) {
  const dkfFile = dkfFilename(p);
  const customBitmaps = Object.keys(p.customBitmaps || {});
  const used = new Set();
  for (const b of Object.values(p.buttons || {})) if (b.bitmap) used.add(b.bitmap);
  const includedBitmaps = customBitmaps.filter((n) => used.has(n));
  const referencedExternal = [...used].filter((n) => !p.customBitmaps || !p.customBitmaps[n]);
  const lines = [
    `Bundle preview — what the ZIP will contain:`,
    ``,
    `${dkfFile}`,
    ...includedBitmaps.map((n) => `bitmaps/${n}`),
    ``,
  ];
  if (referencedExternal.length) {
    lines.push(`Buttons also reference these BMP names that aren't in the project bundle (DAT/EM must already have them):`);
    referencedExternal.forEach((n) => lines.push(`  - ${n}`));
    lines.push("");
  }
  lines.push(`Workflow after download:`);
  lines.push(`  1. Unzip somewhere on the keypad PC.`);
  lines.push(`  2. Copy every file in bitmaps/ into your DAT/EM bitmap folder`);
  lines.push(`     (typically C:\\DAT-EM\\Bitmaps\\). Existing files of the same`);
  lines.push(`     name are overwritten — rename here first if that's a problem.`);
  lines.push(`  3. Open ${dkfFile} in DAT/EM Keypad Editor.`);
  return lines.join("\n");
}

function openExport() {
  setExportMode("text");
  openModal("exportModal");
}

function setExportMode(mode) {
  exportMode = mode;
  document.getElementById("expBtnText").classList.toggle("primary", mode === "text");
  document.getElementById("expBtnJson").classList.toggle("primary", mode === "json");
  document.getElementById("expBtnDkf").classList.toggle("primary", mode === "dkf");
  document.getElementById("expBtnZip").classList.toggle("primary", mode === "zip");
  document.getElementById("exportText").value = renderExport(mode);
  if (mode === "dkf" || mode === "zip") {
    const warn = dkfClampWarning(curr());
    if (warn) toast(warn);
  }
}

async function copyExport() {
  const text = document.getElementById("exportText").value;
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch {
    toast("Copy failed; select and copy manually");
  }
}

function doDownloadExport() {
  const p = curr();
  if (exportMode === "zip") {
    downloadZipExport(p);
    return;
  }
  const text = document.getElementById("exportText").value;
  if (exportMode === "dkf") {
    downloadFile(dkfFilename(p), text);
    return;
  }
  const ext = exportMode === "json" ? "json" : "txt";
  downloadFile(`keypad_${safeFileName(p.name)}.${ext}`, text);
}

function downloadZipExport(p) {
  const dkfText = buildDkfExport(p);
  const dkfName = dkfFilename(p);
  const entries = [{ name: dkfName, data: new TextEncoder().encode(dkfText) }];
  const used = new Set();
  for (const b of Object.values(p.buttons || {})) if (b.bitmap) used.add(b.bitmap);
  for (const [name, dataUrl] of Object.entries(p.customBitmaps || {})) {
    if (!used.has(name)) continue; // skip orphan bitmaps that no button references
    entries.push({ name: `bitmaps/${name}`, data: dataUrlToBytes(dataUrl) });
  }
  const zipBytes = buildZip(entries);
  const blob = new Blob([zipBytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(p.name)}_bundle.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// =========================================================================
// BULK SELECTION + ACTIONS
// =========================================================================
function renderActionBar() {
  const sel = getSelection();
  const bar = document.getElementById("actionBar");
  if (!sel.length) {
    bar.classList.remove("open");
    return;
  }
  document.getElementById("actionBarCount").textContent =
    `${sel.length} selected`;
  bar.classList.add("open");
  // Render swatches (only color-applying — header flag swap is its own button)
  const swatchEl = document.getElementById("actionBarSwatches");
  if (!swatchEl.dataset.rendered) {
    swatchEl.innerHTML = "";
    for (const c of COLORS) {
      const s = document.createElement("div");
      s.className = "swatch";
      s.style.background = c.hex;
      s.title = `Recolor selected to "${c.name}"`;
      s.addEventListener("click", () => bulkRecolor(c.id));
      swatchEl.appendChild(s);
    }
    swatchEl.dataset.rendered = "1";
  }
}

async function bulkRecolor(colorId) {
  const sel = getSelection();
  if (!sel.length) return;
  recordChange();
  const p = curr();
  let n = 0;
  for (const key of sel) {
    if (p.buttons[key]) {
      p.buttons[key].color = colorId;
      n++;
    }
  }
  await persist();
  renderAll();
  toast(`Recolored ${n} button${n === 1 ? "" : "s"}`);
}

// Drag-to-move: relocate `sourceKey`'s master button so its top-left lands at
// (toR, toC). Multi-cell spans move with the button; collision-check the full
// footprint at the destination (the source's own cells count as free since
// they vacate). Reject moves that go off-grid or collide with another button.
async function moveButton(sourceKey, toR, toC) {
  const p = curr();
  const btn = p.buttons[sourceKey];
  if (!btn) return;
  const [fromR, fromC] = sourceKey.split(",").map(Number);
  if (fromR === toR && fromC === toC) return;
  const w = btn.width || 1;
  const h = btn.height || 1;
  if (toR + h > p.rows || toC + w > p.cols) {
    toast("Won't fit there — span would go off the grid");
    return;
  }
  const owner = cellOwnerMap(p);
  for (let dr = 0; dr < h; dr++) {
    for (let dc = 0; dc < w; dc++) {
      const cell = `${toR + dr},${toC + dc}`;
      const o = owner[cell];
      if (o && o !== sourceKey) {
        toast(`Can't drop — ${toR + dr + 1},${toC + dc + 1} is occupied`);
        return;
      }
    }
  }
  recordChange();
  const targetKey = `${toR},${toC}`;
  delete p.buttons[sourceKey];
  p.buttons[targetKey] = btn;
  // Selection follows the move so a recolor-then-drag flow keeps highlights.
  clearSelection();
  await persist();
  renderAll();
}

async function bulkDelete() {
  const sel = getSelection();
  if (!sel.length) return;
  if (!confirm(`Delete ${sel.length} selected button${sel.length === 1 ? "" : "s"}?`)) return;
  recordChange();
  const p = curr();
  let n = 0;
  for (const key of sel) {
    if (p.buttons[key]) { delete p.buttons[key]; n++; }
  }
  clearSelection();
  await persist();
  renderAll();
  toast(`Deleted ${n} button${n === 1 ? "" : "s"}`);
}

function clearBulkSelection() {
  clearSelection();
}

function openBulkFindReplace() {
  const sel = getSelection();
  if (!sel.length) return;
  document.getElementById("bulkFindCount").textContent = sel.length;
  document.getElementById("bulkFindFrom").value = "";
  document.getElementById("bulkFindTo").value = "";
  openModal("bulkFindModal");
  snapshotModalInputs("bulkFindModal");
  setTimeout(() => document.getElementById("bulkFindFrom").focus(), 50);
}

async function doBulkFindReplace() {
  const from = document.getElementById("bulkFindFrom").value;
  const to = document.getElementById("bulkFindTo").value;
  if (!from) { toast("Type something to find first"); return; }
  const doLabel = document.getElementById("bulkFindLabel").checked;
  const doCmds = document.getElementById("bulkFindCommands").checked;
  const doNotes = document.getElementById("bulkFindNotes").checked;
  if (!doLabel && !doCmds && !doNotes) { toast("Pick at least one field"); return; }

  recordChange();
  const p = curr();
  const sel = getSelection();
  let buttonsTouched = 0;
  let replacements = 0;
  const fromRe = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  for (const key of sel) {
    const b = p.buttons[key];
    if (!b) continue;
    let touched = false;
    if (doLabel && b.label && b.label.includes(from)) {
      const before = b.label;
      b.label = b.label.split(from).join(to);
      replacements += before.split(from).length - 1;
      touched = true;
    }
    if (doCmds && b.commands && b.commands.includes(from)) {
      const before = b.commands;
      b.commands = b.commands.split(from).join(to);
      replacements += before.split(from).length - 1;
      touched = true;
    }
    if (doNotes && b.notes && b.notes.includes(from)) {
      const before = b.notes;
      b.notes = b.notes.split(from).join(to);
      replacements += before.split(from).length - 1;
      touched = true;
    }
    if (touched) buttonsTouched++;
  }
  await persist();
  renderAll();
  closeModal("bulkFindModal");
  toast(`Replaced ${replacements} occurrence${replacements === 1 ? "" : "s"} across ${buttonsTouched} button${buttonsTouched === 1 ? "" : "s"}`);
}

// =========================================================================
// DXF IMPORT (CAD layer table → buttons)
// =========================================================================
let dxfLayers = []; // parsed layers from the most recent file
let dxfBlocks = []; // parsed blocks from the most recent file
let dxfBindings = new Map(); // layerName -> linked block, derived from parse
let blockConfigEditing = null; // which block the config modal is editing

function openDxfImport() {
  dxfLayers = [];
  dxfBlocks = [];
  document.getElementById("dxfFile").value = "";
  document.getElementById("dxfStatus").textContent = "";
  document.getElementById("dxfStatus").className = "ai-status";
  document.getElementById("dxfPickArea").style.display = "none";
  document.getElementById("dxfGenerateBtn").disabled = true;
  document.getElementById("dxfLayerList").innerHTML = "";
  document.getElementById("dxfBlockList").innerHTML = "";
  document.getElementById("dxfBlocksSection").style.display = "none";
  document.getElementById("dxfSearch").value = "";
  document.getElementById("dxfHideOff").checked = true;
  openModal("dxfImportModal");
}

async function handleDxfFile(file) {
  const status = document.getElementById("dxfStatus");
  if (!file) return;
  const isBinary = /\.(dwg|dwt)$/i.test(file.name);
  status.textContent = isBinary
    ? `Loading WASM parser + reading ${file.name}…`
    : `Reading ${file.name}…`;
  status.className = "ai-status";
  try {
    if (isBinary) {
      const buf = await file.arrayBuffer();
      const parsed = await parseDwgFile(buf);
      dxfLayers = parsed.layers;
      dxfBlocks = parsed.blocks;
    } else {
      const text = await file.text();
      dxfLayers = parseDxfLayers(text);
      dxfBlocks = parseDxfBlocks(text);
    }
    if (!dxfLayers.length) throw new Error("No layers found — is this a CAD file?");
    // Two filterable axes: OFF flag (template visibility snapshot) and
    // entity count (does the layer actually have geometry drawn on it).
    // Templates often have everything OFF AND every layer has 1-2 stub
    // entities; working drawings have a meaningful entity distribution.
    const offCount = dxfLayers.filter((l) => l.off).length;
    const withEntities = dxfLayers.filter((l) => l.entityCount > 0).length;
    const empty = dxfLayers.length - withEntities;

    // Pre-select: V- layers that have actual entities. Falls back to all V-
    // layers if the entity count is degenerate (every layer has 0 or every
    // layer has >0 — neither signal is useful for ranking).
    const hasMeaningfulEntityData = withEntities > 0 && empty > 0;
    for (const l of dxfLayers) {
      const isV = /^V-/.test(l.name);
      l._selected = hasMeaningfulEntityData ? (isV && l.entityCount > 0) : isV;
    }

    // Auto-disable filters when they'd hide everything useful.
    if (offCount / dxfLayers.length > 0.5) {
      document.getElementById("dxfHideOff").checked = false;
    }
    document.getElementById("dxfHideEmpty").checked = hasMeaningfulEntityData;

    const preselected = dxfLayers.filter((l) => l._selected).length;
    const parts = [`✓ Parsed ${dxfLayers.length} layers`];
    if (hasMeaningfulEntityData) parts.push(`${withEntities} have entities, ${empty} are empty`);
    else if (offCount) parts.push(`${offCount} off in template`);
    parts.push(`pre-selected ${preselected}${hasMeaningfulEntityData ? " V- layers with content" : " V- layers"}`);
    if (dxfBlocks.length) parts.push(`${dxfBlocks.length} blocks`);
    // Compute layer↔block bindings (each layer pairs with at most one block
    // whose dominant insertion target is that layer). Surfaced in the layer
    // row and used during generation when auto-linking is on.
    dxfBindings = computeLayerBlockBindings(dxfLayers, dxfBlocks);
    if (dxfBindings.size) parts.push(`${dxfBindings.size} auto-linked`);
    status.textContent = parts.join(" · ");
    status.className = "ai-status success";
    document.getElementById("dxfPickArea").style.display = "block";
    // Blocks: pre-select unlinked blocks with actual usage. Linked blocks
    // are handled by the paired layer button, so don't pre-select them.
    const linkedBlockNames = new Set(Array.from(dxfBindings.values()).map((b) => b.name));
    for (const b of dxfBlocks) {
      b._linkedToLayer = linkedBlockNames.has(b.name);
      b._selected = b.totalInserts > 0 && !b._linkedToLayer;
    }
    document.getElementById("dxfBlocksSection").style.display = dxfBlocks.length ? "block" : "none";
    renderDxfLayerList();
    renderDxfBlockList();
    updateDxfGenerateBtn();
  } catch (e) {
    status.textContent = "Couldn't parse: " + e.message;
    status.className = "ai-status error";
  }
}

function renderDxfLayerList() {
  const list = document.getElementById("dxfLayerList");
  const hideOff = document.getElementById("dxfHideOff").checked;
  const hideEmpty = document.getElementById("dxfHideEmpty").checked;
  const query = document.getElementById("dxfSearch").value.trim().toLowerCase();
  const groups = {};
  for (const l of dxfLayers) {
    if (hideOff && l.off) continue;
    if (hideEmpty && l.entityCount === 0) continue;
    if (query && !l.name.toLowerCase().includes(query)) continue;
    const d = disciplineOf(l.name);
    (groups[d] = groups[d] || []).push(l);
  }
  // Within each group, list most-active layers first.
  for (const g of Object.keys(groups)) {
    groups[g].sort((a, b) => (b.entityCount || 0) - (a.entityCount || 0) || a.name.localeCompare(b.name));
  }
  list.innerHTML = "";
  const groupNames = Object.keys(groups).sort();
  for (const g of groupNames) {
    const items = groups[g];
    const groupEl = document.createElement("div");
    groupEl.className = "dxf-group";
    const checkedCount = items.filter((l) => l._selected).length;
    groupEl.innerHTML = `
      <div class="dxf-group-header">
        <label class="checkbox-row">
          <input type="checkbox" data-group="${g}" ${checkedCount === items.length ? "checked" : ""} ${checkedCount > 0 && checkedCount < items.length ? "data-mixed='1'" : ""}>
          <span><strong>${g}</strong> <span style="color:var(--text-dim)">(${items.length})</span></span>
        </label>
      </div>
      <div class="dxf-group-items"></div>
    `;
    const itemsEl = groupEl.querySelector(".dxf-group-items");
    for (const l of items) {
      const row = document.createElement("label");
      row.className = "dxf-row checkbox-row";
      const ent = l.entityCount;
      const entLabel = ent === 0
        ? ` · <span class="dxf-empty">no entities</span>`
        : ` · <span class="dxf-busy">${ent} entit${ent === 1 ? "y" : "ies"}</span>`;
      const linked = dxfBindings.get(l.name);
      const linkedLabel = linked
        ? ` · <span class="dxf-linked">inserts ${linked.name}</span>`
        : "";
      row.innerHTML = `
        <input type="checkbox" data-layer="${l.name}" ${l._selected ? "checked" : ""}>
        <span class="dxf-row-name">${l.name}</span>
        <span class="dxf-row-meta">ACI ${l.aci}${l.off ? " · OFF" : ""}${l.frozen ? " · FROZEN" : ""}${entLabel}${linkedLabel}</span>
      `;
      itemsEl.appendChild(row);
    }
    list.appendChild(groupEl);
  }
  // wire checkbox handlers
  list.querySelectorAll('input[type="checkbox"][data-layer]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const layer = dxfLayers.find((l) => l.name === cb.dataset.layer);
      if (layer) layer._selected = cb.checked;
      updateDxfGenerateBtn();
    });
  });
  list.querySelectorAll('input[type="checkbox"][data-group]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const g = cb.dataset.group;
      for (const l of dxfLayers) {
        if (disciplineOf(l.name) === g && (!hideOff || !l.off)) {
          if (!query || l.name.toLowerCase().includes(query)) l._selected = cb.checked;
        }
      }
      renderDxfLayerList();
      updateDxfGenerateBtn();
    });
  });
}

function renderDxfBlockList() {
  const list = document.getElementById("dxfBlockList");
  if (!list) return;
  list.innerHTML = "";
  const sorted = [...dxfBlocks].sort((a, b) => (b.totalInserts || 0) - (a.totalInserts || 0) || a.name.localeCompare(b.name));
  for (const block of sorted) {
    const row = document.createElement("div");
    row.className = "dxf-row dxf-block-row" + (block._linkedToLayer ? " dxf-linked-row" : "");
    const linkSuffix = block._linkedToLayer
      ? ` · <span class="dxf-linked">covered by ${block.dominantLayer} layer button</span>`
      : "";
    const usageBadge = block.totalInserts > 0
      ? ` · <span class="dxf-busy">${block.totalInserts} use${block.totalInserts === 1 ? "" : "s"}${block.dominantLayer ? ` on ${block.dominantLayer}` : ""}</span>`
      : ` · <span class="dxf-empty">never inserted in this drawing</span>`;
    const overrideBadge = block._override
      ? ` · <span class="dxf-linked">customized</span>`
      : "";
    row.innerHTML = `
      <label class="dxf-block-check">
        <input type="checkbox" data-block="${block.name}" ${block._selected ? "checked" : ""}>
        <span class="dxf-row-name">${block.name}</span>
        <span class="dxf-row-meta">${usageBadge}${linkSuffix}${overrideBadge}</span>
      </label>
      <button type="button" class="dxf-config-btn" data-config-block="${block.name}">Configure…</button>
    `;
    list.appendChild(row);
  }
  list.querySelectorAll('input[type="checkbox"][data-block]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const b = dxfBlocks.find((x) => x.name === cb.dataset.block);
      if (b) b._selected = cb.checked;
      updateDxfGenerateBtn();
    });
  });
  list.querySelectorAll("[data-config-block]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBlockConfig(btn.dataset.configBlock);
    });
  });
}

function openBlockConfig(blockName) {
  const block = dxfBlocks.find((b) => b.name === blockName);
  if (!block) return;
  blockConfigEditing = block;
  document.getElementById("blockConfigName").textContent = block.name;
  // Visual preview of the block's geometry
  const canvas = document.getElementById("blockConfigCanvas");
  renderBlockPreview(canvas, block.entities || [], { color: "#e8edf5" });
  const stats = document.getElementById("blockConfigStats");
  const drawable = (block.entities || []).filter((e) => !e.ignored).length;
  const total = (block.entities || []).length;
  stats.textContent = total
    ? `${drawable} of ${total} entities renderable`
    : "no geometry available (DWG/DWT — preview not supported yet)";

  // Populate layer dropdown with all parsed layers, plus the dominant one.
  const sel = document.getElementById("blockConfigLayer");
  sel.innerHTML = "";
  const seen = new Set();
  const opts = [];
  if (block.dominantLayer) {
    opts.push({ value: block.dominantLayer, label: `${block.dominantLayer} (dominant from ${block.totalInserts} inserts)` });
    seen.add(block.dominantLayer);
  }
  for (const l of dxfLayers) {
    if (seen.has(l.name)) continue;
    opts.push({ value: l.name, label: l.name });
    seen.add(l.name);
  }
  // Allow "0" / no-layer-switch
  if (!seen.has("0")) opts.push({ value: "0", label: "0 (no layer switch)" });
  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }

  const ov = block._override || {};
  sel.value = ov.layer || block.dominantLayer || "0";
  document.getElementById("blockConfigScale").value = ov.scale ?? 1;
  document.getElementById("blockConfigRotation").value = ov.rotation ?? 0;
  refreshBlockConfigPreview();

  openModal("blockConfigModal");
  snapshotModalInputs("blockConfigModal");

  // Wire live preview updates (once per modal open)
  if (!sel.dataset.wired) {
    sel.addEventListener("change", refreshBlockConfigPreview);
    document.getElementById("blockConfigScale").addEventListener("input", refreshBlockConfigPreview);
    document.getElementById("blockConfigRotation").addEventListener("input", refreshBlockConfigPreview);
    sel.dataset.wired = "1";
  }
}

function refreshBlockConfigPreview() {
  if (!blockConfigEditing) return;
  const layer = document.getElementById("blockConfigLayer").value;
  const scale = parseFloat(document.getElementById("blockConfigScale").value) || 1;
  const rotation = parseFloat(document.getElementById("blockConfigRotation").value) || 0;
  // Re-use the real button factory for fidelity; show only the macro text.
  const preview = buttonFromBlock(blockConfigEditing, { layer, scale, rotation }).commands;
  document.getElementById("blockConfigPreview").textContent = preview;
}

function saveBlockConfig() {
  if (!blockConfigEditing) return;
  const layer = document.getElementById("blockConfigLayer").value;
  const scale = parseFloat(document.getElementById("blockConfigScale").value);
  const rotation = parseFloat(document.getElementById("blockConfigRotation").value);
  const isDefault = layer === (blockConfigEditing.dominantLayer || "0") && (!scale || scale === 1) && (!rotation || rotation === 0);
  if (isDefault) {
    delete blockConfigEditing._override;
  } else {
    blockConfigEditing._override = { layer, scale, rotation };
  }
  closeModal("blockConfigModal");
  modalSnapshots.delete("blockConfigModal");
  renderDxfBlockList();
  blockConfigEditing = null;
}

function resetBlockConfig() {
  if (!blockConfigEditing) return;
  document.getElementById("blockConfigLayer").value = blockConfigEditing.dominantLayer || "0";
  document.getElementById("blockConfigScale").value = 1;
  document.getElementById("blockConfigRotation").value = 0;
  refreshBlockConfigPreview();
}

function dxfBlocksSelectAll(value) {
  for (const b of dxfBlocks) {
    if (value && b.totalInserts === 0) continue; // "select all used" skips empties
    b._selected = value;
  }
  renderDxfBlockList();
  updateDxfGenerateBtn();
}

function updateDxfGenerateBtn() {
  const nLayers = dxfLayers.filter((l) => l._selected).length;
  const nBlocks = dxfBlocks.filter((b) => b._selected).length;
  const n = nLayers + nBlocks;
  const btn = document.getElementById("dxfGenerateBtn");
  btn.disabled = n === 0;
  const parts = [];
  if (nLayers) parts.push(`${nLayers} layer${nLayers === 1 ? "" : "s"}`);
  if (nBlocks) parts.push(`${nBlocks} block${nBlocks === 1 ? "" : "s"}`);
  btn.textContent = n ? `Generate ${parts.join(" + ")}` : "Generate buttons";
  // Layer report button: enabled whenever at least one layer has entities.
  const mapped = dxfLayers.filter((l) => l.entityCount > 0).length;
  const reportBtn = document.getElementById("dxfReportBtn");
  reportBtn.disabled = mapped === 0;
  reportBtn.innerHTML = `<span class="btn-icon">${icons.barChart()}</span>${mapped ? `Layer report (${mapped})` : "Layer report (CSV)"}`;
}

function dxfSelectAll(value) {
  const hideOff = document.getElementById("dxfHideOff").checked;
  const hideEmpty = document.getElementById("dxfHideEmpty").checked;
  const query = document.getElementById("dxfSearch").value.trim().toLowerCase();
  for (const l of dxfLayers) {
    if (hideOff && l.off) continue;
    if (hideEmpty && l.entityCount === 0) continue;
    if (query && !l.name.toLowerCase().includes(query)) continue;
    l._selected = value;
  }
  renderDxfLayerList();
  updateDxfGenerateBtn();
}

async function doUndo() {
  const ok = await undo();
  if (ok) { renderAll(); toast("Undid last change"); }
}
async function doRedo() {
  const ok = await redo();
  if (ok) { renderAll(); toast("Redid"); }
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function dxfExportReport() {
  const mapped = dxfLayers.filter((l) => l.entityCount > 0);
  if (!mapped.length) return;
  const status = document.getElementById("dxfStatus");
  const btn = document.getElementById("dxfReportBtn");
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Asking AI…';
  status.textContent = `Generating descriptions for ${mapped.length} layers…`;
  status.className = "ai-status";
  try {
    const names = mapped.map((l) => l.name);
    const descriptions = await describeLayers(names);
    const header = ["Layer", "Entities", "ACI Color", "State", "Frozen", "Description"];
    const rows = [header];
    for (const l of mapped.sort((a, b) => b.entityCount - a.entityCount)) {
      rows.push([
        l.name,
        l.entityCount,
        l.aci,
        l.off ? "Off" : "On",
        l.frozen ? "Frozen" : "Thawed",
        descriptions[l.name] || "",
      ]);
    }
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
    const filename = `layer_report_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadFile(filename, csv);
    status.textContent = `✓ Wrote ${filename} (${mapped.length} layers documented)`;
    status.className = "ai-status success";
  } catch (e) {
    console.error(e);
    status.textContent = "Report failed: " + e.message;
    status.className = "ai-status error";
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

async function dxfGenerate() {
  const p = curr();
  const fillMode = document.getElementById("dxfFillMode").value;
  let startRow = Math.max(0, parseInt(document.getElementById("dxfStartRow").value, 10) || 0);
  const includeTool = document.getElementById("dxfIncludeTool").checked;
  const includeHeaders = document.getElementById("dxfIncludeHeaders").checked;
  const linkBlocks = document.getElementById("dxfLinkBlocks").checked;
  const includeControls = document.getElementById("dxfIncludeControls").checked;
  const includeBlockIcons = document.getElementById("dxfBlockIcons").checked;
  const selected = dxfLayers.filter((l) => l._selected);
  const selectedBlocks = dxfBlocks.filter((b) => b._selected);
  if (!selected.length && !selectedBlocks.length) return;

  recordChange();
  if (fillMode === "replace") p.buttons = {};
  if (!p.customBitmaps) p.customBitmaps = {};

  // Build the live occupancy map (handles existing multi-cell button spans).
  // Mutate it as we place new buttons so subsequent placements see the claims.
  const owner = cellOwnerMap(p);
  const claim = (r, c, key, w = 1, h = 1) => {
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) owner[`${r + dr},${c + dc}`] = key;
    }
  };
  const isFree = (r, c, w = 1) => {
    for (let dc = 0; dc < w; dc++) if (owner[`${r},${c + dc}`]) return false;
    return true;
  };

  // Prepend the default control buttons (Summit + Capture + OSNAP) at the top
  // before any layer placement. Skip cells that are already occupied (so the
  // option is safe in "fill empty only" mode) and any column that falls
  // outside the user's grid width. Bump startRow so layer placement begins
  // below the controls block.
  let controlsPlaced = 0;
  if (includeControls) {
    for (const ctl of DEFAULT_CONTROL_BUTTONS) {
      if (ctl.col >= p.cols || ctl.row >= p.rows) continue;
      if (!isFree(ctl.row, ctl.col)) continue;
      const key = `${ctl.row},${ctl.col}`;
      p.buttons[key] = { label: ctl.label, color: ctl.color, commands: ctl.commands, notes: ctl.notes };
      claim(ctl.row, ctl.col, key);
      controlsPlaced++;
    }
    if (controlsPlaced) startRow = Math.max(startRow, DEFAULT_CONTROLS_NEXT_ROW);
  }

  // Group selected layers by category, then place section by section. Each
  // section starts on a fresh row with an optional 2-wide colored header,
  // then the section's buttons fill the rest of the row and wrap as needed.
  const groups = groupLayersByCategory(selected);

  let placed = 0;
  let headersAdded = 0;
  let r = startRow;
  for (const { category, layers } of groups) {
    if (r >= p.rows) break;
    let c = 0;
    if (includeHeaders && c + 2 <= p.cols && isFree(r, c, 2)) {
      const key = `${r},${c}`;
      p.buttons[key] = {
        label: CATEGORY_LABELS[category] || category.toUpperCase(),
        color: category,
        commands: "",
        notes: "",
        header: true,
        width: 2,
      };
      claim(r, c, key, 2, 1);
      headersAdded++;
      c += 2;
    }
    for (const layer of layers) {
      while (r < p.rows && !isFree(r, c)) {
        c++;
        if (c >= p.cols) { c = 0; r++; }
      }
      if (r >= p.rows) break;
      const key = `${r},${c}`;
      const linkedBlock = linkBlocks ? dxfBindings.get(layer.name) || null : null;
      p.buttons[key] = buttonFromLayer(layer, { includeDrawingTool: includeTool, linkedBlock });
      claim(r, c, key);
      placed++;
      c++;
      if (c >= p.cols) { c = 0; r++; }
    }
    if (c > 0) { c = 0; r++; }
  }

  // After layer buttons: append a "BLOCKS" header (if any blocks selected) +
  // one button per selected block. Same fill-and-wrap layout.
  let blocksPlaced = 0;
  if (selectedBlocks.length && r < p.rows) {
    let c = 0;
    if (includeHeaders && c + 2 <= p.cols && isFree(r, c, 2)) {
      const key = `${r},${c}`;
      p.buttons[key] = {
        label: "BLOCKS",
        color: "neutral",
        commands: "",
        notes: "",
        header: true,
        width: 2,
      };
      claim(r, c, key, 2, 1);
      headersAdded++;
      c += 2;
    }
    for (const block of selectedBlocks) {
      while (r < p.rows && !isFree(r, c)) {
        c++;
        if (c >= p.cols) { c = 0; r++; }
      }
      if (r >= p.rows) break;
      const key = `${r},${c}`;
      const button = buttonFromBlock(block, block._override || {});
      if (includeBlockIcons) {
        const dataUrl = blockToBmpDataUrl(block.entities);
        if (dataUrl) {
          const filename = makeBitmapName(`blk_${block.name}`, p.customBitmaps);
          p.customBitmaps[filename] = dataUrl;
          button.bitmap = filename;
        }
      }
      p.buttons[key] = button;
      claim(r, c, key);
      blocksPlaced++;
      c++;
      if (c >= p.cols) { c = 0; r++; }
    }
  }

  const leftover = (selected.length - placed) + (selectedBlocks.length - blocksPlaced);

  await persist();
  renderAll();
  closeModal("dxfImportModal");
  const total = placed + blocksPlaced + controlsPlaced;
  let summary = `Placed ${total} button${total === 1 ? "" : "s"}`;
  if (controlsPlaced) summary += ` (${controlsPlaced} control + ${placed} layer + ${blocksPlaced} block)`;
  else if (blocksPlaced) summary += ` (${placed} layer + ${blocksPlaced} block)`;
  if (headersAdded) summary += `, ${headersAdded} section header${headersAdded === 1 ? "" : "s"}`;
  if (leftover) summary += `, ${leftover} didn't fit (grow the grid or use replace mode)`;
  toast(summary);
}

function openImport() {
  document.getElementById("importText").value = "";
  openModal("importModal");
  snapshotModalInputs("importModal");
}

async function doImport() {
  const text = document.getElementById("importText").value.trim();
  if (!text) return;
  const looksLikeDkf = text.startsWith("*") || /^LAYER:/m.test(text);
  try {
    if (looksLikeDkf) {
      const { project, dropped } = parseDkf(text);
      state.projects[project.id] = project;
      state.currentId = project.id;
      resetHistory();
      await persist();
      renderAll();
      closeModal("importModal");
      toast(`Imported "${project.name}" — ${summarizeDropped(dropped)}`);
    } else {
      await importJsonBackup(text);
      resetHistory();
      renderAll();
      closeModal("importModal");
      toast("Imported");
    }
  } catch (e) {
    toast("Import failed: " + e.message);
  }
}

// =========================================================================
// INITIALIZATION
// =========================================================================
(async () => {
  await init();
  populateIcons();
  initDrawIcon();
  setButtonClickHandler(openEdit);
  setSelectionChangeHandler(renderActionBar);
  setCellDropHandler(moveButton);
  attachExampleClicks();
  renderAll();

  // DXF importer: file picker, drag-drop, search/filter changes
  const dxfFile = document.getElementById("dxfFile");
  const dxfDropZone = document.getElementById("dxfDropZone");
  const dxfPickBtn = document.getElementById("dxfPickBtn");
  if (dxfFile && dxfDropZone) {
    dxfFile.addEventListener("change", (e) => handleDxfFile(e.target.files[0]));
    dxfPickBtn.addEventListener("click", () => dxfFile.click());
    dxfDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dxfDropZone.classList.add("dragover");
    });
    dxfDropZone.addEventListener("dragleave", () => dxfDropZone.classList.remove("dragover"));
    dxfDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dxfDropZone.classList.remove("dragover");
      const f = e.dataTransfer?.files?.[0];
      if (f) handleDxfFile(f);
    });
    document.getElementById("dxfSearch").addEventListener("input", renderDxfLayerList);
    document.getElementById("dxfHideOff").addEventListener("change", renderDxfLayerList);
    document.getElementById("dxfHideEmpty").addEventListener("change", renderDxfLayerList);
  }

  // Project select dropdown
  document.getElementById("projectSelect").addEventListener("change", async (e) => {
    state.currentId = e.target.value;
    resetHistory(); // history is per-project; don't let undo cross projects
    await persist();
    renderAll();
  });

  // Modal background close — skip modals tagged data-keep-on-bg-click (the
  // drawing canvas, which would lose in-progress work on a stray click).
  document.querySelectorAll(".modal-bg").forEach((bg) => {
    if (bg.dataset.keepOnBgClick === "true") return;
    bg.addEventListener("click", (e) => {
      if (e.target === bg) bg.classList.remove("open");
    });
  });

  // Click outside an open popover menu → close it
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.menu-popover[open]").forEach((d) => {
      if (!d.contains(e.target)) d.open = false;
    });
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      cancelSide();
      document.querySelectorAll(".modal-bg.open").forEach((m) => {
        // Draw modal: confirm only if there's ink to lose.
        if (m.id === "drawIconModal" && drawHasInk() && !confirm("Discard the current drawing?")) return;
        // Text-input modals: confirm only if values differ from what we
        // captured when the modal opened.
        if (isModalDirty(m.id) && !confirm("Discard your changes?")) return;
        m.classList.remove("open");
        modalSnapshots.delete(m.id);
      });
      clearSelection();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      const sidePanel = document.getElementById("sidePanel");
      if (sidePanel.classList.contains("open")) saveButton();
    }
    // Undo / redo. Skip if focus is in a text field (let the browser handle
    // its own text undo there). Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z (or
    // Cmd/Ctrl+Y) = redo.
    const inText = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (!inText && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      (e.shiftKey ? doRedo : doUndo)();
    }
    if (!inText && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      doRedo();
    }
    if (
      e.target &&
      e.target.id === "aiPrompt" &&
      (e.metaKey || e.ctrlKey) &&
      e.key === "Enter"
    ) {
      e.preventDefault();
      generateCommand();
    }
  });
})();

// Expose for inline onclick handlers
Object.assign(window, {
  newProject,
  renameProject,
  duplicateProject,
  deleteProject,
  changeGrid,
  applyPreset,
  clearAll,
  openContext,
  saveContext,
  insertContextTemplate,
  saveContextToFile,
  openAutofill,
  doAutofill,
  openExport,
  setExportMode,
  copyExport,
  downloadExport: doDownloadExport,
  openImport,
  doImport,
  openDxfImport,
  dxfSelectAll,
  dxfBlocksSelectAll,
  dxfGenerate,
  openBlockConfig,
  saveBlockConfig,
  resetBlockConfig,
  dxfExportReport,
  toggleTemplate,
  openTemplatePicker,
  closeProjectMenu,
  openGuide,
  saveDrawnIcon,
  cancelDrawnIcon,
  bulkRecolor,
  bulkDelete,
  clearBulkSelection,
  openBulkFindReplace,
  doBulkFindReplace,
  closeModal,
  cancelModal,
  closeSide,
  saveButton,
  clearButton,
  generateCommand,
});
