// js/export.js
// Reference text export, JSON backup export, and JSON import.

import { COLORS, curr, state, newId, persist } from "./state.js";

export function buildTextExport() {
  const p = curr();
  const lines = [];
  lines.push(`KEYPAD CONFIG: ${p.name}`);
  lines.push(`Grid: ${p.rows} rows × ${p.cols} cols`);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push("".padEnd(72, "="));
  lines.push("");

  if (p.context && p.context.trim()) {
    lines.push("PROJECT CONTEXT");
    lines.push("".padEnd(72, "-"));
    lines.push(p.context.trim());
    lines.push("");
    lines.push("".padEnd(72, "="));
    lines.push("");
  }

  // Group by color category
  const byColor = {};
  for (const [key, btn] of Object.entries(p.buttons)) {
    const cid = btn.color || "neutral";
    (byColor[cid] = byColor[cid] || []).push({ key, btn });
  }
  for (const cat of COLORS) {
    const items = byColor[cat.id];
    if (!items || !items.length) continue;
    lines.push(`── ${cat.name.toUpperCase()} ──`);
    items.sort((a, b) =>
      a.key.localeCompare(b.key, undefined, { numeric: true })
    );
    for (const { key, btn } of items) {
      const [r, c] = key.split(",").map(Number);
      lines.push(`[${r + 1},${c + 1}] ${btn.label}`);
      const cmds = (btn.commands || "").split("\n").filter((s) => s.length);
      cmds.forEach((cmd) => lines.push(`    ${cmd}`));
      if (btn.notes) lines.push(`    # ${btn.notes}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function buildJsonExport() {
  return JSON.stringify(curr(), null, 2);
}

export async function importJsonBackup(text) {
  const obj = JSON.parse(text);
  if (!obj.buttons || typeof obj.rows !== "number") {
    throw new Error("Doesn't look like a valid backup");
  }
  const id = newId();
  obj.id = id;
  obj.name = (obj.name || "Imported") + " (imported)";
  state.projects[id] = obj;
  state.currentId = id;
  await persist();
  return obj;
}

export function downloadFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function safeFileName(name) {
  return name.replace(/[^a-z0-9]+/gi, "_");
}
