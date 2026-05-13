// js/lint.js
// Static analysis of a button macro. Returns an array of warnings, each
// { level: "warn" | "info", msg }.
//
// Rule design philosophy: only fire when a problem is genuinely likely.
// False positives are annoying because users ignore them, which hides real
// issues. When in doubt, "info" (advisory) over "warn" (will probably break).

const SUMMIT_KEYWORDS = new Set([
  "Driver", "ZoomIn", "ZoomOut", "RaiseZ", "LowerZ", "StereoToggle",
  "NextStereoPair", "PreviousStereoPair", "ModelExtents", "AutoLevel",
  "Cursor3D", "Recenter", "ZLock", "ZUnlock", "StripMode",
]);

const CAPTURE_COMMANDS_REQUIRING_CAPTURE = [
  "AUTOARC3D", "AUTOARC2D", "PSQR", "PSQR2D", "PSQR3D", "Autoarc", "Bspline", "Breakline",
  "Breaklinefilter", "place cell", "place lstring", "Phototext", "Passpoint",
  "Vert", "Cpline", "Cutline", "datem", "psqr", "spotx", "spotinterp",
  "tentative", "Bktrack", "gridit", "labelit", "mapstring", "Road settings",
  "datpan", "EXPORT=DXF", "selectionset", "BKL", "indep", "Increment",
  "HV", "Joinit", "Phototex", "RaiseZ ", "snap",
];

const CAD_LIKE_LINE = /^[\^A-Za-z_'-]/;

export function lintMacro(commands, opts = {}) {
  const warnings = [];
  const text = (commands || "").trim();

  if (!text) {
    if (!opts.isHeader) {
      warnings.push({ level: "info", msg: "Empty macro — button does nothing when pressed." });
    }
    return warnings;
  }

  const lines = text.split("\n").map((l) => l.trim());

  // R1: `-LAYER;S;NAME` should end with `;;` to exit the LAYER command.
  //     We allow a chained command after, in which case the `;;` exits LAYER
  //     before the next command.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/-LAYER;[A-Za-z]+;[\w-]+/);
    if (m && !/-LAYER;[A-Za-z]+;[\w-]+;;/.test(lines[i])) {
      warnings.push({
        level: "warn",
        msg: `Line ${i + 1}: \`-LAYER;...\` is missing trailing \`;;\` — the LAYER command will stay open and eat your next inputs.`,
      });
    }
  }

  // R2: `LAYER` (no dash) on its own pops the dialog mid-digitizing. Skip
  //     "CLAYER", "-LAYER", or other longer matches.
  for (let i = 0; i < lines.length; i++) {
    if (/(^|[^-A-Z])LAYER\b/i.test(lines[i]) && !/-LAYER/i.test(lines[i]) && !/CLAYER/i.test(lines[i])) {
      warnings.push({
        level: "warn",
        msg: `Line ${i + 1}: use \`-LAYER\` (with the dash) — bare \`LAYER\` pops the layer dialog and breaks the active drawing command.`,
      });
    }
  }

  // R3: Advisory — first line of an AutoCAD command typically needs `^C^C`.
  //     Skip Summit keywords (they're not AutoCAD), Capture CallCmd, and
  //     transparent (`'`) commands.
  const first = lines[0];
  if (first) {
    const isSummit = SUMMIT_KEYWORDS.has(first);
    const isCallCmd = first.startsWith("CallCmd");
    const isTransparent = first.startsWith("'");
    const hasCancel = first.startsWith("^C^C");
    const looksCAD = CAD_LIKE_LINE.test(first);
    if (looksCAD && !isSummit && !isCallCmd && !isTransparent && !hasCancel) {
      warnings.push({
        level: "info",
        msg: "Consider prefixing the first command with `^C^C` to cancel any running command before this one starts.",
      });
    }
  }

  // R4: Summit keyword that's likely misspelled (case). If the line is a
  //     single word that looks like a keyword and isn't, suggest the closest.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.includes(";") || line.includes(" ")) continue;
    if (SUMMIT_KEYWORDS.has(line)) continue;
    // Try case-insensitive match
    const lower = line.toLowerCase();
    for (const kw of SUMMIT_KEYWORDS) {
      if (kw.toLowerCase() === lower) {
        warnings.push({
          level: "warn",
          msg: `Line ${i + 1}: \`${line}\` looks like the Summit keyword \`${kw}\` but is case-wrong. Summit keywords are case-sensitive.`,
        });
        break;
      }
    }
  }

  // R5: Advisory — mentions a DAT/EM Capture command that requires Capture
  //     for AutoCAD to be loaded in the session. Fire once per macro.
  for (const cmd of CAPTURE_COMMANDS_REQUIRING_CAPTURE) {
    const re = new RegExp(`\\b${cmd.replace(/[.*+?^${}()|[\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) {
      warnings.push({
        level: "info",
        msg: `Uses \`${cmd}\` — requires DAT/EM Capture for AutoCAD loaded in the running Civil 3D session.`,
      });
      break;
    }
  }

  return warnings;
}

// Convenience: lint every configured button in a project, return per-button
// warnings keyed by "row,col".
export function lintProject(project) {
  const out = {};
  for (const [key, btn] of Object.entries(project.buttons || {})) {
    const w = lintMacro(btn.commands, { isHeader: !!btn.header });
    if (w.length) out[key] = w;
  }
  return out;
}

export function countWarningsBySeverity(byKey) {
  let warn = 0;
  let info = 0;
  for (const w of Object.values(byKey)) {
    for (const x of w) {
      if (x.level === "warn") warn++;
      else info++;
    }
  }
  return { warn, info };
}
