// js/lint.js
// Static analysis of a button macro. Returns an array of warnings, each
// { level, msg, ruleId?, fix? }. `fix(commands) => string` is present when
// the rule has a safe, mechanical correction; the lint modal exposes those
// as one-click and "Fix all in this category" buttons.
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

// Per-rule metadata used by the lint modal. `label` is the section header;
// `detail` is the explanation expanded under the header.
export const RULES = {
  "layer-not-closed": {
    label: "-LAYER not closed with ;;",
    detail:
      "-LAYER;S;<name> needs a trailing ;; to exit the LAYER command. Without it, " +
      "AutoCAD stays at the LAYER prompt and eats the next input the operator gives it.",
  },
  "dialog-pops": {
    label: "Bare LAYER/INSERT pops a dialog",
    detail:
      "LAYER, INSERT, and LAYOUT have two forms. The dashless form opens an AutoCAD dialog and " +
      "ignores the rest of the macro. Use -LAYER, -INSERT, -LAYOUT so the prompts run on the command line.",
  },
  "missing-cancel-prefix": {
    label: "Missing ^C^C prefix",
    detail:
      "AutoCAD commands should start with ^C^C so the keypad press cancels any command already running " +
      "(STRETCH, an in-progress polyline, etc.). Summit keywords and transparent (') commands don't need it.",
  },
  "case-wrong-summit-keyword": {
    label: "Summit keyword has wrong case",
    detail:
      "Summit keywords are case-sensitive. RAISEZ, raisez, etc. aren't recognized — the canonical " +
      "casing (RaiseZ, LowerZ, ZLock…) is required.",
  },
  "literal-esc-token": {
    label: "Literal {ESC} / {RET} token",
    detail:
      "{ESC} and {RET} are .dkf file-format tokens. In the editor they're sent to AutoCAD as literal text. " +
      "Use ^C^C for cancel and ; (or a newline) for Enter.",
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

// Build a fix that operates on the first line of a macro. The macro may have
// multiple lines (chained commands). Returns null if no first line.
function fixFirstLine(commands, transform) {
  const lines = commands.split("\n");
  if (!lines.length) return commands;
  lines[0] = transform(lines[0]);
  return lines.join("\n");
}

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

  // R: literal .dkf tokens. Run first because the replacement settles the
  // macro into editor form so later rules see ^C^C / ; instead of {ESC}/{RET}.
  if (/\{ESC\}|\{RET\}/.test(text)) {
    warnings.push({
      level: "warn",
      ruleId: "literal-esc-token",
      msg: "Macro contains {ESC} or {RET} — those are .dkf file tokens. Use ^C^C and ; in the editor.",
      fix: (cmds) =>
        cmds
          .replace(/\{ESC\}\{ESC\}/g, "^C^C")
          .replace(/\{ESC\}/g, "^C^C")
          .replace(/\{RET\}/g, ";"),
    });
  }

  // R: `-LAYER;S;NAME` should end with `;;` to exit the LAYER command.
  // Allow chained command after: the `;;` exits LAYER, then a newline / next
  // line starts the chained command.
  let layerNotClosed = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const m = ln.match(/-LAYER;[A-Za-z]+;[\w-]+/i);
    if (m && !/-LAYER;[A-Za-z]+;[\w-]+;;/i.test(ln)) {
      layerNotClosed = true;
      warnings.push({
        level: "warn",
        ruleId: "layer-not-closed",
        msg: `Line ${i + 1}: \`-LAYER;...\` is missing trailing \`;;\` — the LAYER command stays open.`,
      });
    }
  }
  if (layerNotClosed) {
    // Single fix for the whole macro, attached to one (last) finding so
    // "Apply" doesn't run N times.
    warnings[warnings.length - 1].fix = (cmds) =>
      cmds.replace(
        /(-LAYER;[A-Za-z]+;[\w-]+)(;(?!;)|(?=$|\n))/gi,
        (_, head) => `${head};;`,
      );
  }

  // R: bare LAYER / INSERT / LAYOUT — dialog form. Treat ^C as a separator
  // for boundary purposes (otherwise ^C^CINSERT looks like part of an
  // identifier "CINSERT" to the regex engine). Underscore is also a
  // separator: _INSERT is the international dialog form, _-INSERT is silent.
  // `CLAYER` (the system variable) is exempt because it's preceded by `C`,
  // which is in the identifier class.
  const DIALOG_RE = /(?<=^|[\s;]|\^C)(_?)(LAYER|INSERT|LAYOUT)(?![A-Za-z0-9_])/g;
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
        /(?<=^|[\s;]|\^C)(_?)(LAYER|INSERT|LAYOUT)(?![A-Za-z0-9_])/g,
        (_, u, kw) => `${u || ""}-${kw}`,
      );
  }

  // R: missing ^C^C prefix on first line of a CAD macro. We skip lines that
  // look like a transparent OSNAP without the `'` — the osnap-not-transparent
  // rule will prepend the apostrophe, after which ^C^C would be wrong.
  const first = lines[0];
  if (first) {
    const isSummit = SUMMIT_KEYWORDS.has(first);
    const isCallCmd = first.startsWith("CallCmd");
    const isTransparent = first.startsWith("'");
    const hasCancel = /^(\^C){1,3}/.test(first);
    const isOsnap = /^_?-osnap\b/i.test(first);
    const looksCAD = CAD_LIKE_LINE.test(first);
    if (looksCAD && !isSummit && !isCallCmd && !isTransparent && !hasCancel && !isOsnap) {
      warnings.push({
        level: "info",
        ruleId: "missing-cancel-prefix",
        msg: "Consider prefixing with `^C^C` so this button cancels any running command before starting.",
        fix: (cmds) => fixFirstLine(cmds, (l) => "^C^C" + l.replace(/^\s+/, "")),
      });
    }
  }

  // R: case-wrong Summit keyword on a bare line.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.includes(";") || line.includes(" ")) continue;
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

  // R: -osnap not preceded by '. Editor convention is '_-osnap;<mode>.
  // The 2-char lookbehind on `['_]` is the bit that took two tries: with a
  // single-char lookbehind, `'_-osnap` matches as `-osnap` at the position
  // after `_`, where the previous char is `_` (not `'`), and falsely fires.
  // Excluding both `'` and `_` from the lookbehind ensures we only flag the
  // bare `-osnap` (no `_`) and `_-osnap` (where the `_` itself is the start
  // of the match, and the previous char before that `_` is checked).
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
    const w = lintMacro(btn.commands, {
      isHeader: !!btn.header,
      isLabeled: !!(btn.label && btn.label.trim()),
      hasBitmap: !!btn.bitmap,
      height: btn.height || 1,
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
//   - `fixButton(btn)` mutates the button in place and returns true on change
//     (used by structural rules like header-too-tall that touch width/height)
// Callers should recordChange() before and persist()+renderAll() after.
export function applyFix(project, finding) {
  if (!finding) return false;
  const btn = project.buttons[finding.key];
  if (!btn) return false;
  if (finding.fixButton) {
    return finding.fixButton(btn);
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
