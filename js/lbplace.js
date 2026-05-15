// js/lbplace.js
// Helpers for the "Repeat placement" toggle in the button editor.
//
// LBPLACE is a tiny AutoLISP routine the user loads once in AutoCAD via
// APPLOAD. The keypad macro form `LBPLACE{RET}<layer>{RET}<block>{RET}<scale>{RET}<rotation>{RET}`
// calls into it: the routine sets the layer, then loops -INSERT for one
// click at a time until the operator presses Esc.
//
// The editor exposes a checkbox that round-trips between the static
// `-LAYER{RET}SET{RET}…{RET}{RET}-INSERT{RET}…{RET}S{RET}…{RET}R{RET}…{RET}`
// form (single-click placement) and this repeat form. Toggling preserves
// the layer, block, scale, and rotation values.

export const LBPLACE_LISP = `;; LBPLACE.lsp — DAT/EM keypad helper for repeat block placement.
;; Sets a layer, then loops -INSERT at the operator's clicks until Esc.
;; Keypad macro form:
;;   LBPLACE{RET}<layer>{RET}<block>{RET}<scale>{RET}<rotation>{RET}
;; Example:
;;   LBPLACE{RET}V-NODE-MHOL{RET}MH{RET}1{RET}0{RET}
;;     -> sets layer V-NODE-MHOL; click to place an MH block at scale 1
;;        rotation 0; click again to place another; Esc to stop.

(defun c:LBPLACE ( / lay blk scl rot pt *error*)
  (defun *error* (msg) (princ "\\nDone placing.") (princ))
  (setq lay (getstring T "\\nLayer: "))
  (setq blk (getstring T "\\nBlock: "))
  (setq scl (getstring "\\nScale: "))
  (setq rot (getstring "\\nRotation: "))
  (if (= scl "") (setq scl "1"))
  (if (= rot "") (setq rot "0"))
  (command "-LAYER" "SET" lay "")
  (while (setq pt (getpoint "\\nInsertion point (Esc to end): "))
    (command "-INSERT" blk pt scl scl rot))
  (princ))
`;

// Static -INSERT form. Permissive on scale/rotation chains — both, either,
// or neither match; values can be any non-`{` chars.
const STATIC_RE = /^-LAYER\{RET\}SET\{RET\}([^{]+?)\{RET\}\{RET\}-INSERT\{RET\}([^{]+?)\{RET\}(?:S\{RET\}([^{]*)\{RET\})?(?:R\{RET\}([^{]*)\{RET\})?$/i;

// LBPLACE form. Scale and rotation are always present (LBPLACE expects 4
// args after the command). Empty captures are normalized to "1"/"0".
const REPEAT_RE = /^LBPLACE\{RET\}([^{]+?)\{RET\}([^{]+?)\{RET\}([^{]*)\{RET\}([^{]*)\{RET\}$/i;

export function parseInsertMacro(cmds) {
  const s = (cmds || "").trim();
  const stat = s.match(STATIC_RE);
  if (stat) {
    return {
      form: "static",
      layer: stat[1],
      block: stat[2],
      scale: stat[3] || "1",
      rotation: stat[4] || "0",
    };
  }
  const rep = s.match(REPEAT_RE);
  if (rep) {
    return {
      form: "repeat",
      layer: rep[1],
      block: rep[2],
      scale: rep[3] || "1",
      rotation: rep[4] || "0",
    };
  }
  return null;
}

export function makeStaticInsert({ layer, block, scale, rotation }) {
  return `-LAYER{RET}SET{RET}${layer}{RET}{RET}-INSERT{RET}${block}{RET}S{RET}${scale}{RET}R{RET}${rotation}{RET}`;
}

export function makeRepeatInsert({ layer, block, scale, rotation }) {
  return `LBPLACE{RET}${layer}{RET}${block}{RET}${scale}{RET}${rotation}{RET}`;
}
