// js/lint.js
// Static analysis of a button macro. Returns an array of warnings, each
// { level, msg, ruleId?, fix? }. `fix(commands) => string` is present when
// the rule has a safe, mechanical correction; the lint modal exposes those
// as one-click and "Fix all in this category" buttons.
//
// Rule design philosophy: only fire when a problem is genuinely likely.
// False positives are annoying because users ignore them, which hides real
// issues. When in doubt, "info" (advisory) over "warn" (will probably break).

import { cellOwnerMap, normalizeMacro } from "./state.js";

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

// Per-rule metadata used by the lint modal. `label` is the section header;
// `detail` is the explanation expanded under the header.
export const RULES = {
  "layer-not-closed": {
    label: "-LAYER not closed with {RET}{RET}",
    detail:
      "-LAYER{RET}SET{RET}<NAME> needs a trailing {RET}{RET} to exit the LAYER command. Without it, " +
      "AutoCAD stays at the LAYER prompt and eats the next input the operator gives it.",
  },
  "dialog-pops": {
    label: "Bare LAYER/INSERT pops a dialog",
    detail:
      "LAYER, INSERT, and LAYOUT have two forms. The dashless form opens an AutoCAD dialog and " +
      "ignores the rest of the macro. Use -LAYER, -INSERT, -LAYOUT so the prompts run on the command line.",
  },
  "legacy-macro-syntax": {
    label: "Legacy AutoCAD CUI syntax",
    detail:
      "DAT/EM's keystroke injection doesn't honor `^C^C` (or {ESC}{ESC}) as cancel — it arrives as " +
      "literal text and breaks the next prompt. The exporter also can't tell `;` (Enter) apart from " +
      "`;;` (exit-LAYER) and chained `\\n` reliably. The fix rewrites the macro to use literal {RET} " +
      "tokens, drops any cancel prefix, and upgrades `-LAYER;S;` to `-LAYER;SET;`. Matches the " +
      "verified-working keypad format.",
  },
  "case-wrong-summit-keyword": {
    label: "Summit keyword has wrong case",
    detail:
      "Summit keywords are case-sensitive. RAISEZ, raisez, etc. aren't recognized — the canonical " +
      "casing (RaiseZ, LowerZ, ZLock…) is required.",
  },
  "osnap-not-transparent": {
    label: "OSNAP toggle not transparent",
    detail:
      "-osnap;<mode> without a leading apostrophe is a non-transparent command and will exit the active " +
      "draw command. Convention is '_-osnap;<mode> so the operator can toggle snaps mid-polyline.",
  },
  "header-has-commands": {
    label: "Header button has a command",
    detail:
      "Header buttons are visual section dividers and should not run a macro. The DAT/EM exporter still " +
      "writes the DATA but operators can press them by accident.",
  },
  "header-too-tall": {
    label: "Header taller than 1 row",
    detail:
      "Section-header buttons read best as a thin label bar above the section they mark. Headers taller " +
      "than 1 row eat keypad real estate and create weird spacing between sections. The fix sets height to 1 " +
      "and keeps the width (so a 2x2 becomes 2x1).",
  },
  "header-too-narrow": {
    label: "Header only 1 column wide",
    detail:
      "Section-header buttons read as a rectangular label bar above the section they mark — a 1x1 header " +
      "looks like a normal button. The fix grows width to 2 when the cell to the right is free; otherwise " +
      "open the button and widen it manually.",
  },
  "empty-labeled-button": {
    label: "Labeled button has no command",
    detail:
      "A labeled button with empty DATA does nothing when pressed. Either add a macro or mark it as a header.",
  },
  "capture-required": {
    label: "Requires DAT/EM Capture loaded",
    detail:
      "This macro uses a Capture-for-AutoCAD command. The running session must have Capture loaded — " +
      "advisory only, no fix needed.",
  },
};

export function lintMacro(commands, opts = {}) {
  const warnings = [];
  const text = commands || "";
  const trimmed = text.trim();

  // Header buttons: only the header-related rules apply.
  if (opts.isHeader) {
    if (trimmed) {
      warnings.push({
        level: "warn",
        ruleId: "header-has-commands",
        msg: "Header button has a macro. Clear it or convert this to a regular button.",
      });
    }
    if (opts.height && opts.height > 1) {
      warnings.push({
        level: "warn",
        ruleId: "header-too-tall",
        msg: `Header is ${opts.height} rows tall — section headers read better as a 1-row label bar.`,
        fixButton: (btn) => {
          if ((btn.height || 1) <= 1) return false;
          btn.height = 1;
          return true;
        },
      });
    }
    if (opts.width !== undefined && opts.width < 2) {
      warnings.push({
        level: "warn",
        ruleId: "header-too-narrow",
        msg: "Header is only 1 column wide — section headers read better as a rectangular 2-column label bar.",
        fixButton: (btn, ctx) => {
          if ((btn.width || 1) >= 2) return false;
          if (!ctx || !ctx.project) return false;
          if (ctx.col + 2 > ctx.project.cols) return false;
          const others = { ...ctx.project.buttons };
          delete others[ctx.key];
          const owner = cellOwnerMap({ buttons: others });
          if (owner[`${ctx.row},${ctx.col + 1}`]) return false;
          btn.width = 2;
          return true;
        },
      });
    }
    return warnings;
  }

  // Empty macros. In editor mode (no isLabeled hint) we keep the legacy
  // "empty button does nothing" advisory so the live in-side-panel lint
  // behaves as before. In project-wide mode (isLabeled passed) we only
  // surface findings for buttons that LOOK configured (have a label but no
  // bitmap) — empty placeholder buttons aren't worth a finding.
  if (!trimmed) {
    if (opts.isLabeled === undefined) {
      warnings.push({ level: "info", msg: "Empty macro — button does nothing when pressed." });
    } else if (opts.isLabeled && !opts.hasBitmap) {
      warnings.push({
        level: "info",
        ruleId: "empty-labeled-button",
        msg: "Labeled but empty — pressing this button does nothing.",
      });
    }
    return warnings;
  }

  const lines = text.split("\n").map((l) => l.trim());

  // R: legacy AutoCAD CUI syntax. The editor convention is literal {RET}
  // tokens and no cancel prefix. ^C^C / {ESC}{ESC} arrive as literal text on
  // DAT/EM and break the next prompt; `;;\n` produces three {RET}s back-to-
  // back and re-invokes the previous command. Auto-fix rewrites via
  // normalizeMacro, which is the same pass used at import + init-time
  // migration.
  if (/\^C|\{ESC\}|;|\n/.test(text)) {
    warnings.push({
      level: "warn",
      ruleId: "legacy-macro-syntax",
      msg: "Macro uses ^C^C / `;` / newlines — DAT/EM expects literal {RET} tokens. Auto-fix rewrites it.",
      fix: (cmds) => normalizeMacro(cmds),
    });
  }

  // R: `-LAYER{RET}SET{RET}NAME` should end with `{RET}{RET}` to exit the
  // LAYER command. After the migration pass everything's in {RET} form;
  // this catches anyone manually editing a layer macro and forgetting the
  // second closer.
  if (/-LAYER\{RET\}(?:SET|S)\{RET\}[^{]+\{RET\}(?!\{RET\})/i.test(text)) {
    warnings.push({
      level: "warn",
      ruleId: "layer-not-closed",
      msg: "`-LAYER{RET}SET{RET}NAME{RET}` is missing the second {RET} — LAYER stays open and eats the next keystroke.",
      fix: (cmds) => cmds.replace(
        /(-LAYER\{RET\}(?:SET|S)\{RET\}[^{]+\{RET\})(?!\{RET\})/gi,
        (_, head) => `${head}{RET}`,
      ),
    });
  }

  // R: bare LAYER / INSERT / LAYOUT — dialog form. The dashless form opens
  // an AutoCAD dialog and ignores the rest of the macro. Boundary chars are
  // start-of-string, whitespace, or `}` (end of a previous {RET} token).
  // Underscore is also a separator (_INSERT is the international dialog
  // form). `CLAYER` (system variable) is exempt because it's preceded by
  // `C`, which is in the identifier class.
  const DIALOG_RE = /(?<=^|[\s}])(_?)(LAYER|INSERT|LAYOUT)(?![A-Za-z0-9_])/g;
  let dialogFound = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    DIALOG_RE.lastIndex = 0;
    if (DIALOG_RE.test(ln)) {
      dialogFound = true;
      const kw = (ln.match(DIALOG_RE) || ["LAYER"])[0].replace(/^_/, "");
      warnings.push({
        level: "warn",
        ruleId: "dialog-pops",
        msg: `Line ${i + 1}: \`${kw}\` opens the AutoCAD dialog. Use the dashed form (-LAYER, -INSERT, -LAYOUT).`,
      });
    }
  }
  if (dialogFound) {
    warnings[warnings.length - 1].fix = (cmds) =>
      cmds.replace(
        /(?<=^|[\s}])(_?)(LAYER|INSERT|LAYOUT)(?![A-Za-z0-9_])/g,
        (_, u, kw) => `${u || ""}-${kw}`,
      );
  }

  // R: case-wrong Summit keyword on a bare line.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.includes("{") || line.includes(" ")) continue;
    if (SUMMIT_KEYWORDS.has(line)) continue;
    const lower = line.toLowerCase();
    for (const kw of SUMMIT_KEYWORDS) {
      if (kw.toLowerCase() === lower) {
        const lineIdx = i;
        warnings.push({
          level: "warn",
          ruleId: "case-wrong-summit-keyword",
          msg: `Line ${lineIdx + 1}: \`${line}\` should be \`${kw}\` — Summit keywords are case-sensitive.`,
          fix: (cmds) => {
            const ls = cmds.split("\n");
            if (ls[lineIdx] && ls[lineIdx].trim() === line) {
              ls[lineIdx] = ls[lineIdx].replace(line, kw);
            }
            return ls.join("\n");
          },
        });
        break;
      }
    }
  }

  // R: -osnap not preceded by '. Editor convention is '_-osnap{RET}<mode>.
  // The 2-char lookbehind on `['_]` rejects both bare `-osnap` and `_-osnap`
  // (without leading `'`); `'_-osnap` is the canonical transparent form.
  if (/(?<!['_])(_?-osnap)\b/i.test(text)) {
    warnings.push({
      level: "warn",
      ruleId: "osnap-not-transparent",
      msg: "-osnap needs a leading `'` to run transparently — otherwise it cancels the active polyline.",
      fix: (cmds) => cmds.replace(/(?<!['_])(_?-osnap)\b/gi, "'$1"),
    });
  }

  // R: advisory — Capture-required command. Once per macro.
  for (const cmd of CAPTURE_COMMANDS_REQUIRING_CAPTURE) {
    const re = new RegExp(`\\b${cmd.replace(/[.*+?^${}()|[\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) {
      warnings.push({
        level: "info",
        ruleId: "capture-required",
        msg: `Uses \`${cmd}\` — requires DAT/EM Capture for AutoCAD loaded in the running session.`,
      });
      break;
    }
  }

  return warnings;
}

// Lint every configured button in a project, return per-button warnings
// keyed by "row,col".
export function lintProject(project) {
  const out = {};
  for (const [key, btn] of Object.entries(project.buttons || {})) {
    const [row, col] = key.split(",").map(Number);
    const w = lintMacro(btn.commands, {
      isHeader: !!btn.header,
      isLabeled: !!(btn.label && btn.label.trim()),
      hasBitmap: !!btn.bitmap,
      height: btn.height || 1,
      width: btn.width || 1,
      row,
      col,
      project,
    });
    if (w.length) out[key] = w;
  }
  return out;
}

// Flat findings list for the project-wide lint modal. Each finding carries
// the button context (key, row, col, label, command) so the UI doesn't need
// to look the button up again.
export function findProjectIssues(project) {
  const findings = [];
  let nextId = 1;
  for (const [key, warnings] of Object.entries(lintProject(project))) {
    const [row, col] = key.split(",").map(Number);
    const btn = project.buttons[key] || {};
    for (const w of warnings) {
      findings.push({
        id: `f${nextId++}`,
        key, row, col,
        label: btn.label || "",
        command: btn.commands || "",
        level: w.level,
        ruleId: w.ruleId,
        msg: w.msg,
        fix: w.fix || null,
        fixButton: w.fixButton || null,
      });
    }
  }
  return findings;
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

// Apply a finding's fix to the project's button. Returns true on change.
// Two flavors of fix are supported:
//   - `fix(commands)` returns a new command string (used by macro-level rules)
//   - `fixButton(btn, ctx)` mutates the button in place and returns true on
//     change (used by structural rules like header-too-tall / header-too-narrow
//     that touch width/height). `ctx` carries { project, key, row, col } so
//     rules can do collision-aware fixes against neighboring buttons.
// Callers should recordChange() before and persist()+renderAll() after.
export function applyFix(project, finding) {
  if (!finding) return false;
  const btn = project.buttons[finding.key];
  if (!btn) return false;
  if (finding.fixButton) {
    return finding.fixButton(btn, {
      project,
      key: finding.key,
      row: finding.row,
      col: finding.col,
    });
  }
  if (finding.fix) {
    const next = finding.fix(btn.commands || "");
    if (next === (btn.commands || "")) return false;
    btn.commands = next;
    return true;
  }
  return false;
}

// Apply every auto-fixable finding for a rule. Re-lints after each pass so
// cascading rules (e.g. dialog-pops after literal-esc-token replaced {ESC})
// converge in a few iterations.
export function applyAllFixesForRule(project, ruleId, maxPasses = 4) {
  let totalChanged = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const findings = findProjectIssues(project).filter(
      (f) => f.ruleId === ruleId && (f.fix || f.fixButton),
    );
    if (!findings.length) break;
    let changed = 0;
    for (const f of findings) {
      if (applyFix(project, f)) changed++;
    }
    if (!changed) break;
    totalChanged += changed;
  }
  return totalChanged;
}
