// js/ui.js
// Pure rendering functions. Reads state, mutates the DOM.
// Side-panel editor state lives in editor.js; this file handles the keypad grid,
// project selector, legend, and status bar.

import { state, curr, COLORS, colorByID, cellOwnerMap, canUndo, canRedo } from "./state.js";
import { lintProject, countWarningsBySeverity } from "./lint.js";
import { icons } from "./icons.js";

let onButtonClick = () => {};
let onSelectionChange = () => {};
let onCellDrop = () => {};

export function setButtonClickHandler(fn) {
  onButtonClick = fn;
}
export function setSelectionChangeHandler(fn) {
  onSelectionChange = fn;
}
export function setCellDropHandler(fn) {
  onCellDrop = fn;
}

// Selection is purely UI state — set of master cell keys "r,c". The "anchor"
// is the most-recently-clicked cell, used as the corner for shift-click range
// selection.
const selection = new Set();
let anchorKey = null;

export function getSelection() { return Array.from(selection); }
export function clearSelection() {
  if (!selection.size) return;
  selection.clear();
  anchorKey = null;
  renderKeypad();
  onSelectionChange();
}
function emitSelection() {
  renderKeypad();
  onSelectionChange();
}

export function renderAll() {
  refreshProjectSelect();
  const p = curr();
  document.getElementById("rowsInput").value = p.rows;
  document.getElementById("colsInput").value = p.cols;
  renderKeypad();
  renderLegend();
  renderStatus();
  renderTemplateButton();
  renderEmptyState();
  renderUndoRedo();
}

function renderUndoRedo() {
  const u = document.getElementById("undoBtn");
  const r = document.getElementById("redoBtn");
  if (u) u.disabled = !canUndo();
  if (r) r.disabled = !canRedo();
}

function renderEmptyState() {
  const banner = document.getElementById("emptyStateBanner");
  if (!banner) return;
  const p = curr();
  const empty = !p || Object.keys(p.buttons || {}).length === 0;
  banner.style.display = empty ? "flex" : "none";
}

function renderTemplateButton() {
  const btn = document.getElementById("templateBtn");
  if (!btn) return;
  const p = curr();
  const on = !!(p && p.isTemplate);
  const icon = on ? icons.starFill() : icons.starOutline();
  btn.innerHTML = `<span class="menu-icon">${icon}</span>${on ? "Unmark as template" : "Mark as template"}`;
  btn.title = on ? "Unmark this project as a template" : "Mark this project as a template";
  btn.classList.toggle("active", on);
}

export function refreshProjectSelect() {
  const sel = document.getElementById("projectSelect");
  sel.innerHTML = "";
  // Templates first (with ★), then everything else, each group alphabetized.
  const projects = Object.values(state.projects);
  const tpl = projects.filter((p) => p.isTemplate).sort((a, b) => a.name.localeCompare(b.name));
  const rest = projects.filter((p) => !p.isTemplate).sort((a, b) => a.name.localeCompare(b.name));
  for (const p of [...tpl, ...rest]) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = (p.isTemplate ? "★ " : "") + p.name;
    if (p.id === state.currentId) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderKeypad() {
  const p = curr();
  const grid = document.getElementById("keypad");
  grid.style.gridTemplateColumns = `repeat(${p.cols}, minmax(72px, 88px))`;
  grid.innerHTML = "";
  const owner = cellOwnerMap(p);
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const key = `${r},${c}`;
      const ownerKey = owner[key];
      // Slave cell of a multi-cell button — master will render with a span,
      // so we skip emitting anything here.
      if (ownerKey && ownerKey !== key) continue;

      const btn = p.buttons[key];
      const el = document.createElement("div");
      el.className = "key" + (btn ? " configured" : " empty") + (btn && btn.header ? " is-header" : "") + (selection.has(key) ? " selected" : "");
      el.dataset.row = r;
      el.dataset.col = c;
      el.style.gridColumn = `${c + 1} / span ${btn ? (btn.width || 1) : 1}`;
      el.style.gridRow = `${r + 1} / span ${btn ? (btn.height || 1) : 1}`;
      if (btn) {
        const col = colorByID(btn.color);
        el.style.background = col.hex + (btn.header ? "44" : "22");
        el.style.borderColor = col.hex + (btn.header ? "aa" : "66");
        const labelText = btn.label || (btn.bitmap ? "" : "(unnamed)");
        let bitmapBadge = "";
        if (btn.bitmap) {
          const customSrc = p.customBitmaps && p.customBitmaps[btn.bitmap];
          if (customSrc) {
            bitmapBadge = `<img class="bitmap-thumb" src="${customSrc}" alt="${escapeHtml(btn.bitmap)}" title="${escapeHtml(btn.bitmap)} (custom)">`;
          } else {
            bitmapBadge = `<span class="bitmap-tag" title="${escapeHtml(btn.bitmap)} — must exist in DAT/EM bitmap folder">${icons.image(11)} ${escapeHtml(btn.bitmap)}</span>`;
          }
        }
        el.innerHTML = `
          <span class="badge" style="background:${col.hex}"></span>
          ${bitmapBadge}
          ${labelText ? `<span class="label">${escapeHtml(labelText)}</span>` : ""}
          <span class="pos">${r + 1},${c + 1}</span>
        `;
        // Hover tooltip: full label (so clamped text is still readable) plus
        // the macro for context. Useful when a long label like "BUILDINGS /
        // OTHER STRUCTURE" is line-clamped in the cell.
        const labelFull = btn.label || "(unnamed)";
        el.title = btn.header
          ? `${labelFull} — section header`
          : (btn.commands ? `${labelFull}\n\n${btn.commands}` : labelFull);
      } else {
        el.innerHTML = `<span class="plus">+</span><span class="pos">${r + 1},${c + 1}</span>`;
      }
      el.addEventListener("click", (e) => onCellClicked(r, c, key, e));
      attachDragHandlers(el, r, c, key, !!btn);
      grid.appendChild(el);
    }
  }
}

// HTML5 drag-and-drop on a single cell. Configured cells are draggable
// sources; every cell is a potential drop target. The actual move logic
// (collision check + state mutation) lives in main.js via onCellDrop.
function attachDragHandlers(el, r, c, key, configured) {
  if (configured) {
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/x-keypad-cell", key);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      document.querySelectorAll(".key.drop-target,.key.drop-invalid").forEach((n) =>
        n.classList.remove("drop-target", "drop-invalid")
      );
    });
  }
  el.addEventListener("dragover", (e) => {
    const types = e.dataTransfer && e.dataTransfer.types;
    if (!types || !Array.from(types).includes("application/x-keypad-cell")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Visual indication only — actual collision check happens on drop.
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", () => {
    el.classList.remove("drop-target", "drop-invalid");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drop-target", "drop-invalid");
    const sourceKey = e.dataTransfer.getData("application/x-keypad-cell");
    if (!sourceKey || sourceKey === key) return;
    onCellDrop(sourceKey, r, c);
  });
}

function onCellClicked(r, c, key, e) {
  // Cmd/Ctrl-click: toggle this cell in/out of selection, don't open editor.
  if (e.metaKey || e.ctrlKey) {
    e.preventDefault();
    if (selection.has(key)) selection.delete(key);
    else { selection.add(key); anchorKey = key; }
    emitSelection();
    return;
  }
  // Shift-click: extend selection to a rectangular range from the anchor.
  if (e.shiftKey && anchorKey) {
    e.preventDefault();
    const [ar, ac] = anchorKey.split(",").map(Number);
    const r0 = Math.min(ar, r), r1 = Math.max(ar, r);
    const c0 = Math.min(ac, c), c1 = Math.max(ac, c);
    const owner = cellOwnerMap(curr());
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const cellKey = `${rr},${cc}`;
        const ok = owner[cellKey];
        // Only select master keys (don't add slave cell coords to the set)
        if (!ok || ok === cellKey) selection.add(cellKey);
      }
    }
    emitSelection();
    return;
  }
  // Regular click: clear any selection and open the editor.
  if (selection.size) {
    selection.clear();
    emitSelection();
  }
  anchorKey = key;
  onButtonClick(r, c);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

function renderLegend() {
  const legend = document.getElementById("legend");
  legend.innerHTML = "";
  for (const c of COLORS) {
    const el = document.createElement("div");
    el.className = "legend-item";
    el.innerHTML = `<span class="legend-dot" style="background:${c.hex}"></span>${c.name}`;
    legend.appendChild(el);
  }
}

function renderStatus() {
  const p = curr();
  const count = Object.keys(p.buttons).length;
  const total = p.rows * p.cols;
  const lint = countWarningsBySeverity(lintProject(p));
  const statusEl = document.getElementById("statusInfo");
  let text = `${count}/${total} buttons configured · ${p.rows}×${p.cols} grid`;
  if (lint.warn || lint.info) {
    const bits = [];
    if (lint.warn) bits.push(`${lint.warn} warning${lint.warn === 1 ? "" : "s"}`);
    if (lint.info) bits.push(`${lint.info} note${lint.info === 1 ? "" : "s"}`);
    text += ` · ${bits.join(", ")}`;
  }
  statusEl.textContent = text;
  statusEl.classList.toggle("has-lint-warn", !!lint.warn);
}

// =========================================================================
// Toast notifications
// =========================================================================
export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

// =========================================================================
// Modal helpers
// =========================================================================
export function openModal(id) {
  document.getElementById(id).classList.add("open");
}
export function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}
