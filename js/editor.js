// js/editor.js
// Side-panel button editor: open/close, save, clear, and AI generation per-button.

import { COLORS, curr, persist, cellOwnerMap, recordChange } from "./state.js";
import { renderAll, toast, openModal } from "./ui.js";
import { generateButton } from "./ai.js";
import { lintMacro } from "./lint.js";
import { fileToBmp, bytesToDataUrl, makeBitmapName } from "./bmp.js";
import { openDrawIcon } from "./draw.js";

let editing = null; // { row, col }
let openSnapshot = null;

function captureEditorSnapshot() {
  return {
    label: document.getElementById("fLabel").value,
    commands: document.getElementById("fCommands").value,
    notes: document.getElementById("fNotes").value,
    bitmap: document.getElementById("fBitmap").value,
    header: document.getElementById("fHeader").checked,
    width: document.getElementById("fWidth").value,
    height: document.getElementById("fHeight").value,
    color: (document.querySelector("#colorRow .swatch.selected") || {}).dataset?.color || "",
  };
}

function isEditorDirty() {
  if (!openSnapshot || !editing) return false;
  const now = captureEditorSnapshot();
  for (const k in now) if (now[k] !== openSnapshot[k]) return true;
  return false;
}

export function openEdit(row, col) {
  // If we have unsaved edits open on another cell, warn before swapping.
  if (isEditorDirty() && !confirm("Discard your changes to the current button?")) return;
  editing = { row, col };
  const p = curr();
  const btn =
    p.buttons[`${row},${col}`] || {
      label: "",
      color: "neutral",
      commands: "",
      notes: "",
    };
  document.getElementById("sideTitle").textContent =
    btn.label || `Button ${row + 1},${col + 1}`;
  document.getElementById("sidePos").textContent = `Row ${row + 1}, Col ${col + 1}`;
  document.getElementById("fLabel").value = btn.label || "";
  document.getElementById("fCommands").value = btn.commands || "";
  document.getElementById("fNotes").value = btn.notes || "";
  document.getElementById("fHeader").checked = !!btn.header;
  document.getElementById("fWidth").value = btn.width || 1;
  document.getElementById("fHeight").value = btn.height || 1;
  document.getElementById("fBitmap").value = btn.bitmap || "";
  renderColorRow(btn.color);
  renderBitmapPreview();
  renderLint();

  // Reset AI section
  document.getElementById("aiPrompt").value = "";
  const aiStatus = document.getElementById("aiStatus");
  aiStatus.textContent = "";
  aiStatus.className = "ai-status";

  document.getElementById("sidePanel").classList.add("open");
  openSnapshot = captureEditorSnapshot();
}

export function closeSide() {
  document.getElementById("sidePanel").classList.remove("open");
  editing = null;
  openSnapshot = null;
}

// Close attempt that respects unsaved changes — used by ESC.
export function cancelSide() {
  if (isEditorDirty() && !confirm("Discard your changes to this button?")) return;
  closeSide();
}

function renderBitmapPreview() {
  const tile = document.getElementById("fBitmapPreview");
  const status = document.getElementById("fBitmapStatus");
  if (!tile) return;
  const name = document.getElementById("fBitmap").value.trim();
  if (!name) {
    tile.style.display = "none";
    tile.innerHTML = "";
    status.textContent = "";
    return;
  }
  const p = curr();
  const dataUrl = p && p.customBitmaps && p.customBitmaps[name];
  if (dataUrl) {
    tile.style.display = "inline-flex";
    tile.innerHTML = `<img src="${dataUrl}" alt="${name}">`;
    status.textContent = "Custom bitmap — exported in the ZIP";
  } else {
    tile.style.display = "none";
    tile.innerHTML = "";
    status.textContent = "Built-in DAT/EM bitmap — must already exist on the keypad PC";
  }
}

function renderLint() {
  const el = document.getElementById("lintList");
  if (!el) return;
  const cmds = document.getElementById("fCommands").value;
  const isHeader = document.getElementById("fHeader").checked;
  const warnings = lintMacro(cmds, { isHeader });
  if (!warnings.length) { el.innerHTML = ""; el.style.display = "none"; return; }
  el.style.display = "block";
  el.innerHTML = warnings.map((w) =>
    `<div class="lint-item lint-${w.level}"><span class="lint-icon">${w.level === "warn" ? "⚠" : "ⓘ"}</span><span>${escapeForHtml(w.msg)}</span></div>`
  ).join("");
}

function escapeForHtml(s) {
  return String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
}

function renderColorRow(selectedId) {
  const row = document.getElementById("colorRow");
  row.innerHTML = "";
  for (const c of COLORS) {
    const el = document.createElement("div");
    el.className = "swatch" + (c.id === selectedId ? " selected" : "");
    el.style.background = c.hex;
    el.title = c.name;
    el.dataset.color = c.id;
    el.addEventListener("click", () => {
      row.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
      el.classList.add("selected");
    });
    row.appendChild(el);
  }
}

export async function saveButton() {
  if (!editing) return;
  const p = curr();
  const key = `${editing.row},${editing.col}`;
  const label = document.getElementById("fLabel").value.trim();
  const commands = document.getElementById("fCommands").value;
  const notes = document.getElementById("fNotes").value;
  const colorEl = document.querySelector("#colorRow .swatch.selected");
  const color = colorEl ? colorEl.dataset.color : "neutral";
  const header = document.getElementById("fHeader").checked;
  const width = Math.max(1, parseInt(document.getElementById("fWidth").value, 10) || 1);
  const height = Math.max(1, parseInt(document.getElementById("fHeight").value, 10) || 1);
  const bitmap = document.getElementById("fBitmap").value.trim();

  if (editing.row + height > p.rows || editing.col + width > p.cols) {
    toast("Span goes off the grid — shrink width/height or grow the grid first");
    return;
  }
  // Collision check: build an ownership map of all *other* buttons. If any
  // cell in our new span is already claimed, reject so we don't silently
  // clobber a neighbor.
  const otherButtons = { ...p.buttons };
  delete otherButtons[key];
  const owner = cellOwnerMap({ buttons: otherButtons });
  for (let dr = 0; dr < height; dr++) {
    for (let dc = 0; dc < width; dc++) {
      const cell = `${editing.row + dr},${editing.col + dc}`;
      if (owner[cell]) {
        toast(`Span collides with another button at ${editing.row + dr + 1},${editing.col + dc + 1}`);
        return;
      }
    }
  }

  recordChange();
  if (!label && !commands.trim() && !header && !bitmap) {
    delete p.buttons[key];
  } else {
    p.buttons[key] = {
      label,
      color,
      commands,
      notes,
      ...(header ? { header: true } : {}),
      ...(width > 1 ? { width } : {}),
      ...(height > 1 ? { height } : {}),
      ...(bitmap ? { bitmap } : {}),
    };
  }
  await persist();
  renderAll();
  closeSide();
  toast("Saved");
}

export async function clearButton() {
  if (!editing) return;
  recordChange();
  const p = curr();
  const key = `${editing.row},${editing.col}`;
  delete p.buttons[key];
  await persist();
  renderAll();
  closeSide();
  toast("Button cleared");
}

// =========================================================================
// AI generation
// =========================================================================
export async function generateCommand() {
  const description = document.getElementById("aiPrompt").value.trim();
  if (!description) {
    toast("Type a description first");
    document.getElementById("aiPrompt").focus();
    return;
  }

  const btn = document.getElementById("aiBtn");
  const status = document.getElementById("aiStatus");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Thinking...';
  status.textContent = "";
  status.className = "ai-status";

  try {
    const projectContext = curr().context || "";
    const result = await generateButton(description, projectContext);

    if (result.label) document.getElementById("fLabel").value = result.label;
    if (result.commands) document.getElementById("fCommands").value = result.commands;
    if (result.notes) document.getElementById("fNotes").value = result.notes;
    const validColors = COLORS.map((c) => c.id);
    const color = validColors.includes(result.color) ? result.color : "neutral";
    renderColorRow(color);

    const ctxNote = projectContext.trim() ? " (using project context)" : "";
    status.textContent = `✓ Generated${ctxNote}. Review the fields below and click Save.`;
    status.className = "ai-status success";
  } catch (e) {
    console.error(e);
    status.textContent = "Generation failed: " + e.message;
    status.className = "ai-status error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate";
  }
}

// =========================================================================
// Insert example commands and chip handling
// =========================================================================
export function attachExampleClicks() {
  // Live-relint the editor on changes to the macro or header flag.
  document.getElementById("fCommands").addEventListener("input", renderLint);
  document.getElementById("fHeader").addEventListener("change", renderLint);
  // Bitmap upload + preview wiring.
  document.getElementById("fBitmap").addEventListener("input", renderBitmapPreview);
  document.getElementById("fBitmapUploadBtn").addEventListener("click", () => {
    document.getElementById("fBitmapUpload").click();
  });
  document.getElementById("fBitmapDrawBtn").addEventListener("click", async () => {
    const p = curr();
    const name = document.getElementById("fBitmap").value.trim();
    const existing = name && p.customBitmaps && p.customBitmaps[name] ? p.customBitmaps[name] : null;
    const suggested = name && existing ? name : makeBitmapName("icon", (p.customBitmaps || {}));
    openModal("drawIconModal");
    await openDrawIcon({ prefillDataUrl: existing, suggestedFilename: suggested });
  });
  document.getElementById("fBitmapUpload").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const status = document.getElementById("fBitmapStatus");
    status.textContent = "Converting…";
    try {
      const bmpBytes = await fileToBmp(file);
      const dataUrl = bytesToDataUrl(bmpBytes);
      const p = curr();
      if (!p.customBitmaps) p.customBitmaps = {};
      const name = makeBitmapName(file.name, p.customBitmaps);
      p.customBitmaps[name] = dataUrl;
      document.getElementById("fBitmap").value = name;
      status.textContent = `✓ Stored as ${name} (24×24 BMP)`;
      renderBitmapPreview();
      // Reset the file input so re-uploading the same file fires `change`.
      e.target.value = "";
    } catch (err) {
      status.textContent = "Conversion failed: " + err.message;
    }
  });

  document.addEventListener("click", (e) => {
    const ex = e.target.closest(".ex-item");
    if (ex) {
      const cmdText = ex.firstChild.textContent;
      const ta = document.getElementById("fCommands");
      const cur = ta.value;
      ta.value = cur ? cur + (cur.endsWith("\n") ? "" : "\n") + cmdText : cmdText;
      ta.focus();
    }

    const chip = e.target.closest(".ai-chip");
    if (chip) {
      document.getElementById("aiPrompt").value = chip.textContent;
      document.getElementById("aiPrompt").focus();
    }
  });
}
