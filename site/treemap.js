/* ── Treemap layout & canvas rendering ────────────────── */

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let dpr = window.devicePixelRatio || 1;

let groupRects = [];
let itemRects = [];

/* ── Helpers ───────────────────────────────────────────── */

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/* ── Colour functions ──────────────────────────────────── */

/*
 * Attempt to replicate the karpathy.ai/jobs greenRedCSS approach:
 * - A contrast-boost power curve deepens colours so white text pops
 * - Piecewise interpolation: green → yellow → orange → red
 */

function boostContrast(t) {
  const sign = t < 0.5 ? -1 : 1;
  const c = (t - 0.5) * 2;                           // -1 … +1
  return 0.5 + sign * Math.pow(Math.abs(c), 0.55) / 2;
}

function greenRedCSS(t, alpha = 1) {
  /* t = 0 → green, t = 1 → red */
  const tb = boostContrast(clamp(t, 0, 1));
  let r, g, b;
  if (tb < 0.5) {
    const s = tb / 0.5;
    r = Math.round(30 + s * 200);
    g = Math.round(180 - s * 130);
    b = Math.round(40 - s * 25);
  } else {
    const s = (tb - 0.5) / 0.5;
    r = Math.round(230 + s * 25);
    g = Math.round(160 - s * 130);
    b = Math.round(20 - s * 5);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function colorTrend(value, alpha = 1) {
  if (value == null) return `rgba(120, 120, 120, ${alpha})`;
  const maxAbs = Math.max(8, ...App.data.map(d => Math.abs(d.trend || 0)));
  const t = clamp((value + maxAbs) / (maxAbs * 2), 0, 1);
  /* t=0 declining → red, t=1 growing → green, so invert */
  return greenRedCSS(1 - t, alpha);
}

function getPayBounds() {
  const values = App.data
    .map(d => d.pay)
    .filter(value => value != null)
    .sort((a, b) => a - b);
  if (!values.length) return { min: 0, max: 1 };
  const min = values[Math.floor((values.length - 1) * 0.1)];
  const max = values[Math.floor((values.length - 1) * 0.9)];
  return { min, max: max > min ? max : Math.max(min + 1, values[values.length - 1]) };
}

function colorPay(value, alpha = 1) {
  if (value == null) return `rgba(120, 120, 120, ${alpha})`;
  const bounds = getPayBounds();
  const t = clamp((value - bounds.min) / Math.max(1, bounds.max - bounds.min), 0, 1);
  return greenRedCSS(t, alpha);
}

function getRegionalMaxDeviation() {
  const deviations = App.data
    .map(record => getRegionalValue(record))
    .filter(value => value != null && value > 0)
    .map(value => Math.abs(Math.log2(value)));
  return Math.max(0.35, ...deviations);
}

function colorRegional(value, alpha = 1) {
  if (value == null || value <= 0) return `rgba(120, 120, 120, ${alpha})`;
  const maxDeviation = getRegionalMaxDeviation();
  const t = clamp((Math.log2(value) + maxDeviation) / (maxDeviation * 2), 0, 1);
  return greenRedCSS(t, alpha);
}

function colorConcentration(value, alpha = 1) {
  if (value == null) return `rgba(120, 120, 120, ${alpha})`;
  const t = clamp(value / 100, 0, 1);
  /* 0% broad → green, 100% concentrated → red */
  return greenRedCSS(t, alpha);
}

function colorExposure(value, alpha = 1) {
  if (value == null) return `rgba(120, 120, 120, ${alpha})`;
  const t = clamp(value / 10, 0, 1);
  /* 0 low → green, 10 high → red */
  return greenRedCSS(t, alpha);
}

function fillColor(record, alpha = 1) {
  if (App.colorMode === "trend") return colorTrend(record.trend, alpha);
  if (App.colorMode === "pay") return colorPay(record.pay, alpha);
  if (App.colorMode === "regional") return colorRegional(getRegionalValue(record), alpha);
  if (App.colorMode === "concentration") return colorConcentration(record.concentration, alpha);
  return colorExposure(record.exposure, alpha);
}

function metricLabel(record) {
  if (App.colorMode === "trend") return formatPct(record.trend);
  if (App.colorMode === "pay") return formatMoneyCompact(record.pay);
  if (App.colorMode === "regional") return formatRegionalIndex(getRegionalValue(record));
  if (App.colorMode === "concentration") return formatShare(record.concentration);
  return record.exposure != null ? `${record.exposure}/10` : "\u2014";
}

/* ── Squarify (used only for group-level layout) ───────── */

function squarify(items, x, y, w, h) {
  if (!items.length) return [];
  if (items.length === 1) return [{ ...items[0], rx: x, ry: y, rw: w, rh: h }];

  const out = [];
  let remaining = [...items];
  let cx = x, cy = y, cw = w, ch = h;

  while (remaining.length) {
    const total = remaining.reduce((sum, item) => sum + item.value, 0);
    if (!total || cw <= 0 || ch <= 0) break;

    const horizontal = cw >= ch;
    const span = horizontal ? ch : cw;
    let row = [remaining[0]];
    let rowSum = remaining[0].value;

    for (let i = 1; i < remaining.length; i++) {
      const candidate = [...row, remaining[i]];
      const candidateSum = rowSum + remaining[i].value;
      if (
        worstAspect(candidate, candidateSum, span, total, horizontal ? cw : ch) <
        worstAspect(row, rowSum, span, total, horizontal ? cw : ch)
      ) {
        row = candidate;
        rowSum = candidateSum;
      } else {
        break;
      }
    }

    const thickness = horizontal ? cw * (rowSum / total) : ch * (rowSum / total);
    let offset = 0;
    for (const item of row) {
      const length = span * (item.value / rowSum);
      if (horizontal) {
        out.push({ ...item, rx: cx, ry: cy + offset, rw: thickness, rh: length });
      } else {
        out.push({ ...item, rx: cx + offset, ry: cy, rw: length, rh: thickness });
      }
      offset += length;
    }

    if (horizontal) { cx += thickness; cw -= thickness; }
    else { cy += thickness; ch -= thickness; }

    remaining = remaining.slice(row.length);
  }

  return out;
}

function worstAspect(row, rowSum, span, total, extent) {
  if (rowSum <= 0 || span <= 0 || extent <= 0 || total <= 0) return Infinity;
  const thickness = extent * (rowSum / total);
  let worst = 0;
  for (const item of row) {
    const length = span * (item.value / rowSum);
    if (length <= 0) continue;
    const aspect = Math.max(thickness / length, length / thickness);
    if (aspect > worst) worst = aspect;
  }
  return worst;
}

/* ── Square grid packing (items within each group) ─────── */

/**
 * Pack items as squares inside a rectangle (x, y, w, h).
 * Each item gets a square whose side length is proportional to sqrt(jobs).
 * Items are sorted largest-first (top-left) and packed in shelf rows.
 *
 * Returns an array of { ...item, rx, ry, rw, rh } where rw === rh.
 */
function packSquares(items, x, y, w, h) {
  if (!items.length || w <= 0 || h <= 0) return [];

  /* Sort largest first */
  const sorted = [...items].sort((a, b) => (b.value || 0) - (a.value || 0));

  /* Compute raw side = sqrt(value) for each */
  const rawSides = sorted.map(item => Math.sqrt(item.value || 0));
  const totalRawArea = rawSides.reduce((sum, s) => sum + s * s, 0);
  if (totalRawArea <= 0) return [];

  /*
   * Binary search for the best scale factor so squares fill the available area.
   * We pack row-by-row (shelf packing) and find the scale where the total
   * height just fits.
   */
  const gap = 2;
  const minSide = 6;

  function shelfHeight(scale) {
    let cx = 0, rowH = 0, totalH = 0;
    for (const raw of rawSides) {
      const side = Math.max(minSide, Math.round(raw * scale));
      if (cx > 0 && cx + side + gap > w) {
        /* New row */
        totalH += rowH + gap;
        cx = 0;
        rowH = 0;
      }
      cx += side + gap;
      rowH = Math.max(rowH, side);
    }
    totalH += rowH;
    return totalH;
  }

  /* Find scale so packed height ≈ available height */
  let lo = 0.01, hi = 200;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (shelfHeight(mid) > h) hi = mid;
    else lo = mid;
  }
  const scale = lo;

  /* Now lay out for real with this scale */
  const out = [];
  let cx = 0, cy2 = 0, rowH = 0;

  for (let i = 0; i < sorted.length; i++) {
    const side = Math.max(minSide, Math.round(rawSides[i] * scale));

    if (cx > 0 && cx + side + gap > w) {
      /* Wrap to next row */
      cy2 += rowH + gap;
      cx = 0;
      rowH = 0;
    }

    /* If we've overflowed vertically, still place (will clip) */
    out.push({
      ...sorted[i],
      rx: x + cx,
      ry: y + cy2,
      rw: side,
      rh: side,
    });

    cx += side + gap;
    rowH = Math.max(rowH, side);
  }

  return out;
}

/* ── Layout ────────────────────────────────────────────── */

function layoutTreemap() {
  const shell = document.querySelector(".canvas-shell");
  const width = shell.clientWidth;
  const vh = window.innerHeight;
  const isLandscape = width > vh;
  const isMobile = width <= 500;

  const margin = isMobile ? 8 : 14;
  const gap = isMobile ? 3 : 4;

  const visibleData = App.getVisibleData();

  const categoryItems = Object.values(
    visibleData.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = {
          id: item.category,
          label: item.category_label || item.category,
          value: 0,
          items: [],
        };
      }
      acc[item.category].value += item.jobs || 0;
      acc[item.category].items.push(item);
      return acc;
    }, {})
  ).sort((a, b) => b.value - a.value);

  if (isMobile) {
    /* ── Mobile: stack groups vertically, each gets full width ── */
    const totalJobs = categoryItems.reduce((s, g) => s + g.value, 0) || 1;
    const usableW = width - margin * 2;
    const groupGap = 6;
    let currentY = margin;

    groupRects = [];
    for (const cat of categoryItems) {
      const share = cat.value / totalJobs;
      /* Height proportional to sqrt(share) so small groups still get space */
      const h = Math.max(120, Math.round(Math.sqrt(share) * usableW * 2.5));
      groupRects.push({ ...cat, rx: margin, ry: currentY, rw: usableW, rh: h });
      currentY += h + groupGap;
    }

    const totalHeight = currentY - groupGap + margin;
    canvas.width = width * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.height = `${totalHeight}px`;
    canvas.style.width = `${width}px`;
  } else {
    /* ── Desktop / tablet: squarify groups into fixed canvas ── */
    const height = Math.round(isLandscape
      ? Math.max(680, vh * 0.88)
      : Math.max(680, width * 0.95));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    canvas.style.width = `${width}px`;

    groupRects = squarify(categoryItems, margin, margin, width - margin * 2, height - margin * 2);
  }

  /* ── Pack square tiles within each group (same for both paths) ── */
  itemRects = [];
  for (const group of groupRects) {
    const labelHeight = (isMobile || group.rh > 72) ? 24 : 0;
    const innerX = group.rx + gap;
    const innerY = group.ry + labelHeight + gap;
    const innerW = Math.max(0, group.rw - gap * 2);
    const innerH = Math.max(0, group.rh - gap * 2 - labelHeight);

    const squares = packSquares(
      group.items
        .filter(item => (item.jobs || 0) > 0)
        .map(item => ({ ...item, value: item.jobs || 0 })),
      innerX,
      innerY,
      innerW,
      innerH,
    );
    for (const sq of squares) {
      itemRects.push(sq);
    }
  }
}

/* ── Draw ──────────────────────────────────────────────── */

function drawTreemap() {
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const matchedSlugs = App.getMatchedSlugs();
  const hasSearch = App.searchQuery.length > 0;

  for (const group of groupRects) {
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.strokeStyle = "rgba(31,26,22,0.08)";
    ctx.lineWidth = 1;
    roundRect(ctx, group.rx, group.ry, group.rw, group.rh, 6, true, true);

    const mobileView = width < 500;
    const labelMinH = mobileView ? 50 : 72;
    const labelMinW = mobileView ? 70 : 110;
    const labelFont = mobileView ? 11 : 11;
    const labelPad = mobileView ? 8 : 10;
    if (group.rh > labelMinH && group.rw > labelMinW) {
      ctx.fillStyle = "rgba(31,26,22,0.62)";
      ctx.font = `700 ${labelFont}px -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif`;
      ctx.textBaseline = "top";
      const groupText = group.label.toUpperCase();
      const maxLabelW = group.rw - labelPad * 2;
      const measured = ctx.measureText(groupText).width;
      ctx.fillText(measured > maxLabelW ? groupText.slice(0, Math.floor(maxLabelW / (labelFont * 0.6))) + "…" : groupText, group.rx + labelPad, group.ry + (mobileView ? 6 : 8));
    }
  }

  for (const rect of itemRects) {
    const hoveredTile = App.hovered && App.hovered.slug === rect.slug;
    const dimmed = hasSearch && !matchedSlugs.has(rect.slug);
    const inset = hoveredTile ? 1 : 2;
    const x = rect.rx + inset;
    const y = rect.ry + inset;
    const side = Math.max(0, rect.rw - inset * 2);

    const baseAlpha = dimmed ? 0.25 : (hoveredTile ? 0.96 : 0.88);
    ctx.fillStyle = fillColor(rect, baseAlpha);
    ctx.strokeStyle = hoveredTile ? "rgba(31,26,22,0.55)" : "rgba(255,255,255,0.72)";
    ctx.lineWidth = hoveredTile ? 2 : 1;
    roundRect(ctx, x, y, side, side, 3, true, true);

    if (side < 28) continue;

    const textAlpha = dimmed ? 0.35 : 0.94;
    const title = rect.title;
    const label = metricLabel(rect);
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, x, y, side, side, 3);
    ctx.clip();

    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;

    const fontSize = Math.max(9, Math.min(14, side / 5));
    ctx.fillStyle = `rgba(255,255,255,${textAlpha})`;
    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    drawWrappedText(ctx, title, x + 6, y + 6, side - 12, side - 26, 1.18);

    if (side > 44) {
      ctx.fillStyle = `rgba(255,255,255,${dimmed ? 0.25 : 0.78})`;
      ctx.font = `600 ${Math.max(9, fontSize - 2)}px -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif`;
      ctx.fillText(label, x + 6, y + side - 16);
    }

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    ctx.restore();
  }
}

/* ── Text wrapping ─────────────────────────────────────── */

function drawWrappedText(context, text, x, y, maxWidth, maxHeight, lineHeightMultiplier) {
  const words = text.split(/\s+/);
  const metrics = context.measureText("M");
  const emHeight = metrics.actualBoundingBoxAscent + (metrics.actualBoundingBoxDescent || 0) || 12;
  const lineHeight = emHeight * lineHeightMultiplier;
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  lines.slice(0, maxLines).forEach((line, index) => {
    let output = line;
    if (index === maxLines - 1 && lines.length > maxLines) {
      while (context.measureText(`${output}\u2026`).width > maxWidth && output.length > 0) {
        output = output.slice(0, -1);
      }
      output += "\u2026";
    }
    context.fillText(output, x, y + index * lineHeight);
  });
}

/* ── Canvas shape helpers ──────────────────────────────── */

function roundRect(context, x, y, w, h, r, fill, stroke) {
  roundRectPath(context, x, y, w, h, r);
  if (fill) context.fill();
  if (stroke) context.stroke();
}

function roundRectPath(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

/* ── Hit testing ───────────────────────────────────────── */

function hitTest(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return itemRects.find(tile =>
    x >= tile.rx && x <= tile.rx + tile.rw &&
    y >= tile.ry && y <= tile.ry + tile.rh
  ) || null;
}

/* ── Redraw ────────────────────────────────────────────── */

function redraw() {
  layoutTreemap();
  drawTreemap();
}
