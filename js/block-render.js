// js/block-render.js
// Renders DXF block-entity geometry to a canvas for preview. Walks an array
// of entities (the shape `parseDxfBlocks` returns inside each block), computes
// a bounding box, scales to fit with margin, and flips Y to canvas-space.
//
// Supported entity types: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE. Others are
// silently skipped (the count still surfaces in the modal's footer).

export function renderBlockPreview(canvas, entities, options = {}) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const color = options.color || "#e8edf5";
  const bg = options.background || "#1a1d24";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const drawable = (entities || []).filter((e) => !e.ignored && e.type);
  if (!drawable.length) {
    ctx.fillStyle = "#6c7280";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("(no drawable geometry)", w / 2, h / 2);
    return;
  }

  const bbox = computeBbox(drawable);
  if (bbox.w === 0 && bbox.h === 0) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const margin = options.margin ?? 10;
  const usableW = Math.max(1, w - margin * 2);
  const usableH = Math.max(1, h - margin * 2);
  const scale = Math.min(usableW / (bbox.w || 1), usableH / (bbox.h || 1));
  const drawnW = bbox.w * scale;
  const drawnH = bbox.h * scale;
  const offsetX = margin + (usableW - drawnW) / 2 - bbox.minX * scale;
  // Y is flipped: canvas Y grows downward, DXF Y grows upward.
  const offsetY = margin + (usableH - drawnH) / 2 + bbox.maxY * scale;

  const tx = (x) => x * scale + offsetX;
  const ty = (y) => -y * scale + offsetY;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const e of drawable) {
    if (e.type === "LINE") {
      ctx.beginPath();
      ctx.moveTo(tx(e.x1), ty(e.y1));
      ctx.lineTo(tx(e.x2), ty(e.y2));
      ctx.stroke();
    } else if (e.type === "CIRCLE") {
      ctx.beginPath();
      ctx.arc(tx(e.cx), ty(e.cy), e.r * scale, 0, Math.PI * 2);
      ctx.stroke();
    } else if (e.type === "ARC") {
      // DXF angles are CCW from +X in degrees; we flipped Y, so traverse
      // from -endAngle to -startAngle to keep the arc on the correct side.
      const sa = -e.endAngle * Math.PI / 180;
      const ea = -e.startAngle * Math.PI / 180;
      ctx.beginPath();
      ctx.arc(tx(e.cx), ty(e.cy), e.r * scale, sa, ea);
      ctx.stroke();
    } else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      const vs = e.vertices || [];
      if (vs.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(tx(vs[0].x), ty(vs[0].y));
      for (let i = 1; i < vs.length; i++) ctx.lineTo(tx(vs[i].x), ty(vs[i].y));
      if (e.closed) ctx.closePath();
      ctx.stroke();
    }
  }
}

function computeBbox(entities) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const upd = (x, y) => {
    if (!isFinite(x) || !isFinite(y)) return;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (const e of entities) {
    if (e.type === "LINE") { upd(e.x1, e.y1); upd(e.x2, e.y2); }
    else if (e.type === "CIRCLE") { upd(e.cx - e.r, e.cy - e.r); upd(e.cx + e.r, e.cy + e.r); }
    else if (e.type === "ARC") { upd(e.cx - e.r, e.cy - e.r); upd(e.cx + e.r, e.cy + e.r); }
    else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      for (const v of (e.vertices || [])) upd(v.x, v.y);
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
