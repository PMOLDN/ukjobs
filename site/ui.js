/* ── App state ─────────────────────────────────────────── */

const App = {
  payload: null,
  data: [],
  hovered: null,
  colorMode: "trend",
  searchQuery: "",
  selectedRegion: "",
  selectedOccupation: null,

  /** Returns data filtered to only matched items when a search is active. */
  getVisibleData() {
    return this.data;
  },

  /** Returns a Set of slugs that match the current search query. */
  getMatchedSlugs() {
    if (!this.searchQuery) return new Set(this.data.map(d => d.slug));
    const q = this.searchQuery.toLowerCase();
    return new Set(
      this.data
        .filter(d =>
          d.title.toLowerCase().includes(q) ||
          (d.soc_code && d.soc_code.includes(q)) ||
          (d.category_label && d.category_label.toLowerCase().includes(q)) ||
          (d.dominant_industry && d.dominant_industry.toLowerCase().includes(q))
        )
        .map(d => d.slug)
    );
  },
};

const MODES = {
  trend: {
    label: "Recent Trend",
    low: "Declining",
    high: "Growing",
    metric: (d) => d.trend,
  },
  pay: {
    label: "Median Pay",
    low: "Lower pay",
    high: "Higher pay",
    metric: (d) => d.pay,
  },
  regional: {
    label: "Regional Employment",
    low: "Below UK mix",
    high: "Above UK mix",
    metric: (d) => getRegionalValue(d),
  },
  concentration: {
    label: "Industry Concentration",
    low: "Broad",
    high: "Concentrated",
    metric: (d) => d.concentration,
  },
  exposure: {
    label: "AI Exposure",
    low: "Low",
    high: "High",
    metric: (d) => d.exposure,
  },
};

const tooltip = document.getElementById("tooltip");

/* ── Formatters ────────────────────────────────────────── */

function formatNumber(n) {
  return new Intl.NumberFormat("en-GB").format(n || 0);
}

function formatJobs(n) {
  if (n == null) return "\u2014";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return formatNumber(n);
}

function formatPct(n, digits = 1) {
  if (n == null) return "\u2014";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function formatShare(v) {
  if (v == null) return "\u2014";
  return `${v.toFixed(1)}%`;
}

function formatMoney(n) {
  if (n == null) return "\u2014";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMoneyCompact(n) {
  if (n == null) return "\u2014";
  if (n >= 1_000_000) return `\u00a3${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `\u00a3${(n / 1_000).toFixed(1)}k`;
  return formatMoney(n);
}

function formatRegionalIndex(n) {
  if (n == null) return "\u2014";
  return `${n.toFixed(2)}x`;
}

function getRegionalValue(record) {
  if (!App.selectedRegion || !record.regional_lq) return null;
  return record.regional_lq[App.selectedRegion] ?? null;
}

function getRegionalJobs(record) {
  if (!App.selectedRegion || !record.regional_jobs) return null;
  return record.regional_jobs[App.selectedRegion] ?? null;
}

function joinLabels(labels) {
  if (!labels.length) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

/* ── Summary panel ─────────────────────────────────────── */

function buildSummary(meta) {
  const summary = [
    {
      label: "Occupations",
      value: formatNumber(meta.occupation_count),
      sub: "4-digit SOC 2020 unit groups",
    },
    {
      label: "Reported Jobs",
      value: formatJobs(meta.total_jobs),
      sub: `${meta.current_year} lower-bound employment`,
    },
    {
      label: "Trend Window",
      value: meta.trend_period || "\u2014",
      sub: "Change measured across workbook sheets",
    },
    {
      label: "Active Layers",
      value: formatNumber(meta.available_layers.length),
      sub: meta.available_layers.map(mode => MODES[mode]?.label || mode).join(" \u00b7 "),
    },
  ];

  document.getElementById("summaryGrid").innerHTML = summary.map(item => `
    <div class="summary-card">
      <div class="label">${item.label}</div>
      <div class="value">${item.value}</div>
      <div class="sub">${item.sub}</div>
    </div>
  `).join("");
}

/* ── Notes panel ───────────────────────────────────────── */

function buildNotes(meta) {
  const notes = meta.notes || [];
  document.getElementById("notesList").innerHTML = notes.map(note => `<li>${note}</li>`).join("");
}

/* ── Mode buttons ──────────────────────────────────────── */

function buildModeButtons(meta) {
  const buttons = meta.available_layers.map((mode, index) => `
    <button data-mode="${mode}" class="${index === 0 ? "active" : ""}">${MODES[mode].label}</button>
  `).join("");
  document.getElementById("modeButtons").innerHTML = buttons;
  App.colorMode = meta.available_layers[0] || "trend";
}

function renderLayerOptions(meta) {
  const host = document.getElementById("layerOptions");
  const regions = meta.available_regions || [];
  if (App.colorMode !== "regional" || !regions.length) {
    host.innerHTML = "";
    return;
  }

  if (!regions.includes(App.selectedRegion)) {
    App.selectedRegion = meta.default_region || regions[0];
  }

  host.innerHTML = `
    <label class="region-picker">
      <span>Region</span>
      <select id="regionSelect">
        ${regions.map(region => `
          <option value="${region}" ${region === App.selectedRegion ? "selected" : ""}>${region}</option>
        `).join("")}
      </select>
    </label>
  `;

  host.querySelector("#regionSelect").addEventListener("change", (event) => {
    App.selectedRegion = event.target.value;
    App.hovered = null;
    hideTooltip();
    buildStats();
    drawLegend();
    redraw();
  });
}

/* ── Stats helpers ─────────────────────────────────────── */

function weightedAverage(records, field) {
  let weighted = 0, total = 0;
  for (const record of records) {
    const value = record[field];
    if (value == null || !record.jobs) continue;
    weighted += value * record.jobs;
    total += record.jobs;
  }
  return total ? weighted / total : null;
}

function weightedAverageBy(records, getValue) {
  let weighted = 0, total = 0;
  for (const record of records) {
    const value = getValue(record);
    if (value == null || !record.jobs) continue;
    weighted += value * record.jobs;
    total += record.jobs;
  }
  return total ? weighted / total : null;
}

function highestBy(records, field, minJobs = 0) {
  return records
    .filter(r => r[field] != null && (r.jobs || 0) >= minJobs)
    .sort((a, b) => (b[field] - a[field]) || ((b.jobs || 0) - (a.jobs || 0)))[0] || null;
}

function lowestBy(records, field, minJobs = 0) {
  return records
    .filter(r => r[field] != null && (r.jobs || 0) >= minJobs)
    .sort((a, b) => (a[field] - b[field]) || ((b.jobs || 0) - (a.jobs || 0)))[0] || null;
}

function highestByValue(records, getValue, minJobs = 0) {
  return records
    .filter(record => getValue(record) != null && (record.jobs || 0) >= minJobs)
    .sort((a, b) => (getValue(b) - getValue(a)) || ((b.jobs || 0) - (a.jobs || 0)))[0] || null;
}

function lowestByValue(records, getValue, minJobs = 0) {
  return records
    .filter(record => getValue(record) != null && (record.jobs || 0) >= minJobs)
    .sort((a, b) => (getValue(a) - getValue(b)) || ((b.jobs || 0) - (a.jobs || 0)))[0] || null;
}

/* ── Stats panel ───────────────────────────────────────── */

function buildStats() {
  const meta = App.payload.meta;
  const data = App.data;
  let cards = [];

  if (App.colorMode === "trend") {
    const avg = weightedAverage(data, "trend");
    const growingJobs = data.reduce((sum, d) => sum + ((d.trend != null && d.trend >= 5) ? (d.jobs || 0) : 0), 0);
    const decliningJobs = data.reduce((sum, d) => sum + ((d.trend != null && d.trend <= -5) ? (d.jobs || 0) : 0), 0);
    const fastest = highestBy(data, "trend", 20_000);
    const weakest = lowestBy(data, "trend", 20_000);

    cards = [
      { label: "Reported jobs", value: formatJobs(meta.total_jobs), sub: `${meta.current_year} total across visible cells` },
      { label: "Occupations", value: formatNumber(meta.occupation_count), sub: "Treemap tiles" },
      { label: "Avg trend", value: formatPct(avg), sub: "Job-weighted 2021\u21922024 change", color: colorTrend(avg, 1) },
      { label: "Growing share", value: `${((growingJobs / meta.total_jobs) * 100).toFixed(0)}%`, sub: `${formatJobs(growingJobs)} in occupations up 5%+` },
      { label: "Declining share", value: `${((decliningJobs / meta.total_jobs) * 100).toFixed(0)}%`, sub: `${formatJobs(decliningJobs)} in occupations down 5%+` },
      { label: "Fastest sizable rise", value: fastest ? fastest.title : "\u2014", sub: fastest ? `${formatPct(fastest.trend)} \u00b7 ${formatJobs(fastest.jobs)}` : (weakest ? `${weakest.title} ${formatPct(weakest.trend)}` : "\u2014") },
    ];
  } else if (App.colorMode === "pay") {
    const covered = data.filter(d => d.pay != null);
    const coverageJobs = covered.reduce((sum, d) => sum + (d.jobs || 0), 0);
    const avg = weightedAverage(covered, "pay");
    const highPayJobs = data.reduce((sum, d) => sum + ((d.pay != null && d.pay >= 60_000) ? (d.jobs || 0) : 0), 0);
    const modestPayJobs = data.reduce((sum, d) => sum + ((d.pay != null && d.pay < 30_000) ? (d.jobs || 0) : 0), 0);
    const highest = highestBy(data, "pay", 20_000);
    const lowest = lowestBy(data, "pay", 20_000);

    cards = [
      { label: "Pay coverage", value: formatNumber(covered.length), sub: `${((coverageJobs / meta.total_jobs) * 100).toFixed(0)}% of reported jobs covered` },
      { label: "Avg median pay", value: formatMoneyCompact(avg), sub: "Job-weighted 2024 annual gross pay", color: colorPay(avg, 1) },
      { label: "Higher-pay jobs", value: `${((highPayJobs / meta.total_jobs) * 100).toFixed(0)}%`, sub: `${formatJobs(highPayJobs)} in occupations at \u00a360k+ median pay` },
      { label: "Lower-pay jobs", value: `${((modestPayJobs / meta.total_jobs) * 100).toFixed(0)}%`, sub: `${formatJobs(modestPayJobs)} in occupations below \u00a330k median pay` },
      { label: "Highest-paid large role", value: highest ? highest.title : "\u2014", sub: highest ? `${formatMoneyCompact(highest.pay)} \u00b7 ${formatJobs(highest.jobs)}` : "\u2014" },
      { label: "Lowest-paid large role", value: lowest ? lowest.title : "\u2014", sub: lowest ? `${formatMoneyCompact(lowest.pay)} \u00b7 ${formatJobs(lowest.jobs)}` : "\u2014" },
    ];
  } else if (App.colorMode === "regional") {
    const region = App.selectedRegion || meta.default_region || "Selected region";
    const avg = weightedAverageBy(data, getRegionalValue);
    const overIndexedJobs = data.reduce((sum, d) => sum + ((getRegionalValue(d) != null && getRegionalValue(d) >= 1.25) ? (d.jobs || 0) : 0), 0);
    const underIndexedJobs = data.reduce((sum, d) => sum + ((getRegionalValue(d) != null && getRegionalValue(d) <= 0.8) ? (d.jobs || 0) : 0), 0);
    const highest = highestByValue(data, getRegionalValue, 20_000);
    const lowest = lowestByValue(data, getRegionalValue, 20_000);

    cards = [
      { label: "Selected region", value: region, sub: "Nomis APS 2024 regional slice" },
      { label: "Avg regional index", value: formatRegionalIndex(avg), sub: "Job-weighted parent-group concentration vs UK mix", color: colorRegional(avg, 1) },
      { label: "Over-indexed jobs", value: `${((overIndexedJobs / meta.total_jobs) * 100).toFixed(0)}%`, sub: `${formatJobs(overIndexedJobs)} in occupations at 1.25x+ the UK mix` },
      { label: "Under-indexed jobs", value: `${((underIndexedJobs / meta.total_jobs) * 100).toFixed(0)}%`, sub: `${formatJobs(underIndexedJobs)} in occupations at 0.8x or less of the UK mix` },
      { label: "Most over-indexed large role", value: highest ? highest.title : "\u2014", sub: highest ? `${formatRegionalIndex(getRegionalValue(highest))} \u00b7 ${highest.minor_group_code}` : "\u2014" },
      { label: "Most under-indexed large role", value: lowest ? lowest.title : "\u2014", sub: lowest ? `${formatRegionalIndex(getRegionalValue(lowest))} \u00b7 ${lowest.minor_group_code}` : "\u2014" },
    ];
  } else if (App.colorMode === "concentration") {
    const avg = weightedAverage(data, "concentration");
    const concentratedJobs = data.reduce((sum, d) => sum + ((d.concentration != null && d.concentration >= 70) ? (d.jobs || 0) : 0), 0);
    const broadJobs = data.reduce((sum, d) => sum + ((d.concentration != null && d.concentration < 35) ? (d.jobs || 0) : 0), 0);
    const mostConcentrated = highestBy(data, "concentration", 20_000);
    const broadest = lowestBy(data, "concentration", 20_000);

    cards = [
      { label: "Reported jobs", value: formatJobs(meta.total_jobs), sub: `${meta.current_year} total across visible cells` },
      { label: "Occupations", value: formatNumber(meta.occupation_count), sub: "Treemap tiles" },
      { label: "Avg concentration", value: formatShare(avg), sub: "Job-weighted share of the top industry", color: colorConcentration(avg, 1) },
      { label: "Highly concentrated", value: `${((concentratedJobs / meta.total_jobs) * 100).toFixed(0)}%`, sub: `${formatJobs(concentratedJobs)} in occupations with 70%+ in one industry` },
      { label: "Broad occupations", value: `${((broadJobs / meta.total_jobs) * 100).toFixed(0)}%`, sub: `${formatJobs(broadJobs)} with no industry above 35%` },
      { label: "Most concentrated large role", value: mostConcentrated ? mostConcentrated.title : "\u2014", sub: mostConcentrated ? `${formatShare(mostConcentrated.concentration)} \u00b7 ${mostConcentrated.dominant_industry}` : (broadest ? `${broadest.title} ${formatShare(broadest.concentration)}` : "\u2014") },
    ];
  } else {
    const avg = weightedAverage(data, "exposure");
    const highExposureJobs = data.reduce((sum, d) => sum + ((d.exposure != null && d.exposure >= 7) ? (d.jobs || 0) : 0), 0);
    const lowExposureJobs = data.reduce((sum, d) => sum + ((d.exposure != null && d.exposure <= 3) ? (d.jobs || 0) : 0), 0);
    const highest = highestBy(data, "exposure", 20_000);
    const lowest = lowestBy(data, "exposure", 20_000);
    const scored = data.filter(d => d.exposure != null);
    const coverageJobs = scored.reduce((sum, d) => sum + (d.jobs || 0), 0);

    cards = [
      { label: "Scored occupations", value: formatNumber(scored.length), sub: `${((coverageJobs / meta.total_jobs) * 100).toFixed(0)}% of reported jobs covered` },
      { label: "Avg exposure", value: avg != null ? `${avg.toFixed(1)}/10` : "\u2014", sub: "Job-weighted AI exposure", color: colorExposure(avg, 1) },
      { label: "High exposure jobs", value: `${((highExposureJobs / meta.total_jobs) * 100).toFixed(0)}%`, sub: `${formatJobs(highExposureJobs)} in occupations scoring 7+` },
      { label: "Low exposure jobs", value: `${((lowExposureJobs / meta.total_jobs) * 100).toFixed(0)}%`, sub: `${formatJobs(lowExposureJobs)} in occupations scoring 0\u20133` },
      { label: "Most exposed large role", value: highest ? highest.title : "\u2014", sub: highest ? `${highest.exposure}/10 \u00b7 ${formatJobs(highest.jobs)}` : "\u2014" },
      { label: "Least exposed large role", value: lowest ? lowest.title : "\u2014", sub: lowest ? `${lowest.exposure}/10 \u00b7 ${formatJobs(lowest.jobs)}` : "\u2014" },
    ];
  }

  document.getElementById("statsTitle").textContent = MODES[App.colorMode].label;
  document.getElementById("statsGrid").innerHTML = cards.map(card => `
    <div class="stat-card">
      <div class="label">${card.label}</div>
      <div class="value" style="${card.color ? `color:${card.color};` : ""}">${card.value}</div>
      <div class="sub">${card.sub}</div>
    </div>
  `).join("");

  document.getElementById("canvasCaption").textContent =
    App.colorMode === "trend"
      ? "Colour shows recent reported employment change between 2021 and 2024. Area shows 2024 reported employment."
      : App.colorMode === "pay"
        ? "Colour shows 2024 median annual pay from ASHE Table 14. Area still shows 2024 reported employment."
        : App.colorMode === "regional"
          ? `Colour shows how over- or under-represented each tile's parent 3-digit SOC group is in ${App.selectedRegion || meta.default_region} relative to the UK mix. Area still shows 2024 reported employment.`
      : App.colorMode === "concentration"
        ? "Colour shows how concentrated each occupation is in its largest industry. Area still shows 2024 reported employment."
        : "Colour shows the LLM-scored AI exposure layer. Area still shows 2024 reported employment.";
}

/* ── Legend ─────────────────────────────────────────────── */

function drawLegend() {
  const legendCanvas = document.getElementById("legendCanvas");
  const legendCtx = legendCanvas.getContext("2d");
  const width = legendCanvas.width;
  const height = legendCanvas.height;

  for (let x = 0; x < width; x++) {
    const t = x / (width - 1);
    let fill;
    if (App.colorMode === "trend") {
      fill = colorTrend((t * 2 - 1) * 20, 1);
    } else if (App.colorMode === "pay") {
      const bounds = getPayBounds();
      fill = colorPay(bounds.min + (bounds.max - bounds.min) * t, 1);
    } else if (App.colorMode === "regional") {
      const maxDeviation = getRegionalMaxDeviation();
      fill = colorRegional(2 ** ((t * 2 - 1) * maxDeviation), 1);
    } else if (App.colorMode === "concentration") {
      fill = colorConcentration(t * 100, 1);
    } else {
      fill = colorExposure(t * 10, 1);
    }
    legendCtx.fillStyle = fill;
    legendCtx.fillRect(x, 0, 1, height);
  }

  document.getElementById("legendLow").textContent = MODES[App.colorMode].low;
  document.getElementById("legendHigh").textContent = MODES[App.colorMode].high;
}

/* ── Tooltip ───────────────────────────────────────────── */

function showTooltip(record, x, y) {
  const regionalJobs = getRegionalJobs(record);
  const regionalIndex = getRegionalValue(record);
  tooltip.querySelector(".tt-title").textContent = record.title;
  tooltip.querySelector(".tt-code").textContent = `SOC ${record.soc_code} \u00b7 ${record.category_label}`;
  tooltip.querySelector(".tt-grid").innerHTML = `
    <span class="label">Reported jobs</span><span class="value">${formatNumber(record.jobs || 0)}</span>
    <span class="label">Median pay</span><span class="value">${formatMoney(record.pay)}</span>
    <span class="label">2021\u21922024 trend</span><span class="value">${formatPct(record.trend)}</span>
    <span class="label">Top industry</span><span class="value">${record.dominant_industry || "\u2014"}</span>
    <span class="label">Top-industry share</span><span class="value">${formatShare(record.concentration)}</span>
    <span class="label">${App.selectedRegion || "Region"} index</span><span class="value">${formatRegionalIndex(regionalIndex)}</span>
    <span class="label">${App.selectedRegion || "Region"} parent jobs</span><span class="value">${regionalJobs == null ? "\u2014" : formatNumber(regionalJobs)}</span>
    <span class="label">AI exposure</span><span class="value">${record.exposure != null ? `${record.exposure}/10` : "\u2014"}</span>
    <span class="label">Suppressed cells</span><span class="value">${record.suppressed_cells || 0}</span>
  `;

  const top = (record.top_industries || [])
    .slice(0, 3)
    .map(item => `<strong>${item.code}</strong> ${item.label} (${formatJobs(item.jobs)})`)
    .join("<br>");
  const rationale = record.exposure_rationale
    ? `AI rationale:<br>${record.exposure_rationale}`
    : "";
  const regionalContext = record.minor_group_code
    ? `Regional mapping:<br><strong>${record.minor_group_code}</strong> ${record.minor_group_label || "Parent 3-digit SOC group"}`
    : "";
  tooltip.querySelector(".tt-top").innerHTML = [regionalContext, rationale, top ? `Top industries:<br>${top}` : ""]
    .filter(Boolean)
    .join("<br><br>") || "No reported industry breakdown";

  tooltip.classList.add("visible");
  const pad = 18;
  const tooltipRect = tooltip.getBoundingClientRect();
  let left = x + 18;
  let topY = y + 18;

  if (left + tooltipRect.width > window.innerWidth - pad) {
    left = x - tooltipRect.width - 18;
  }
  if (topY + tooltipRect.height > window.innerHeight - pad) {
    topY = y - tooltipRect.height - 18;
  }

  tooltip.style.left = `${Math.max(pad, left)}px`;
  tooltip.style.top = `${Math.max(pad, topY)}px`;
}

function hideTooltip() {
  tooltip.classList.remove("visible");
}

/* ── Search ────────────────────────────────────────────── */

function initSearch() {
  const input = document.getElementById("searchInput");
  const clearBtn = document.getElementById("searchClear");
  const countEl = document.getElementById("searchCount");
  const bar = document.querySelector(".search-bar");

  /* Shorter placeholder on mobile */
  if (window.innerWidth <= 500) {
    input.placeholder = "Search occupations…  ( / )";
  }

  let debounceTimer = null;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      App.searchQuery = input.value.trim();
      bar.classList.toggle("has-query", App.searchQuery.length > 0);

      if (App.searchQuery.length > 0) {
        const matched = App.getMatchedSlugs();
        countEl.textContent = `${matched.size} of ${App.data.length}`;
        countEl.classList.add("visible");
      } else {
        countEl.classList.remove("visible");
      }

      drawTreemap();
    }, 120);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      App.searchQuery = "";
      bar.classList.remove("has-query");
      countEl.classList.remove("visible");
      input.blur();
      drawTreemap();
    }
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    App.searchQuery = "";
    bar.classList.remove("has-query");
    countEl.classList.remove("visible");
    input.focus();
    drawTreemap();
  });

  /* Global keyboard shortcut: "/" to focus search, Escape to close detail panel */
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    }
    if (e.key === "Escape" && App.selectedOccupation) {
      closeDetail();
    }
  });
}

/* ── Mode switching ────────────────────────────────────── */

function setMode(nextMode) {
  App.colorMode = nextMode;
  document.querySelectorAll("#modeButtons button").forEach(button => {
    button.classList.toggle("active", button.dataset.mode === nextMode);
  });
  renderLayerOptions(App.payload.meta);
  buildStats();
  drawLegend();
  redraw();
}

/* ── Initialisation ────────────────────────────────────── */

function initializeUI() {
  const meta = App.payload.meta;
  App.selectedRegion = meta.default_region || "";
  document.getElementById("eyebrow").textContent = `${meta.geography} \u00b7 ${meta.source_name}`;
  document.getElementById("heroTitle").textContent = meta.title;
  const modeLabels = meta.available_layers
    .map(mode => MODES[mode]?.label.toLowerCase())
    .filter(Boolean);
  document.getElementById("heroText").textContent =
    `${meta.occupation_count} UK occupations sized by ${meta.current_year} employment. Colour by ${joinLabels(modeLabels)}.`;

  buildSummary(meta);
  buildModeButtons(meta);
  renderLayerOptions(meta);
  buildStats();
  drawLegend();
  initSearch();
  redraw();
}

/* ── Detail panel ──────────────────────────────────────── */

const detailPanel = document.getElementById("detailPanel");
const detailBackdrop = document.getElementById("detailBackdrop");

function openDetail(record) {
  App.selectedOccupation = record;

  /* Header */
  document.getElementById("dpTitle").textContent = record.title;
  document.getElementById("dpCode").textContent =
    `SOC ${record.soc_code} · ${record.category_label || ""}`;

  /* Key metrics */
  const metrics = [
    { label: "Reported jobs", value: formatNumber(record.jobs || 0) },
    { label: "Median pay", value: formatMoney(record.pay) },
    { label: "Trend 21→24", value: formatPct(record.trend) },
    { label: "AI exposure", value: record.exposure != null ? `${record.exposure}/10` : "—" },
  ];
  document.getElementById("dpMetrics").innerHTML = metrics.map(m => `
    <div class="dp-metric">
      <div class="value">${m.value}</div>
      <div class="label">${m.label}</div>
    </div>
  `).join("");

  /* Sparkline – 4-bar chart for yearly employment */
  drawSparkline(record);

  /* Top industries */
  const industries = (record.top_industries || []).slice(0, 6);
  const maxIndustryJobs = industries.length ? Math.max(...industries.map(i => i.jobs || 0)) : 1;
  document.getElementById("dpIndustries").innerHTML = industries.length
    ? industries.map(ind => {
        const pct = maxIndustryJobs ? ((ind.jobs || 0) / maxIndustryJobs) * 100 : 0;
        const share = record.jobs ? (((ind.jobs || 0) / record.jobs) * 100).toFixed(1) : "—";
        return `
          <div class="dp-bar-row">
            <div class="dp-bar-label">${ind.label || ind.code}</div>
            <div class="dp-bar-track">
              <div class="dp-bar-fill" style="width:${pct}%"></div>
            </div>
            <div class="dp-bar-value">${share}%</div>
          </div>`;
      }).join("")
    : "<p style='color:var(--muted)'>No industry breakdown available</p>";

  /* AI exposure */
  const aiSection = document.getElementById("dpAiSection");
  if (record.exposure != null) {
    aiSection.style.display = "";
    document.getElementById("dpAiScore").textContent = `${record.exposure}/10`;
    document.getElementById("dpAiRationale").textContent =
      record.exposure_rationale || "No rationale available.";
  } else {
    aiSection.style.display = "none";
  }

  /* Regional breakdown */
  const regSection = document.getElementById("dpRegionalSection");
  if (record.regional_lq && Object.keys(record.regional_lq).length) {
    regSection.style.display = "";
    const entries = Object.entries(record.regional_lq)
      .map(([region, lq]) => ({ region, lq }))
      .sort((a, b) => b.lq - a.lq);
    const maxLq = Math.max(...entries.map(e => e.lq), 1);
    document.getElementById("dpRegional").innerHTML = entries.map(e => {
      const pct = (e.lq / maxLq) * 100;
      const isSelected = e.region === App.selectedRegion;
      return `
        <div class="dp-regional-row${isSelected ? " dp-regional-selected" : ""}">
          <div class="dp-regional-label">${e.region}</div>
          <div class="dp-regional-bar">
            <div class="dp-regional-fill" style="width:${pct}%;background:${colorRegional(e.lq, 0.85)}"></div>
          </div>
          <div class="dp-regional-value">${formatRegionalIndex(e.lq)}</div>
        </div>`;
    }).join("");
  } else {
    regSection.style.display = "none";
  }

  /* Show panel */
  detailPanel.classList.add("open");
  detailBackdrop.classList.add("open");
}

function closeDetail() {
  App.selectedOccupation = null;
  detailPanel.classList.remove("open");
  detailBackdrop.classList.remove("open");
}

function drawSparkline(record) {
  const cvs = document.getElementById("dpSparkline");
  const ctx = cvs.getContext("2d");
  const w = cvs.width;
  const h = cvs.height;
  ctx.clearRect(0, 0, w, h);

  /* Extract yearly values from record */
  const years = [];
  for (const key of Object.keys(record)) {
    const m = key.match(/^jobs_(\d{4})$/);
    if (m) years.push({ year: +m[1], value: record[key] });
  }
  /* Add current year (stored as 'jobs') */
  const currentYear = +(App.payload.meta.current_year) || 2024;
  if (record.jobs && !years.find(y => y.year === currentYear)) {
    years.push({ year: currentYear, value: record.jobs });
  }
  years.sort((a, b) => a.year - b.year);

  if (!years.length) {
    ctx.fillStyle = "var(--muted)";
    ctx.font = "13px system-ui";
    ctx.fillText("No yearly data", 10, h / 2 + 4);
    return;
  }

  const maxVal = Math.max(...years.map(y => y.value || 0), 1);
  const barGap = 8;
  const barW = Math.min(48, (w - barGap * (years.length + 1)) / years.length);
  const totalW = years.length * barW + (years.length - 1) * barGap;
  const offsetX = (w - totalW) / 2;

  years.forEach((item, i) => {
    const barH = ((item.value || 0) / maxVal) * (h - 24);
    const x = offsetX + i * (barW + barGap);
    const y = h - barH - 16;

    /* Bar */
    ctx.fillStyle = "rgba(30, 109, 119, 0.7)";
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 3);
    ctx.fill();

    /* Year label */
    ctx.fillStyle = "#6f645b";
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(String(item.year), x + barW / 2, h - 2);

    /* Value label */
    ctx.fillStyle = "#1f1a16";
    ctx.font = "bold 10px system-ui";
    ctx.fillText(formatJobs(item.value), x + barW / 2, y - 4);
  });
}

/* ── Event listeners ───────────────────────────────────── */

const isTouchDevice = () => window.matchMedia("(pointer: coarse)").matches;

document.getElementById("modeButtons").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button) return;
  setMode(button.dataset.mode);
});

canvas.addEventListener("mousemove", (event) => {
  if (isTouchDevice()) return; /* skip tooltip on touch */
  const hit = hitTest(event.clientX, event.clientY);
  if (hit !== App.hovered) {
    App.hovered = hit;
    drawTreemap();
  }
  if (hit) {
    showTooltip(hit, event.clientX, event.clientY);
    canvas.style.cursor = "pointer";
  } else {
    hideTooltip();
    canvas.style.cursor = "default";
  }
});

canvas.addEventListener("mouseleave", () => {
  App.hovered = null;
  hideTooltip();
  drawTreemap();
});

canvas.addEventListener("click", (event) => {
  const hit = hitTest(event.clientX, event.clientY);
  if (hit) {
    hideTooltip();
    openDetail(hit);
  }
});

/* Detail panel close handlers */
document.getElementById("dpClose").addEventListener("click", closeDetail);
detailBackdrop.addEventListener("click", closeDetail);

window.addEventListener("resize", () => {
  dpr = window.devicePixelRatio || 1;
  redraw();
});

/* ── Data fetch ────────────────────────────────────────── */

fetch("data.json")
  .then(response => response.json())
  .then(json => {
    App.payload = Array.isArray(json)
      ? {
          meta: {
            title: "Job Market Visualizer",
            geography: "",
            source_name: "",
            source_detail: "",
            available_layers: ["trend"],
            available_regions: [],
            default_region: "",
            occupation_count: json.length,
            total_jobs: json.reduce((sum, item) => sum + (item.jobs || 0), 0),
            current_year: "",
            trend_period: "",
            notes: [],
          },
          occupations: json,
        }
      : json;
    App.data = (App.payload.occupations || []).filter(item => (item.jobs || 0) > 0);
    initializeUI();
  })
  .catch(error => {
    document.getElementById("heroText").textContent = `Failed to load data.json: ${error}`;
  });
