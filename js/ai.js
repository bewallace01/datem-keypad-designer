// js/ai.js
// Anthropic API calls for both single-button generation and bulk auto-fill.
// Works in two modes:
//   - Artifact mode (Claude.ai): runtime handles auth, just fetch directly
//   - Standalone mode: user provides API key, we add headers for direct browser access

import { isArtifactMode, getApiKey, setApiKey } from "./storage.js";
import { SINGLE_BUTTON_PROMPT, BULK_AUTOFILL_PROMPT, LAYER_EXTRACTION_PROMPT } from "./prompts.js";

const MODEL = "claude-sonnet-4-20250514";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

async function ensureApiKey() {
  if (isArtifactMode) return null; // not needed
  let key = getApiKey();
  if (!key) {
    key = prompt(
      "Anthropic API key required for AI generation.\n\n" +
        "Get one at https://console.anthropic.com\n\n" +
        "It's stored only in your browser's localStorage and sent only to api.anthropic.com."
    );
    if (key) {
      key = key.trim();
      setApiKey(key);
    }
  }
  if (!key) throw new Error("API key required");
  return key;
}

async function callAnthropic(system, userContent, maxTokens = 1000) {
  const key = await ensureApiKey();

  const headers = { "Content-Type": "application/json" };
  if (!isArtifactMode) {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    if (response.status === 401 && !isArtifactMode) {
      // Bad API key - clear and re-prompt
      setApiKey(null);
    }
    throw new Error(`API ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "API error");

  let text = data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  // Strip markdown fences if present
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  return text;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Strip markdown fences / prose around the object.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    // Truncation recovery: max-tokens cutoff often leaves a partial last
    // array element. Slice off everything after the last complete `}` we
    // find inside the outer object, then close any still-open `[` and `{`
    // brackets. Good enough to salvage 99% of a long response.
    const start = text.indexOf("{");
    if (start >= 0) {
      let s = text.slice(start);
      const lastComplete = s.lastIndexOf("}");
      if (lastComplete > 0) {
        let head = s.slice(0, lastComplete + 1);
        const opens = (head.match(/\[/g) || []).length;
        const closes = (head.match(/\]/g) || []).length;
        head += "]".repeat(Math.max(0, opens - closes));
        const objOpens = (head.match(/\{/g) || []).length;
        const objCloses = (head.match(/\}/g) || []).length;
        head += "}".repeat(Math.max(0, objOpens - objCloses));
        try { return JSON.parse(head); } catch {}
      }
    }
    throw new Error("Could not parse response as JSON");
  }
}

// =========================================================================
// Layer descriptions (for the CAD-import layer report)
//
// Given a batch of layer names, returns a map of name → one-sentence
// description. Layer names that follow AIA/NCS convention (V-ROAD-PAVE etc.)
// are highly inferable from the name alone — the AI mostly applies the
// convention plus photogrammetry domain knowledge.
// =========================================================================
const LAYER_DESCRIPTION_PROMPT = `You are a domain expert in aerial photogrammetry stereo compilation, civil/survey CAD, and AIA/NCS layer-naming conventions.

Given a list of AutoCAD/MicroStation layer names from a working drawing, return a one-sentence description per layer explaining what feature class or content it represents. Use the AIA/NCS convention where applicable:
- First letter is the discipline (V = existing vector/survey features, C = civil design, L = landscape, A = architectural, M = mechanical, P = plumbing, S = structural, E = electrical, T = telecom, F = fire, G = general, X = xref)
- Subsequent dash-delimited tokens narrow the feature class (e.g. V-ROAD-PAVE = existing road pavement edges; V-UTIL-POWR-POLE = existing utility power pole; V-TOPO-BRKL = existing topographic breakline; V-BLDG-OTLN = existing building outline)

Description requirements:
- One short sentence, 15 words or less
- Plain English a non-CAD operator could understand
- Specific to the actual layer name, not generic
- Distinguish "design" (C-*) from "existing/survey" (V-*) when present
- For non-standard prefixes or one-off layer names, give your best inference

OUTPUT FORMAT: Respond with ONLY a JSON object mapping each layer name verbatim to its description string. No markdown fences, no commentary.

Example output:
{
  "V-ROAD-PAVE": "Existing road pavement edge collected from stereo imagery.",
  "C-ESMT": "Civil-design easement boundaries proposed for the project."
}`;

// =========================================================================
// Icon generation (Claude → SVG → 24×24 BMP)
//
// Claude doesn't generate raster images directly, but it's quite good at
// writing small, deterministic SVG markup. We ask for a 24-viewbox SVG using
// only black on white; the caller rasterizes it onto a 24×24 canvas, then
// thresholds to B/W for DAT/EM's 24-bit BMP format.
// =========================================================================
const ICON_SVG_PROMPT = `You design tiny 24×24 pixel monochrome icons for a CAD/photogrammetry keypad. The icon will be rasterized at 24×24 and rendered as a black-on-white BMP, so:

CONSTRAINTS
- Output ONLY valid SVG markup. No explanation, no markdown fences, no extra whitespace before/after.
- The <svg> root MUST include both \`xmlns="http://www.w3.org/2000/svg"\` and \`viewBox="0 0 24 24"\`. Omit width/height attributes.
- Use only black: \`#000\` or \`black\`. DO NOT use \`currentColor\` — the SVG is rendered standalone with no parent color context.
- Strokes must be thick enough to read at 24×24. Use \`stroke-width="2"\` minimum.
- Use \`stroke-linecap="round" stroke-linejoin="round"\` so corners don't disappear.
- No gradients, no opacity, no patterns, no filters.

STYLE — CRITICAL
- The icon should read as a **stylized symbol**, NOT a literal silhouette. Think road signs and topographic map symbols, not photographs.
- Use generous WHITESPACE. The 24×24 grid means anything denser than ~2-3 pixels of ink in a row will become an unreadable solid blob.
- Compose with strokes (lines, circles, polygons with stroke + no fill) over filled solids. Filled shapes are fine for small accents like dots or single chunky symbols.
- For things that look like a row or pattern of objects (treeline, fence, contour, hatch): use 2-3 distinct, **clearly separated** elements with visible gaps between them, NOT a continuous filled silhouette.
- DO NOT add a ground line, baseline, horizon line, frame, or border around the icon. Elements float on white. A ground line at the bottom of the viewBox makes everything read as a single connected mass at 24×24.
- For multi-object icons (treeline = several trees), there must be at least 2 fully-white pixel-columns of gap visible BETWEEN each object at 24×24 — don't let trunks/bases touch.
- Center the icon in the viewBox with at least 2-pixel margin (don't fill edge-to-edge).

GOOD EXAMPLES — these are the visual target, even when the user asks for something different:
- Building: stroked rectangle outline with one small filled square inside
- Tree (single): triangle outline on a short rectangular trunk, NOT a solid blob
- Treeline: 2-3 separate small triangles in a row with visible gaps, baseline below them
- Fence: 3 vertical short strokes with 2 horizontal rails between them
- Breakline: single thick zigzag line, stroke-width 3, NO fill
- Spot elevation: small filled circle inside a crosshair (small + symbol with the dot in the middle)
- Building outline: 5-6 sided stroked polygon, no fill
- Power pole: vertical line with a horizontal crossbar near the top

USER REQUEST: `;

export async function generateIconSvg(description) {
  if (!description || !description.trim()) throw new Error("Describe the icon first");
  const text = await callAnthropic(ICON_SVG_PROMPT, description.trim(), 1500);
  // Strip any accidental markdown fences (the system prompt forbids them but
  // be defensive — the format is so important here that one stray ``` would
  // break rasterization).
  let svg = text.replace(/^```(?:svg|xml|html)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  // Pull out just the <svg>...</svg> in case there's trailing prose.
  const m = svg.match(/<svg[\s\S]*?<\/svg>/i);
  if (m) svg = m[0];
  if (!/^<svg[\s>]/i.test(svg)) throw new Error("AI didn't return SVG");
  return svg;
}

export async function describeLayers(layerNames) {
  if (!layerNames.length) return {};
  const list = layerNames.map((n) => `- ${n}`).join("\n");
  const userContent = `Layer names to describe (return JSON keyed by these exact strings):\n\n${list}`;
  // Output: ~30 tokens per layer description. Budget generously.
  const maxTokens = Math.min(16000, 200 + layerNames.length * 50);
  const text = await callAnthropic(LAYER_DESCRIPTION_PROMPT, userContent, maxTokens);
  return parseJson(text);
}

// =========================================================================
// Single-button generation
// =========================================================================
export async function generateButton(description, projectContext = "") {
  if (!description.trim()) throw new Error("Description is empty");

  let userContent = description;
  if (projectContext.trim()) {
    userContent =
      `PROJECT CONTEXT (use these conventions, layer names, and feature codes):\n${projectContext}\n\n` +
      `BUTTON DESCRIPTION:\n${description}`;
  }

  const text = await callAnthropic(SINGLE_BUTTON_PROMPT, userContent, 1000);
  const result = parseJson(text);

  return {
    label: result.label || "",
    color: result.color || "neutral",
    commands: result.commands || "",
    notes: result.notes || "",
  };
}

// =========================================================================
// Bulk auto-fill
// =========================================================================
export async function generateLayout({
  rows,
  cols,
  projectContext,
  fillMode,
  occupiedCells,
  extraInstructions,
}) {
  let userContent = `GRID SIZE: ${rows} rows × ${cols} cols\n\n`;

  if (projectContext.trim()) {
    userContent += `PROJECT CONTEXT (use these exact layer/feature names):\n${projectContext}\n\n`;
  } else {
    userContent +=
      `PROJECT CONTEXT: None provided. Use sensible defaults (BLDG, ROAD_EOP, ROAD_CL, CURB, DRIVE, FENCE, HYDRO_EDGE, VEG, BREAKLINE, SPOT, OBSCURE).\n\n`;
  }

  if (fillMode === "empty" && occupiedCells.length > 0) {
    userContent +=
      `EXISTING BUTTONS (do NOT generate buttons for these positions):\n` +
      occupiedCells
        .map((k) => `  Row ${k.split(",")[0]}, Col ${k.split(",")[1]}`)
        .join("\n") +
      `\n\n`;
  }

  if (extraInstructions.trim()) {
    userContent += `ADDITIONAL INSTRUCTIONS:\n${extraInstructions}\n\n`;
  }

  userContent += `Design the complete layout now.`;

  const text = await callAnthropic(BULK_AUTOFILL_PROMPT, userContent, 8000);
  const result = parseJson(text);

  if (!result.buttons || !Array.isArray(result.buttons)) {
    throw new Error("Response missing buttons array");
  }

  return result.buttons;
}

// =========================================================================
// Layer extraction — PDF text only (keypad reconciliation happens client-
// side after the call, NOT inside the prompt). Feeding the keypad list to
// Claude biased it toward tagging every layer "both"; removing it forces
// the model to actually mine layer names out of the PDF text.
// =========================================================================
export async function extractLayersFromPdf({ pdfText, projectContext }) {
  let userContent = "";
  if (projectContext && projectContext.trim()) {
    userContent += `PROJECT CONTEXT:\n${projectContext.trim()}\n\n`;
  }
  userContent +=
    `PDF CONTENT (extracted text, may be a table or free narrative):\n` +
    // 180k characters ~ 45k tokens. Sonnet handles 200k+ tokens of input
    // easily; this leaves headroom for the prompt + the 16k output
    // budget. Generous enough to cover 100+ page project spec PDFs.
    (pdfText ? pdfText.slice(0, 180000) : "(no PDF provided)");

  // 16k tokens — large project spec PDFs can produce 100+ layers, each
  // emitting a ~50-byte JSON object. The parseJson() recovery pass still
  // catches us if Claude runs past even this.
  const text = await callAnthropic(LAYER_EXTRACTION_PROMPT, userContent, 16000);
  const result = parseJson(text);
  if (!result.layers || !Array.isArray(result.layers)) {
    throw new Error("Response missing layers array");
  }
  return result.layers;
}
