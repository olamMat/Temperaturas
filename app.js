/* ===============================
   CONFIG
================================*/
const JSON_URL =
  "https://raw.githubusercontent.com/olamMat/TemperaturasRepo/refs/heads/main/ReporteTemperaturas.json";

let dataColumns = [];
let dataRows = [];
let secadoras = [];

let selectedHeatmap = new Set();
let selectedTimeline = new Set();

// Mapa de hornos → secadoras (solo afecta al Timeline)
const HORNOS = {
  1: ["Secadora 1","Secadora 2","Secadora 3","Secadora 10","Secadora 11","Secadora 12"],
  2: ["Secadora 4","Secadora 5","Secadora 6","Secadora 13","Secadora 14","Secadora 15"],
  3: ["Secadora 7","Secadora 8","Secadora 9","Secadora 16","Secadora 17","Secadora 18"],
};

/* ===============================
   THEME
================================*/
(function initTheme() {
  const saved = localStorage.getItem("ds_theme");
  if (saved) {
    document.documentElement.setAttribute("data-theme", saved);
  } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
document.addEventListener("click", (e) => {
  if (e.target.id === "toggleTheme") {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("ds_theme", next);
  }
});

/* ===============================
   UTILIDADES
================================*/
function parseDotNetDate(str) {
  if (!str) return null;
  const m = /\/Date\((\d+)\)\//.exec(str);
  return m ? new Date(Number(m[1])) : null;
}
function fmt(v) {
  return v == null || isNaN(v) ? "—" : Number(v).toFixed(2);
}
function colorTemp(v) {
  if (v == null || isNaN(v)) return "inherit";
  if (v >= 60) return "var(--bad)";
  if (v >= 50) return "var(--warn)";
  return "var(--good)";
}
function formatLocalISO(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) +
    ":" + pad(d.getMinutes()) +
    ":" + pad(d.getSeconds())
  );
}

/* ===============================
   FILTROS DE RANGO
================================*/
function getQuickRows() {
  const quick = document.getElementById("quickRange").value;
  const hours = parseInt(quick);
  if (!isFinite(hours)) return dataRows;

  const limit = new Date(Date.now() - hours * 3600000);
  return dataRows.filter((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    return ts && ts >= limit;
  });
}
function getHeatmapRows() {
  const hmQuick = document.getElementById("heatmapQuick").value;
  const hours = parseInt(hmQuick);
  if (!isFinite(hours)) return dataRows;

  const limit = new Date(Date.now() - hours * 3600000);
  return dataRows.filter((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    return ts && ts >= limit;
  });
}

/* ===============================
   STATS
================================*/
function stats(vals) {
  const clean = vals.filter((v) => v != null && !isNaN(v) && v !== 0);
  if (!clean.length) return { min: null, max: null, avg: null };

  return {
    min: Math.min(...clean),
    max: Math.max(...clean),
    avg: clean.reduce((a, b) => a + b, 0) / clean.length,
  };
}

/* ===============================
   KPI
================================*/
function renderCards() {
  const wrap = document.getElementById("statsCards");
  wrap.innerHTML = "";

  const rows = getQuickRows();
  if (!rows.length) return;

  const lastTs = parseDotNetDate(rows[0]["Time_Stamp"]);
  const since24 = new Date(lastTs.getTime() - 24 * 3600000);

  secadoras.forEach((sec) => {
    let values24 = [],
      lastValue = null,
      lastValueTime = null,
      value1hAgo = null,
      count24 = 0;

    rows.forEach((r) => {
      const ts = parseDotNetDate(r["Time_Stamp"]);
      const val = parseFloat(r[sec]);
      if (!isFinite(val)) return;

      if (!lastValue || ts > lastValueTime) {
        lastValue = val;
        lastValueTime = ts;
      }
      if (ts >= since24) {
        values24.push(val);
        if (val !== 0) count24++;
      }
      const ts1h = new Date(lastTs.getTime() - 3600000);
      if (ts <= ts1h && val !== 0) value1hAgo = val;
    });

    const s = stats(values24);

    const iconMax = s.max != null ? (s.max >= 60 ? "🔥" : s.max >= 50 ? "🌡️" : "🧊") : "–";
    const iconAvg = s.avg != null ? (s.avg >= 60 ? "🔥" : s.avg >= 50 ? "🌡️" : "🧊") : "–";
    const iconLast =
      lastValue != null ? (lastValue >= 60 ? "🔥" : lastValue >= 50 ? "🌡️" : "🧊") : "–";

    let tendencia = "—",
      trendIcon = "•",
      colorTend = "inherit";
    if (value1hAgo != null && lastValue != null) {
      if (lastValue > value1hAgo) {
        tendencia = "Subiendo"; trendIcon = "⬆"; colorTend = "var(--good)";
      } else if (lastValue < value1hAgo) {
        tendencia = "Bajando";  trendIcon = "⬇"; colorTend = "var(--bad)";
      } else {
        tendencia = "Estable";  trendIcon = "→"; colorTend = "var(--warn)";
      }
    }

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${sec}</h3>
      <div class="kpi-grid">
        <div class="kpi"><div class="label">Máximo 24h</div>
          <div class="badge" style="color:${colorTemp(s.max)}">${iconMax} <strong>${fmt(s.max)}</strong></div>
        </div>
        <div class="kpi"><div class="label">Mínimo 24h</div>
          <div class="badge" style="color:#4FA3F7">🧊 <strong>${fmt(s.min)}</strong></div>
        </div>
        <div class="kpi"><div class="label">Promedio 24h</div>
          <div class="badge" style="color:${colorTemp(s.avg)}">${iconAvg} <strong>${fmt(s.avg)}</strong></div>
        </div>
        <div class="kpi"><div class="label">Última lectura</div>
          <div class="badge" style="color:${colorTemp(lastValue)}">${iconLast} <strong>${fmt(lastValue)}</strong></div>
        </div>
        <div class="kpi"><div class="label">Registros 24h (≠0)</div>
          <div class="badge" style="color:#8AB4F8">📄 <strong>${count24}</strong></div>
        </div>
        <div class="kpi"><div class="label">Tendencia (1h)</div>
          <div class="badge" style="color:${colorTend}">${trendIcon} <strong>${tendencia}</strong></div>
        </div>
      </div>`;
    wrap.appendChild(card);
  });
}

/* ===============================
   HEATMAP
================================*/
function colorByOptimal(v) {
  if (v == null || isNaN(v)) return "transparent";
  const blue = [0, 120, 255], green = [0, 200, 0], red = [255, 0, 0], darkRed = [139, 0, 0];
  const lerp = (a,b,t) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
  const rgb  = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

  if (v < 55) {
    const t = v / 55;
    return rgb([lerp(blue[0], green[0], t), lerp(blue[1], green[1], t), lerp(blue[2], green[2], t)]);
  }
  if (v <= 65) return rgb(green);
  const t = Math.min((v - 65) / 30, 1);
  return rgb([lerp(red[0], darkRed[0], t), lerp(red[1], darkRed[1], t), lerp(red[2], darkRed[2], t)]);
}

function buildHeatmapCheckboxes() {
  const box = document.getElementById("hmCheckboxes");
  box.innerHTML = secadoras
    .map((s) => `<label><input type="checkbox" value="${s}" ${selectedHeatmap.has(s) ? "checked" : ""}> ${s}</label>`)
    .join("");

  box.querySelectorAll("input").forEach((chk) => {
    chk.addEventListener("change", () => {
      if (chk.checked) selectedHeatmap.add(chk.value); else selectedHeatmap.delete(chk.value);
      renderHeatmap();
    });
  });

  document.getElementById("hmSelectAll").onclick = () => {
    secadoras.forEach((s) => selectedHeatmap.add(s));
    buildHeatmapCheckboxes(); renderHeatmap();
  };
  document.getElementById("hmClearAll").onclick = () => {
    selectedHeatmap.clear(); buildHeatmapCheckboxes(); renderHeatmap();
  };
}

function renderHeatmap() {
  const container = document.getElementById("heatmap");
  container.innerHTML = "";

  const rows = getHeatmapRows();
  if (!rows.length) return;

  const hoursWindow = parseInt(document.getElementById("heatmapQuick").value);
  const lastTs = parseDotNetDate(rows[0]["Time_Stamp"]);
  const since = new Date(lastTs.getTime() - hoursWindow * 3600000);

  const hours = [];
  for (let h = hoursWindow - 1; h >= 0; h--) {
    const d = new Date(lastTs.getTime() - h * 3600000);
    d.setMinutes(0, 0, 0);
    hours.push(d.getTime());
  }

  const header = document.createElement("div");
  header.className = "hm-header";
  header.style.gridTemplateColumns = `var(--label-w) ${hours.map(() => "var(--cell-w)").join(" ")}`;
  const lbl = document.createElement("div");
  lbl.className = "label"; lbl.textContent = "Secadora / Hora";
  header.appendChild(lbl);
  hours.forEach((hk) => {
    const d = new Date(hk);
    const col = document.createElement("div");
    col.className = "hm-hour";
    col.textContent = String(d.getHours()).padStart(2, "0");
    header.appendChild(col);
  });
  container.appendChild(header);

  if (selectedHeatmap.size === 0) {
    const row = document.createElement("div");
    row.className = "hm-row";
    row.innerHTML = `<div class="label">— Seleccioná al menos una secadora —</div>`;
    container.appendChild(row);
    return;
  }

  const buckets = {};
  rows.forEach((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    if (!ts || ts < since) return;
    const hour = new Date(ts); hour.setMinutes(0, 0, 0);
    const hk = hour.getTime();

    secadoras.forEach((sec) => {
      const v = parseFloat(r[sec]); if (!isFinite(v)) return;
      (buckets[sec] ||= {}); (buckets[sec][hk] ||= []).push(v);
    });
  });

  [...selectedHeatmap].forEach((sec) => {
    const row = document.createElement("div");
    row.className = "hm-row";
    row.style.gridTemplateColumns = `var(--label-w) ${hours.map(() => "var(--cell-w)").join(" ")}`;

    const l = document.createElement("div");
    l.className = "label"; l.textContent = sec; row.appendChild(l);

    hours.forEach((hk) => {
      const arr = (buckets[sec] || {})[hk] || [];
      const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;

      const cell = document.createElement("div");
      cell.className = "hm-cell";
      if (isNaN(avg)) {
        cell.style.background = "transparent";
      } else {
        cell.style.background = colorByOptimal(avg);
        cell.textContent = fmt(avg);
        cell.title = `${sec} – ${new Date(hk).toLocaleString("es-NI")} – ${fmt(avg)} °C`;
      }
      row.appendChild(cell);
    });

    container.appendChild(row);
  });
}

/* ===============================
   TIMELINE
================================*/
function seriesColor(index) {
  const hue = Math.round((index / Math.max(1, secadoras.length)) * 360);
  return `hsl(${hue}, 75%, 55%)`;
}

function buildTimelineCheckboxes() {
  const box = document.getElementById("timelineChecks");
  if (!box) return;

  box.innerHTML = secadoras
    .map((s, i) => {
      const checked = selectedTimeline.has(s) ? "checked" : "";
      const color = seriesColor(i);
      return `
        <label>
          <span class="color-dot" style="background:${color}"></span>
          <input type="checkbox" value="${s}" ${checked}> ${s}
        </label>`;
    })
    .join("");

  box.querySelectorAll("input").forEach((chk) => {
    chk.addEventListener("change", () => {
      if (chk.checked) selectedTimeline.add(chk.value);
      else selectedTimeline.delete(chk.value);
      renderTimeline();
    });
  });

  document.getElementById("tmSelectAll").onclick = () => {
    secadoras.forEach((s) => selectedTimeline.add(s));
    buildTimelineCheckboxes(); renderTimeline();
  };
  document.getElementById("tmClearAll").onclick = () => {
    selectedTimeline.clear();
    buildTimelineCheckboxes(); renderTimeline();
  };
}

// Bloque Hornos → solo afecta selección del Timeline
function buildHornosControls() {
  const cont = document.getElementById("hornosChecks");
  if (!cont) return;
  cont.innerHTML = `
    <label><input type="checkbox" class="chkHorno" value="1"> Horno 1</label>
    <label><input type="checkbox" class="chkHorno" value="2"> Horno 2</label>
    <label><input type="checkbox" class="chkHorno" value="3"> Horno 3</label>
    <button id="hornosClear" type="button">Limpiar</button>
  `;

  function applyHornos() {
    const checked = [...cont.querySelectorAll(".chkHorno:checked")].map(x => Number(x.value));
    if (checked.length === 0) return; // no cambia nada si no hay hornos marcados

    // Unión de secadoras de los hornos seleccionados
    const set = new Set();
    checked.forEach(h => (HORNOS[h] || []).forEach(s => set.add(s)));

    // Sustituye la selección del timeline por la de hornos
    selectedTimeline = set;

    buildTimelineCheckboxes();
    renderTimeline();
  }

  cont.querySelectorAll(".chkHorno").forEach(chk =>
    chk.addEventListener("change", applyHornos)
  );
  cont.querySelector("#hornosClear").addEventListener("click", () => {
    cont.querySelectorAll(".chkHorno").forEach(c => (c.checked = false));
    // No toca la selección existente; solo deja de forzar por hornos
  });
}

function renderTimeline() {
  const svg = document.getElementById("timelineSvg");
  svg.innerHTML = "";

  const selList = [...(selectedTimeline.size ? selectedTimeline : new Set(secadoras))];
  const range = document.getElementById("timelineRange").value;
  const rows = getQuickRows();

  if (!rows.length || selList.length === 0) return;

  const limit = isFinite(parseInt(range))
    ? new Date(Date.now() - parseInt(range) * 3600000)
    : null;

  const series = selList
    .map((sec) => {
      const pts = [];
      rows.forEach((r) => {
        const ts = parseDotNetDate(r["Time_Stamp"]);
        const val = parseFloat(r[sec]);
        if (!ts || isNaN(val)) return;
        if (limit && ts < limit) return;
        pts.push({ ts: ts.getTime(), val, rawTs: ts, sec });
      });
      return { sec, pts };
    })
    .filter((s) => s.pts.length);

  if (!series.length) return;

  const width = 1100, height = 520;
  const padL = 70, padR = 28, padT = 40, padB = 60;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const allPts = series.flatMap((s) => s.pts);
  const minTs = Math.min(...allPts.map((p) => p.ts));
  const maxTs = Math.max(...allPts.map((p) => p.ts));
  const minVal = Math.min(...allPts.map((p) => p.val));
  const maxVal = Math.max(...allPts.map((p) => p.val));

  const mapX = (ts) => padL + ((ts - minTs) / (maxTs - minTs || 1)) * (width - padL - padR);
  const mapY = (v)  => height - padB - ((v - minVal) / (maxVal - minVal || 1)) * (height - padT - padB);

  // Grid horizontal
  for (let i = 0; i <= 5; i++) {
    const yVal = minVal + (maxVal - minVal) * (i / 5);
    const y = mapY(yVal);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", padL); line.setAttribute("x2", width - padR);
    line.setAttribute("y1", y);    line.setAttribute("y2", y);
    line.setAttribute("stroke", "#3a3f4b");
    svg.appendChild(line);

    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("x", padL - 10); txt.setAttribute("y", y + 4);
    txt.setAttribute("text-anchor", "end"); txt.setAttribute("fill", "var(--muted)");
    txt.textContent = fmt(yVal); svg.appendChild(txt);
  }

  // ==========================
// TICKS REALES POR HORA
// ==========================
const hourTicks = [];
let cursor = new Date(minTs);
cursor.setMinutes(0, 0, 0);

// Generar ticks cada hora hasta llegar al último timestamp
while (cursor.getTime() <= maxTs) {
  hourTicks.push(cursor.getTime());
  cursor = new Date(cursor.getTime() + 3600000); // +1 hora
}

// Reducir ticks si hay demasiados
let step = 1;
if (hourTicks.length > 12) step = 2;
if (hourTicks.length > 24) step = 3;

hourTicks.forEach((ts, i) => {
  if (i % step !== 0) return;

  const x = mapX(ts);

  // Línea vertical
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("y1", padT);
  line.setAttribute("y2", height - padB);
  line.setAttribute("x1", x);
  line.setAttribute("x2", x);
  line.setAttribute("stroke", "#2c303b");
  svg.appendChild(line);

  // Etiqueta hora
  const d = new Date(ts);
  const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
  lbl.setAttribute("x", x);
  lbl.setAttribute("y", height - padB + 20);
  lbl.setAttribute("text-anchor", "middle");
  lbl.setAttribute("fill", "var(--muted)");
  lbl.textContent = String(d.getHours()).padStart(2, "0");
  svg.appendChild(lbl);
});


  // Series
  series.forEach((s, idx) => {
    let d = `M ${mapX(s.pts[0].ts)} ${mapY(s.pts[0].val)}`;
    s.pts.forEach((p) => (d += ` L ${mapX(p.ts)} ${mapY(p.val)}`));

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const color = seriesColor(idx);

    path.setAttribute("d", d);
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("fill", "none");
    svg.appendChild(path);

    try {
      const total = path.getTotalLength();
      path.style.strokeDasharray = total;
      path.style.strokeDashoffset = total;
      setTimeout(() => {
        path.style.transition = "stroke-dashoffset 1.2s ease";
        path.style.strokeDashoffset = "0";
      }, 30);
    } catch {}

    s.pts.forEach((p) => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", mapX(p.ts));
      c.setAttribute("cy", mapY(p.val));
      c.setAttribute("r", "3.5");
      c.setAttribute("fill", "#fff");
      c.setAttribute("stroke", color);
      c.addEventListener("mouseenter", (evt) => showTip(evt, p, color));
      c.addEventListener("mouseleave", hideTip);
      svg.appendChild(c);
    });
  });

  // Leyenda
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = series
    .map((s, idx) => `<span><span class="color-dot" style="background:${seriesColor(idx)}"></span>${s.sec}</span>`)
    .join("");

  const wrap = document.querySelector(".timeline");
  if (wrap) {
    const old = wrap.querySelector(".legend");
    if (old) old.remove();
    wrap.insertBefore(legend, wrap.querySelector(".timeline-viewport"));
  }

  // Tooltip
  const tooltip = document.createElement("div");
  tooltip.style.position = "fixed";
  tooltip.style.background = "rgba(0,0,0,0.75)";
  tooltip.style.color = "white";
  tooltip.style.padding = "6px 10px";
  tooltip.style.borderRadius = "6px";
  tooltip.style.pointerEvents = "none";
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  function showTip(evt, p, color) {
    tooltip.style.display = "block";
    tooltip.style.left = evt.clientX + 10 + "px";
    tooltip.style.top = evt.clientY + 10 + "px";
    tooltip.innerHTML =
      `<div style="font-weight:700; color:${color}">${p.sec}</div>` +
      `Temp: ${fmt(p.val)} °C<br>` +
      `Hora: ${p.rawTs.toLocaleString("es-NI")}`;
  }
  function hideTip() { tooltip.style.display = "none"; }
}

/* ===============================
   HISTORIAL
================================*/
function groupByDayWeek(rows) {
  const daily = new Map(), weekly = new Map();

  function weekKey(d) {
    const f = new Date(d.getFullYear(), 0, 1);
    const diff = Math.floor((d - f) / 86400000);
    const week = Math.floor((diff + f.getDay() + 6) / 7) + 1;
    return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }

  rows.forEach((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    if (!ts) return;

    const day = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2,"0")}-${String(ts.getDate()).padStart(2,"0")}`;
    const wk = weekKey(ts);

    if (!daily.has(day)) daily.set(day, {});
    if (!weekly.has(wk)) weekly.set(wk, {});

    secadoras.forEach((sec) => {
      const v = parseFloat(r[sec]);
      if (!isFinite(v) || v === 0) return;
      (daily.get(day)[sec] ||= []).push(v);
      (weekly.get(wk)[sec] ||= []).push(v);
    });
  });

  return { daily, weekly };
}
function renderHistoryTables() {
  const rows = getQuickRows();
  const { daily, weekly } = groupByDayWeek(rows);

  const renderTable = (map, id, label) => {
    const cont = document.getElementById(id);
    if (map.size === 0) {
      cont.innerHTML = "<div class='muted'>Sin datos.</div>";
      return;
    }

    const header = `<tr><th>${label}</th>${secadoras.map((s) => `<th>${s}</th>`).join("")}</tr>`;
    const body = [...map.keys()].sort().map((k) => {
      const obj = map.get(k);
      return `<tr><td><strong>${k}</strong></td>${secadoras.map((s) => {
        const arr = obj[s] || [];
        const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return `<td style="color:${colorTemp(avg)}">${fmt(avg)}</td>`;
      }).join("")}</tr>`;
    }).join("");

    cont.innerHTML = `<div class="table-wrapper"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
  };

  renderTable(daily, "historyDaily", "Día");
  renderTable(weekly, "historyWeekly", "Semana");
}

/* ===============================
   TABLA
================================*/
function renderTable() {
  const rows = getQuickRows();

  document.getElementById("tableHead").innerHTML =
    `<tr>${dataColumns.map((c) => `<th>${c}</th>`).join("")}</tr>`;

  document.getElementById("tableBody").innerHTML = rows
    .map((r) => {
      return `<tr>${dataColumns.map((c) => {
        let v = r[c];
        if (c === "Time_Stamp") {
          const d = parseDotNetDate(v);
          v = d
            ? d.toLocaleString("es-NI", {
                year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit", second: "2-digit",
              })
            : v;
        }
        return `<td>${v ?? ""}</td>`;
      }).join("")}</tr>`;
    })
    .join("");

  document.getElementById("rowCount").textContent = rows.length + " filas";
}

/* ===============================
   EXPORTS
================================*/
function downloadCSVCurrentFilter() {
  const rows = getQuickRows();
  const headers = dataColumns.join(",");
  const body = rows.map((r) =>
    dataColumns.map((c) => {
      let v = r[c];
      if (c === "Time_Stamp") {
        const d = parseDotNetDate(v);
        v = d ? formatLocalISO(d) : v;
      }
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
    }).join(",")
  ).join("\n");

  const blob = new Blob([headers + "\n" + body], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "datos.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportPDF() {
  const { jsPDF } = window.jspdf;
  const el = document.getElementById("dashboard");
  const canvas = await html2canvas(el, { scale: 2 });
  const img = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const w = pdf.internal.pageSize.getWidth() - 10;
  const h = (canvas.height * w) / canvas.width;
  pdf.addImage(img, "PNG", 5, 5, w, h);
  pdf.save("dashboard.pdf");
}

/* ===============================
   RENDER ALL
================================*/
function renderAll() {
  renderCards();
  renderTimeline();
  renderHeatmap();
  renderHistoryTables();
  renderTable();
}

/* ===============================
   INIT + REFRESH SOLO TIMELINE
================================*/
async function init() {
  try {
    const res = await fetch(JSON_URL + "?t=" + Date.now(), { cache: "no-store" });
    const json = await res.json();

    dataColumns = json.columns;
    dataRows = json.rows;

    secadoras = dataColumns.filter((c) => c.toLowerCase().includes("secadora"));

    if (selectedHeatmap.size === 0) secadoras.forEach((s) => selectedHeatmap.add(s));
    if (selectedTimeline.size === 0) secadoras.forEach((s) => selectedTimeline.add(s));

    buildHeatmapCheckboxes();
    buildTimelineCheckboxes();
    buildHornosControls();

    document.getElementById("lastUpdated").textContent = "Actualizado: " + new Date().toLocaleString();

    renderAll();
  } catch (e) {
    alert("Error al cargar JSON: " + e.message);
    console.error(e);
  }
}

// SOLO actualizar Timeline en intervalos (relee datos, pero no re-renderiza el resto)
async function refreshTimeline() {
  try {
    const res = await fetch(JSON_URL + "?t=" + Date.now(), { cache: "no-store" });
    const json = await res.json();
    dataRows = json.rows; // mantenemos columnas/controles; solo cambiaron filas
    renderTimeline();
  } catch (e) {
    console.error("Error refrescando timeline:", e);
  }
}

/* ===============================
   EVENTOS
================================*/
document.addEventListener("DOMContentLoaded", () => {
  init();

  document.getElementById("quickRange").onchange = renderAll;
  document.getElementById("heatmapQuick").onchange = renderHeatmap;
  document.getElementById("timelineRange").onchange = renderTimeline;

  document.getElementById("downloadCSV").onclick = downloadCSVCurrentFilter;
  document.getElementById("exportPDF").onclick = exportPDF;

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("historyDaily").classList.toggle("hidden", tab !== "daily");
      document.getElementById("historyWeekly").classList.toggle("hidden", tab !== "weekly");
    });
  });

  // Auto-refresh: SOLO Timeline
  setInterval(refreshTimeline, 5 * 60 * 1000);
});
