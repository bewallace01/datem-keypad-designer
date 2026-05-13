// js/draw.js
// In-browser 24×24 pixel icon editor. Stores pixel state in a Uint8Array,
// renders to a scaled-up canvas (16× = 384px) with a light grid, and
// returns BMP bytes ready to drop into the project's customBitmaps store.
//
// Public API:
//   initDrawIcon()       — wires up the modal once on page load
//   openDrawIcon(prefill) — open the modal, optionally pre-fill from an existing 24×24 BMP dataURL
//   getDrawIconResult()  — return current pixels as { bmpBytes, bmpDataUrl }

import { encodeBmp, bytesToDataUrl } from "./bmp.js";
import { generateIconSvg } from "./ai.js";
import { populateIcons } from "./icons.js";

const SIZE = 24;
const PX = 16;            // on-screen pixels per icon pixel
const COLORS = { ink: "#0d1014", paper: "#f5f5f5", grid: "#dadce3" };

const state = {
  pixels: new Uint8Array(SIZE * SIZE), // 0 = paper (white), 1 = ink (black)
  tool: "pencil",
  drawing: false,
};

function clearGrid() {
  const ctx = canvas().getContext("2d");
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, SIZE * PX, SIZE * PX);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= SIZE; i++) {
    ctx.moveTo(i * PX + 0.5, 0); ctx.lineTo(i * PX + 0.5, SIZE * PX);
    ctx.moveTo(0, i * PX + 0.5); ctx.lineTo(SIZE * PX, i * PX + 0.5);
  }
  ctx.stroke();
}

function paintCell(px, py) {
  const ctx = canvas().getContext("2d");
  ctx.fillStyle = state.pixels[py * SIZE + px] ? COLORS.ink : COLORS.paper;
  ctx.fillRect(px * PX + 1, py * PX + 1, PX - 1, PX - 1);
}

function redrawAll() {
  clearGrid();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) paintCell(x, y);
  }
  updatePreview();
}

function setPixel(px, py) {
  if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) return;
  const want = state.tool === "pencil" ? 1 : 0;
  if (state.pixels[py * SIZE + px] === want) return;
  state.pixels[py * SIZE + px] = want;
  paintCell(px, py);
  updatePreview();
}

function canvas() { return document.getElementById("drawCanvas"); }

function updatePreview() {
  const tile = document.getElementById("drawPreviewTile");
  if (!tile) return;
  const { bmpDataUrl } = getResult();
  tile.innerHTML = `<img src="${bmpDataUrl}" alt="preview">`;
  tile.style.display = "inline-flex";
}

function setTool(tool) {
  state.tool = tool;
  document.getElementById("drawPencilBtn").classList.toggle("primary", tool === "pencil");
  document.getElementById("drawEraserBtn").classList.toggle("primary", tool === "eraser");
}

function clearAll() {
  state.pixels.fill(0);
  redrawAll();
}

// Convert pixels → 24-bit BMP. Build raw RGBA in row-major top-down order
// (which is what canvas.getImageData gives us); encodeBmp flips for the
// bottom-up BMP layout.
export function hasInk() {
  for (let i = 0; i < state.pixels.length; i++) if (state.pixels[i]) return true;
  return false;
}

export function getResult() {
  // Build top-down RGBA (encodeBmp handles the bottom-up flip). Ink = pure
  // black, paper = pure white — the on-screen grays from the editor are just
  // for visual contrast; the saved BMP uses real B/W.
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const on = state.pixels[i];
    const v = on ? 0 : 255;
    const k = i * 4;
    rgba[k] = v; rgba[k + 1] = v; rgba[k + 2] = v; rgba[k + 3] = 255;
  }
  const bmpBytes = encodeBmp(rgba, SIZE, SIZE);
  return { bmpBytes, bmpDataUrl: bytesToDataUrl(bmpBytes) };
}

// Rasterize an SVG string onto our 24×24 grid and threshold to B/W. Used by
// the AI generation flow — Claude returns SVG, we paint it at icon scale,
// the user can then refine pixel-by-pixel before saving.
export function loadFromSvg(svgString) {
  return new Promise((resolve, reject) => {
    // Normalize: when an SVG is loaded via Image() it must carry the xmlns
    // attribute (it's optional in inline HTML, so Claude often omits it).
    // Also replace `currentColor` with explicit black since there's no
    // color context when the SVG is rendered standalone.
    let svg = svgString.trim();
    if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg/.test(svg)) {
      svg = svg.replace(/^<svg(\s|>)/i, '<svg xmlns="http://www.w3.org/2000/svg"$1');
    }
    svg = svg.replace(/currentColor/g, "#000");
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        // Render at 4× the target size so we have 16 sub-pixels per icon pixel.
        // Then for each icon pixel, count how many sub-pixels are truly dark
        // (luminance < 96, alpha-blended). This "majority dark" downsample
        // gives cleaner pixel-art than linear-filter thresholding — anti-
        // aliased edges of a thin stroke no longer all collapse to ink.
        const HI = 4;
        const W = SIZE * HI;
        const c = document.createElement("canvas");
        c.width = W; c.height = W;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W, W);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, W, W);
        const data = ctx.getImageData(0, 0, W, W).data;

        const DARK_LUM = 80;
        const VOTES_TO_INK = 7; // out of HI*HI = 16
        for (let py = 0; py < SIZE; py++) {
          for (let px = 0; px < SIZE; px++) {
            let votes = 0;
            for (let dy = 0; dy < HI; dy++) {
              for (let dx = 0; dx < HI; dx++) {
                const ix = ((py * HI + dy) * W + (px * HI + dx)) * 4;
                const r = data[ix], g = data[ix + 1], b = data[ix + 2], a = data[ix + 3];
                const lum = ((r + g + b) / 3) * (a / 255) + 255 * (1 - a / 255);
                if (lum < DARK_LUM) votes++;
              }
            }
            state.pixels[py * SIZE + px] = votes >= VOTES_TO_INK ? 1 : 0;
          }
        }
        URL.revokeObjectURL(url);
        redrawAll();
        resolve();
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't rasterize SVG"));
    };
    img.src = url;
  });
}

export function loadFromBmpDataUrl(dataUrl) {
  // Decode via an HTMLImageElement → tiny canvas, read pixels back into state.
  return new Promise((resolve) => {
    if (!dataUrl) { state.pixels.fill(0); resolve(); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = SIZE; c.height = SIZE;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
      for (let i = 0; i < SIZE * SIZE; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        // anything darker than mid-gray becomes ink
        state.pixels[i] = (r + g + b) / 3 < 128 ? 1 : 0;
      }
      resolve();
    };
    img.onerror = () => { state.pixels.fill(0); resolve(); };
    img.src = dataUrl;
  });
}

function pointerToCell(evt) {
  const rect = canvas().getBoundingClientRect();
  const x = Math.floor(((evt.clientX - rect.left) / rect.width) * SIZE);
  const y = Math.floor(((evt.clientY - rect.top) / rect.height) * SIZE);
  return [x, y];
}

let initialized = false;

export function initDrawIcon() {
  if (initialized) return;
  initialized = true;
  const c = canvas();
  c.addEventListener("mousedown", (e) => { state.drawing = true; const [x, y] = pointerToCell(e); setPixel(x, y); });
  c.addEventListener("mousemove", (e) => { if (state.drawing) { const [x, y] = pointerToCell(e); setPixel(x, y); } });
  window.addEventListener("mouseup", () => { state.drawing = false; });
  // Touch
  c.addEventListener("touchstart", (e) => { e.preventDefault(); state.drawing = true; const t = e.touches[0]; const [x, y] = pointerToCell(t); setPixel(x, y); }, { passive: false });
  c.addEventListener("touchmove", (e) => { e.preventDefault(); if (!state.drawing) return; const t = e.touches[0]; const [x, y] = pointerToCell(t); setPixel(x, y); }, { passive: false });
  c.addEventListener("touchend", () => { state.drawing = false; });
  document.getElementById("drawPencilBtn").addEventListener("click", () => setTool("pencil"));
  document.getElementById("drawEraserBtn").addEventListener("click", () => setTool("eraser"));
  document.getElementById("drawClearBtn").addEventListener("click", () => { if (confirm("Clear the canvas?")) clearAll(); });
  // AI generate
  const aiBtn = document.getElementById("drawAiBtn");
  const aiPrompt = document.getElementById("drawAiPrompt");
  const aiStatus = document.getElementById("drawAiStatus");
  populateIcons(document.getElementById("drawIconModal"));
  const runAi = async () => {
    const desc = aiPrompt.value.trim();
    if (!desc) { aiStatus.textContent = "Describe an icon first."; aiStatus.className = "ai-status"; return; }
    aiBtn.disabled = true;
    const orig = aiBtn.innerHTML;
    aiBtn.innerHTML = '<span class="spinner"></span>Thinking…';
    aiStatus.textContent = "";
    aiStatus.className = "ai-status";
    try {
      const svg = await generateIconSvg(desc);
      await loadFromSvg(svg);
      aiStatus.textContent = "✓ Generated. Refine with the pencil/eraser if needed, then Save.";
      aiStatus.className = "ai-status success";
    } catch (e) {
      aiStatus.textContent = "Generation failed: " + e.message;
      aiStatus.className = "ai-status error";
    } finally {
      aiBtn.disabled = false;
      aiBtn.innerHTML = orig;
    }
  };
  aiBtn.addEventListener("click", runAi);
  aiPrompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); runAi(); }
  });
}

export async function openDrawIcon({ prefillDataUrl, suggestedFilename } = {}) {
  await loadFromBmpDataUrl(prefillDataUrl);
  setTool("pencil");
  document.getElementById("drawFilename").value = suggestedFilename || "";
  redrawAll();
}
