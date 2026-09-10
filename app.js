/* ===============================
   CONFIG
================================*/
const DATASETS = {
  horizontales: {
    label: "Secadoras",
    url: "https://temperaturas-dashboard-default-rtdb.firebaseio.com/ReporteTemperaturas.json",
    baseUrl: "https://temperaturas-dashboard-default-rtdb.firebaseio.com/ReporteTemperaturas",
    hornos: true,
  },
  verticales: {
    label: "Secadoras Verticales",
    url: "https://temperaturas-dashboard-default-rtdb.firebaseio.com/ReporteVerticales.json",
    baseUrl: "https://temperaturas-dashboard-default-rtdb.firebaseio.com/ReporteVerticales",
    hornos: false,
  },
};

const TURSO_CONFIG = {
  url: "https://temperaturas-db-olam.aws-us-east-1.turso.io",
  token: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg5NzYzNTQsImlkIjoiMDFhMDg3NGItNTQwMS03M2YyLTkxOTgtZjlhZGEyNDE4OGM2Iiwia2lkIjoiY0RqOXp4aUJQbnRqY2k0THNTZ25GdWpPR3B1ZGpDSHR2aDNhOVRHNG1ZQSIsInJpZCI6ImE3ZmY5OGQyLTdjZWYtNDU0Ni1iZWUxLTZkOWI4MjJiOTQ4ZCJ9.UDLMI1_55Ol9LMZnuhpkIxATbpzEKmB77vEo8n57tLc1825AtQL15RVKrVPVSc0FqlmKps3AEsfOzHH93FOGDg",
  tables: {
    horizontales: "ReporteTemperaturas",
    verticales: "ReporteVerticales",
  }
};

let activeBackend = localStorage.getItem("ds_backend") || "turso"; // "turso" o "firebase"

const FAST_LOAD_ROWS_LIMIT = 20000; // Cubre ~14 días de lecturas minuto a minuto
const REFRESH_ROWS_LIMIT = 200;      // Filas recientes en cada refresco (~20 KB)

let dataColumns = [];
let dataRows = [];
let secadoras = [];
let availableDates = [];
let selectedDate = "all";
let currentDataset = "horizontales";
let hasFullHistory = false;
let isRefreshing = false;
let lastRefreshTime = Date.now();

let selectedHeatmap = new Set();
let selectedTimeline = new Set();

const HORNOS = {
  1: ["Secadora 1","Secadora 2","Secadora 3","Secadora 10","Secadora 11","Secadora 12"],
  2: ["Secadora 4","Secadora 5","Secadora 6","Secadora 13","Secadora 14","Secadora 15"],
  3: ["Secadora 7","Secadora 8","Secadora 9","Secadora 16","Secadora 17","Secadora 18"],
};

// ECharts instances
let timelineChart = null;
let comparativeChart = null;
let gaugeCharts = {};

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
    // Update charts on theme change to apply new text colors
    setTimeout(() => {
        const isDark = next !== "light";
        const newTextColor = isDark ? '#e9ecf5' : '#1a1a1a';
        Object.values(gaugeCharts).forEach(c => {
             c.setOption({ series: [{ detail: { color: newTextColor } }] });
        });
        
        renderTimeline();
        if(comparativeChart && document.getElementById('echartsComparative').style.display === 'block') {
            renderComparativeChart();
        }
        resizeCharts();
    }, 100);
  }
});

/* ===============================
   UTILIDADES
================================*/
function parseDateSmart(str) {
  if (!str) return null;
  if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
  if (typeof str === "number") return new Date(str);

  // 1. Formato .NET JSON: /Date(1789056275000)/ o con timezone
  if (typeof str === "string") {
    const mDotNet = /\/Date\((-?\d+)(?:[+-]\d+)?\)\//.exec(str);
    if (mDotNet) {
      const d = new Date(Number(mDotNet[1]));
      return isNaN(d.getTime()) ? null : d;
    }
  }

  const s = String(str).trim();

  // 2. Si es string numérico puro (ms)
  if (/^\d{11,14}$/.test(s)) {
    const d = new Date(Number(s));
    if (!isNaN(d.getTime())) return d;
  }

  // 3. Formato YYYY-MM-DD HH:mm:ss o ISO
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s);
  if (m) {
    let y = parseInt(m[1], 10);
    let p1 = parseInt(m[2], 10);
    let p2 = parseInt(m[3], 10);
    let hh = m[4] != null ? parseInt(m[4], 10) : 0;
    let mm = m[5] != null ? parseInt(m[5], 10) : 0;
    let ss = m[6] != null ? parseInt(m[6], 10) : 0;

    let month = p1;
    let day = p2;

    // Corrección si viene en formato YYYY-DD-MM (donde p1 es día y p2 es mes)
    if (p1 > 12 && p2 <= 12) {
      day = p1;
      month = p2;
    } else if (p1 <= 12 && p2 <= 12) {
      // Si ambos <= 12, comprobar si con (p1=mes, p2=dia) la fecha queda en el futuro
      const testD1 = new Date(y, p1 - 1, p2, hh, mm, ss);
      const testD2 = new Date(y, p2 - 1, p1, hh, mm, ss);
      const now = new Date();
      const maxFuture = now.getTime() + 24 * 3600 * 1000;
      if (testD1.getTime() > maxFuture && testD2.getTime() <= maxFuture) {
        month = p2;
        day = p1;
      }
    }

    const d = new Date(y, month - 1, day, hh, mm, ss);
    return isNaN(d.getTime()) ? null : d;
  }

  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Alias para total compatibilidad con todas las funciones del dashboard
function parseDotNetDate(str) {
  return parseDateSmart(str);
}

function deduplicateRows(rows) {
  if (!rows || rows.length <= 1) return rows || [];
  const result = [];
  const seenKeys = new Set();

  for (const r of rows) {
    const d = parseDateSmart(r["Time_Stamp"]);
    if (!d) continue;

    // Detectar sensores
    const s1 = r["Secadora 1"] ?? r["Vertical 1"] ?? r["Secadora Vertical 1"] ?? "";
    const s2 = r["Secadora 2"] ?? r["Vertical 2"] ?? r["Secadora Vertical 2"] ?? "";
    const s3 = r["Secadora 3"] ?? r["Vertical 3"] ?? r["Secadora Vertical 3"] ?? "";

    // Clave de tiempo al minuto para filtrar duplicados UTC/Local
    const minTime = Math.floor(d.getTime() / 60000);
    const key = `${minTime}_${s1}_${s2}_${s3}`;

    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    result.push(r);
  }
  return result;
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
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
  );
}
function dayKey(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function getLatestTimestamp(rows) {
  let latest = null;
  rows.forEach((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    if (ts && (!latest || ts > latest)) latest = ts;
  });
  return latest;
}
function getAvailableDates(rows) {
  const set = new Set();
  rows.forEach((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    if (ts) set.add(dayKey(ts));
  });
  return [...set].sort((a, b) => b.localeCompare(a));
}
function getBaseRows() {
  if (selectedDate === "all") return dataRows;
  return dataRows.filter((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    return ts && dayKey(ts) === selectedDate;
  });
}
function rowsWithinHours(rows, hours) {
  if (!isFinite(hours)) return rows;
  const ref = getLatestTimestamp(rows);
  if (!ref) return [];
  const limit = new Date(ref.getTime() - hours * 3600000);
  return rows.filter((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    return ts && ts >= limit && ts <= ref;
  });
}
function getQuickRows() {
  const base = getBaseRows();
  const quick = document.getElementById("quickRange").value;
  return rowsWithinHours(base, parseInt(quick));
}
function getHeatmapRows() {
  const base = getBaseRows();
  const hmQuick = document.getElementById("heatmapQuick").value;
  return rowsWithinHours(base, parseInt(hmQuick));
}
function updateDateFilterOptions() {
  const sel = document.getElementById("dateFilter");
  if (!sel) return;
  let optionsHtml = `<option value="all">Todas las fechas cargadas</option>` +
    availableDates.map((d) => `<option value="${d}" ${d === selectedDate ? "selected" : ""}>${d}</option>`).join("");
  if (!hasFullHistory) {
    optionsHtml += `<option value="__load_all__">📥 Cargar más fechas (Historial completo)...</option>`;
  }
  sel.innerHTML = optionsHtml;
  sel.value = selectedDate || "all";
}

/* ===============================
   STATS & KPI (CON GAUGES Y PREDICCIÓN)
================================*/
function stats(vals) {
  const clean = vals.filter((v) => v != null && !isNaN(v) && v !== 0);
  if (!clean.length) return { min: null, max: null, avg: null };
  return { min: Math.min(...clean), max: Math.max(...clean), avg: clean.reduce((a, b) => a + b, 0) / clean.length };
}

function renderCards() {
  const wrap = document.getElementById("statsCards");
  wrap.innerHTML = "";
  
  // Dispose old gauges
  Object.values(gaugeCharts).forEach(c => c.dispose());
  gaugeCharts = {};

  const rows = getQuickRows();
  if (!rows.length) return;

  const lastTs = getLatestTimestamp(rows);
  if (!lastTs) return;
  const since24 = new Date(lastTs.getTime() - 24 * 3600000);

  secadoras.forEach((sec) => {
    let values24 = [], lastValue = null, lastValueTime = null, value1hAgo = null, time1hAgo = null, count24 = 0;

    rows.forEach((r) => {
      const ts = parseDotNetDate(r["Time_Stamp"]);
      const val = parseFloat(r[sec]);
      if (!isFinite(val)) return;

      if (!lastValue || ts > lastValueTime) {
        lastValue = val; lastValueTime = ts;
      }
      if (ts >= since24) {
        values24.push(val);
        if (val !== 0) count24++;
      }
      const ts1h = new Date(lastTs.getTime() - 3600000);
      if (ts <= ts1h && val !== 0 && (!time1hAgo || ts > time1hAgo)) {
          value1hAgo = val;
          time1hAgo = ts;
      }
    });

    const s = stats(values24);
    let tendencia = "—", trendIcon = "•", colorTend = "inherit", predictionTxt = "";

    if (value1hAgo != null && lastValue != null && time1hAgo != null) {
      if (lastValue > value1hAgo) {
        tendencia = "Subiendo"; trendIcon = "⬆"; colorTend = "var(--good)";
        
        // Predicción
        const tempDiff = lastValue - value1hAgo;
        const timeDiffMins = (lastValueTime - time1hAgo) / 60000;
        if (timeDiffMins > 0 && tempDiff > 0 && lastValue < 60) {
            const slopePerMin = tempDiff / timeDiffMins;
            const tempTo60 = 60 - lastValue;
            const minsTo60 = Math.round(tempTo60 / slopePerMin);
            if(minsTo60 < 120) {
                predictionTxt = `⚠️ Alerta predictiva: Alcanzará 60°C en aprox. ${minsTo60} min`;
            } else {
                predictionTxt = `✅ Tendencia segura (>${Math.round(minsTo60/60)}h para límite)`;
            }
        } else if (lastValue >= 60) {
            predictionTxt = `🔥 Temperatura Crítica Alcanzada`;
        }
      } else if (lastValue < value1hAgo) {
        tendencia = "Bajando";  trendIcon = "⬇"; colorTend = "var(--bad)";
        predictionTxt = `Enfriándose`;
      } else {
        tendencia = "Estable";  trendIcon = "→"; colorTend = "var(--warn)";
        predictionTxt = `Temperatura mantenida`;
      }
    }

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${sec}</h3>
      <div id="gauge-${sec.replace(/\s+/g, '')}" class="gauge-container"></div>
      <div class="kpi-grid">
        <div class="kpi"><div class="label">Máximo 24h</div><div class="badge" style="color:${colorTemp(s.max)}"><strong>${fmt(s.max)}</strong></div></div>
        <div class="kpi"><div class="label">Mínimo 24h</div><div class="badge" style="color:#4FA3F7"><strong>${fmt(s.min)}</strong></div></div>
        <div class="kpi"><div class="label">Promedio 24h</div><div class="badge" style="color:${colorTemp(s.avg)}"><strong>${fmt(s.avg)}</strong></div></div>
        <div class="kpi"><div class="label">Tendencia (1h)</div><div class="badge" style="color:${colorTend}">${trendIcon} <strong>${tendencia}</strong></div></div>
        ${predictionTxt ? `<div class="kpi-prediction" style="color:${lastValue >= 60 ? 'var(--bad)' : 'var(--warn)'}">${predictionTxt}</div>` : ''}
      </div>`;
    wrap.appendChild(card);
    
    // Init Gauge
    setTimeout(() => {
        const domId = `gauge-${sec.replace(/\s+/g, '')}`;
        const chartDom = document.getElementById(domId);
        if(chartDom) {
            const myChart = echarts.init(chartDom);
            gaugeCharts[sec] = myChart;
            const gaugeVal = lastValue != null ? parseFloat(lastValue.toFixed(1)) : 0;
            const isDark = document.documentElement.getAttribute("data-theme") !== "light";
            const textColor = isDark ? '#e9ecf5' : '#1a1a1a';
            
            myChart.setOption({
              series: [{
                type: 'gauge',
                min: 0, max: 100, splitNumber: 5,
                axisLine: {
                  lineStyle: {
                    width: 10,
                    color: [[0.5, '#4FA3F7'], [0.6, '#35c759'], [1, '#ff4d4f']]
                  }
                },
                pointer: { itemStyle: { color: 'auto' }, width: 4 },
                axisTick: { distance: -10, length: 4, lineStyle: { color: '#fff', width: 1 } },
                splitLine: { distance: -10, length: 10, lineStyle: { color: '#fff', width: 2 } },
                axisLabel: { color: 'auto', distance: 15, fontSize: 10 },
                detail: { valueAnimation: true, formatter: '{value} °C', color: textColor, fontSize: 16, offsetCenter: [0, '95%'] },
                data: [{ value: gaugeVal }]
              }]
            });
        }
    }, 0);
  });
}

/* ===============================
   TIMELINE (ECHARTS)
================================*/
function buildTimelineCheckboxes() {
  const box = document.getElementById("timelineChecks");
  if (!box) return;
  const selectAllBtn = document.getElementById("tmSelectAll");
  if (selectAllBtn) selectAllBtn.textContent = `Ver ${secadoras.length}`;

  box.innerHTML = secadoras.map((s, i) => {
      const checked = selectedTimeline.has(s) ? "checked" : "";
      return `<label><input type="checkbox" value="${s}" ${checked}> ${s}</label>`;
    }).join("");

  box.querySelectorAll("input").forEach((chk) => {
    chk.addEventListener("change", () => {
      if (chk.checked) selectedTimeline.add(chk.value); else selectedTimeline.delete(chk.value);
      renderTimeline();
    });
  });

  document.getElementById("tmSelectAll").onclick = () => { secadoras.forEach((s) => selectedTimeline.add(s)); buildTimelineCheckboxes(); renderTimeline(); };
  document.getElementById("tmClearAll").onclick = () => { selectedTimeline.clear(); buildTimelineCheckboxes(); renderTimeline(); };
}

function buildHornosControls() {
  const cont = document.getElementById("hornosChecks");
  const wrap = document.querySelector(".hornos-controls");
  if (!cont || !wrap) return;
  if (!DATASETS[currentDataset]?.hornos) { wrap.style.display = "none"; cont.innerHTML = ""; return; }
  wrap.style.display = "";
  cont.innerHTML = `
    <label><input type="checkbox" class="chkHorno" value="1"> Horno 1</label>
    <label><input type="checkbox" class="chkHorno" value="2"> Horno 2</label>
    <label><input type="checkbox" class="chkHorno" value="3"> Horno 3</label>
    <button id="hornosClear" type="button" style="padding:4px 8px; border-radius:6px; border:none; background:var(--card); color:var(--text); cursor:pointer;">Limpiar</button>
  `;
  function applyHornos() {
    const checked = [...cont.querySelectorAll(".chkHorno:checked")].map(x => Number(x.value));
    if (checked.length === 0) return;
    const set = new Set();
    checked.forEach(h => (HORNOS[h] || []).forEach(s => set.add(s)));
    selectedTimeline = set;
    buildTimelineCheckboxes(); renderTimeline();
  }
  cont.querySelectorAll(".chkHorno").forEach(chk => chk.addEventListener("change", applyHornos));
  cont.querySelector("#hornosClear").addEventListener("click", () => {
    cont.querySelectorAll(".chkHorno").forEach(c => (c.checked = false));
  });
}

function renderTimeline() {
  const rows = getQuickRows();
  const selList = [...(selectedTimeline.size ? selectedTimeline : new Set(secadoras))];
  const range = parseInt(document.getElementById("timelineRange").value);
  
  if (!rows.length || selList.length === 0) {
      if(timelineChart) timelineChart.clear();
      return;
  }

  const refTs = getLatestTimestamp(rows);
  const limit = isFinite(range) ? (refTs ? new Date(refTs.getTime() - range * 3600000) : null) : null;

  const seriesData = selList.map(sec => {
      const data = [];
      rows.forEach(r => {
          const ts = parseDotNetDate(r["Time_Stamp"]);
          const val = parseFloat(r[sec]);
          if(!ts || isNaN(val)) return;
          if(limit && ts < limit) return;
          data.push([ts.getTime(), val]);
      });
      return {
          name: sec,
          type: 'line',
          showSymbol: false,
          smooth: true,
          data: data.sort((a,b)=>a[0]-b[0])
      };
  });

  const chartDom = document.getElementById('echartsTimeline');
  if(!timelineChart) {
      timelineChart = echarts.init(chartDom);
  }
  
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const textColor = isDark ? '#e9ecf5' : '#1a1a1a';

  const chartTitle = selList.length <= 4 
      ? selList.join(', ') 
      : `${selList.length} secadoras seleccionadas`;

  timelineChart.setOption({
      backgroundColor: 'transparent',
      title: { 
          text: chartTitle, 
          textStyle: { color: textColor, fontSize: 14, fontWeight: 'normal' },
          left: 'center',
          top: 0
      },
      tooltip: { trigger: 'axis' },
      legend: { data: selList, type: 'scroll', textStyle: { color: textColor }, top: 25 },
      grid: { left: '3%', right: '4%', bottom: '15%', top: 70, containLabel: true },
      toolbox: { 
          feature: { 
              dataZoom: { yAxisIndex: 'none' }, 
              restore: {}, 
              saveAsImage: { 
                  name: 'LineaTiempo_' + (selList.length <= 3 ? selList.join('_').replace(/\s+/g,'') : selList.length + '_Secadoras') 
              } 
          } 
      },
      dataZoom: [{ type: 'inside', start: 0, end: 100 }, { start: 0, end: 100 }],
      xAxis: { type: 'time', splitLine: { show: false }, axisLabel: { color: textColor } },
      yAxis: { type: 'value', axisLabel: { color: textColor }, splitLine: { lineStyle: { color: isDark ? '#2c303b' : '#e0e0e0' } } },
      series: seriesData
  }, true);
}

/* ===============================
   HEATMAP
================================*/
function colorByOptimal(v) {
  if (v == null || isNaN(v)) return "transparent";
  const blue = [0, 120, 255], green = [0, 200, 0], red = [255, 0, 0], darkRed = [139, 0, 0];
  const lerp = (a,b,t) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
  const rgb  = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  if (v < 55) { const t = v / 55; return rgb([lerp(blue[0], green[0], t), lerp(blue[1], green[1], t), lerp(blue[2], green[2], t)]); }
  if (v <= 65) return rgb(green);
  const t = Math.min((v - 65) / 30, 1);
  return rgb([lerp(red[0], darkRed[0], t), lerp(red[1], darkRed[1], t), lerp(red[2], darkRed[2], t)]);
}
function buildHeatmapCheckboxes() {
  const box = document.getElementById("hmCheckboxes");
  box.innerHTML = secadoras.map((s) => `<label><input type="checkbox" value="${s}" ${selectedHeatmap.has(s) ? "checked" : ""}> ${s}</label>`).join("");
  box.querySelectorAll("input").forEach((chk) => {
    chk.addEventListener("change", () => { if (chk.checked) selectedHeatmap.add(chk.value); else selectedHeatmap.delete(chk.value); renderHeatmap(); });
  });
  document.getElementById("hmSelectAll").onclick = () => { secadoras.forEach((s) => selectedHeatmap.add(s)); buildHeatmapCheckboxes(); renderHeatmap(); };
  document.getElementById("hmClearAll").onclick = () => { selectedHeatmap.clear(); buildHeatmapCheckboxes(); renderHeatmap(); };
}
function renderHeatmap() {
  const container = document.getElementById("heatmap");
  container.innerHTML = "";
  const rows = getHeatmapRows();
  if (!rows.length) return;

  const hoursWindow = parseInt(document.getElementById("heatmapQuick").value);
  const lastTs = getLatestTimestamp(rows);
  if (!lastTs) return;
  const since = new Date(lastTs.getTime() - hoursWindow * 3600000);
  const hours = [];
  for (let h = hoursWindow - 1; h >= 0; h--) {
    const d = new Date(lastTs.getTime() - h * 3600000); d.setMinutes(0, 0, 0); hours.push(d.getTime());
  }

  const header = document.createElement("div"); header.className = "hm-header";
  header.style.gridTemplateColumns = `var(--label-w) ${hours.map(() => "var(--cell-w)").join(" ")}`;
  const lbl = document.createElement("div"); lbl.className = "label"; lbl.textContent = "Secadora / Hora"; header.appendChild(lbl);
  hours.forEach((hk) => { const col = document.createElement("div"); col.className = "hm-hour"; col.textContent = String(new Date(hk).getHours()).padStart(2, "0"); header.appendChild(col); });
  container.appendChild(header);

  if (selectedHeatmap.size === 0) return;

  const buckets = {};
  rows.forEach((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]); if (!ts || ts < since) return;
    const hour = new Date(ts); hour.setMinutes(0, 0, 0); const hk = hour.getTime();
    secadoras.forEach((sec) => { const v = parseFloat(r[sec]); if (!isFinite(v)) return; (buckets[sec] ||= {}); (buckets[sec][hk] ||= []).push(v); });
  });

  [...selectedHeatmap].forEach((sec) => {
    const row = document.createElement("div"); row.className = "hm-row"; row.style.gridTemplateColumns = `var(--label-w) ${hours.map(() => "var(--cell-w)").join(" ")}`;
    const l = document.createElement("div"); l.className = "label"; l.textContent = sec; row.appendChild(l);
    hours.forEach((hk) => {
      const arr = (buckets[sec] || {})[hk] || []; const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;
      const cell = document.createElement("div"); cell.className = "hm-cell";
      if (!isNaN(avg)) { cell.style.background = colorByOptimal(avg); cell.textContent = fmt(avg); cell.title = `${sec} – ${new Date(hk).toLocaleString("es-NI")} – ${fmt(avg)} °C`; }
      row.appendChild(cell);
    });
    container.appendChild(row);
  });
}

/* ===============================
   REPORTES (HISTORY, SHIFTS, EXCEPCIONES, UPTIME)
================================*/
function groupByMultiple(rows) {
  const daily = new Map(), weekly = new Map(), shifts = new Map();
  function weekKey(d) {
    const f = new Date(d.getFullYear(), 0, 1);
    const diff = Math.floor((d - f) / 86400000);
    const week = Math.floor((diff + f.getDay() + 6) / 7) + 1;
    return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  function shiftKey(d) {
      const h = d.getHours();
      const datePart = dayKey(d);
      // Turno Día: 06:00 - 17:59, Turno Noche: 18:00 - 05:59 (se cuenta para el día en que empieza)
      if(h >= 6 && h < 18) return `${datePart} Turno Día`;
      
      const prevDate = new Date(d.getTime() - 24*3600000);
      const targetDatePart = h >= 18 ? datePart : dayKey(prevDate);
      return `${targetDatePart} Turno Noche`;
  }

  rows.forEach((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    if (!ts) return;
    const day = dayKey(ts), wk = weekKey(ts), sh = shiftKey(ts);

    if (!daily.has(day)) daily.set(day, {});
    if (!weekly.has(wk)) weekly.set(wk, {});
    if (!shifts.has(sh)) shifts.set(sh, {});

    secadoras.forEach((sec) => {
      const v = parseFloat(r[sec]);
      if (!isFinite(v) || v === 0) return;
      (daily.get(day)[sec] ||= []).push(v);
      (weekly.get(wk)[sec] ||= []).push(v);
      (shifts.get(sh)[sec] ||= []).push(v);
    });
  });
  return { daily, weekly, shifts };
}

function renderTableHelper(map, id, label) {
    const cont = document.getElementById(id);
    if (!map || map.size === 0) { cont.innerHTML = "<div class='muted'>Sin datos.</div>"; return; }
    const header = `<tr><th>${label}</th>${secadoras.map((s) => `<th>${s}</th>`).join("")}</tr>`;
    const body = [...map.keys()].sort((a,b)=>b.localeCompare(a)).map((k) => {
      const obj = map.get(k);
      return `<tr><td><strong>${k}</strong></td>${secadoras.map((s) => {
        const arr = obj[s] || []; const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return `<td style="color:${colorTemp(avg)}">${fmt(avg)}</td>`;
      }).join("")}</tr>`;
    }).join("");
    cont.innerHTML = `<div class="table-wrapper"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
}

function renderUptime(rows) {
    const cont = document.getElementById("reportUptime");
    if (!rows.length) { cont.innerHTML = "<div class='muted'>Sin datos.</div>"; return; }
    
    // Uptime = (non-zero readings / total rows in window) * 100
    const totalRows = rows.length;
    let html = `<tr><th>Secadora</th><th>Registros Totales</th><th>Activa (Temp > 0)</th><th>% Tiempo Operativo</th></tr>`;
    
    secadoras.forEach(sec => {
        let active = 0;
        rows.forEach(r => {
            const v = parseFloat(r[sec]);
            if(isFinite(v) && v > 0) active++;
        });
        const pct = ((active / totalRows) * 100).toFixed(1);
        const color = pct > 80 ? 'var(--good)' : (pct > 50 ? 'var(--warn)' : 'var(--bad)');
        html += `<tr><td><strong>${sec}</strong></td><td>${totalRows}</td><td>${active}</td><td style="color:${color}; font-weight:bold;">${pct}%</td></tr>`;
    });
    cont.innerHTML = `<div class="table-wrapper"><table><thead>${html}</thead><tbody></tbody></table></div>`;
}

function renderExceptions(rows) {
    const cont = document.getElementById("reportExceptions");
    if (!rows.length) { cont.innerHTML = "<div class='muted'>Sin datos.</div>"; return; }
    
    const cfg = getAlertConfig();
    const threshold = Number(cfg.threshold) || 60;
    let html = `<tr><th>Fecha/Hora</th><th>Secadora</th><th>Temperatura</th><th>Umbral Superado</th><th>Acción</th></tr>`;
    let found = false;
    
    rows.forEach(r => {
        const ts = parseDotNetDate(r["Time_Stamp"]);
        secadoras.forEach(sec => {
            const v = parseFloat(r[sec]);
            if(isFinite(v) && v >= threshold) {
                found = true;
                const timeStr = ts ? ts.toLocaleString('es-NI') : '';
                const waText = encodeURIComponent(`🚨 *ALERTA DE SOBRECALENTAMIENTO*\n🔥 *Equipo:* ${sec}\n🌡️ *Temperatura:* ${v} °C\n⚠️ *Umbral Superado:* ${threshold} °C\n🕒 *Fecha/Hora:* ${timeStr}\n🏭 *Sistema:* Dashboard de Secadoras`);
                const waUrl = `https://api.whatsapp.com/send?text=${waText}`;
                html += `<tr>
                  <td>${timeStr}</td>
                  <td><strong>${sec}</strong></td>
                  <td style="color:var(--bad); font-weight:bold;">${v} °C</td>
                  <td>${threshold} °C</td>
                  <td><a href="${waUrl}" target="_blank" class="btn-wa" title="Compartir alerta por WhatsApp">📲 WhatsApp</a></td>
                </tr>`;
            }
        });
    });
    
    if(!found) {
        cont.innerHTML = `<div class='muted'>✅ No se registraron alertas de sobrecalentamiento (≥${threshold}°C) en la ventana actual.</div>`;
    } else {
        cont.innerHTML = `<div class="table-wrapper"><table><thead>${html}</thead><tbody></tbody></table></div>`;
    }
}

function renderHistoryTables() {
  const rows = getQuickRows();
  const { daily, weekly, shifts } = groupByMultiple(rows);
  renderTableHelper(daily, "historyDaily", "Día");
  renderTableHelper(weekly, "historyWeekly", "Semana");
  renderTableHelper(shifts, "historyShifts", "Turno (12h)");
  renderUptime(rows);
  renderExceptions(rows);
}

/* ===============================
   TABLA DATOS RAW
================================*/
function renderTable() {
  // Mostrar la fecha y hora más actual arriba
  const rows = getQuickRows().slice().reverse();
  document.getElementById("tableHead").innerHTML = `<tr>${dataColumns.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  document.getElementById("tableBody").innerHTML = rows.map((r) => {
      return `<tr>${dataColumns.map((c) => {
        let v = r[c];
        if (c === "Time_Stamp") { const d = parseDotNetDate(v); v = d ? formatLocalISO(d) : v; }
        return `<td>${v ?? ""}</td>`;
      }).join("")}</tr>`;
    }).join("");
  document.getElementById("rowCount").textContent = rows.length + " filas";
}

/* ===============================
   EXPORTS (EXCEL Y PDF)
================================*/
function setAutoColumnWidth(worksheet, data) {
  if (!data || !data.length) return;
  const colKeys = Object.keys(data[0]);
  worksheet["!cols"] = colKeys.map((key) => {
    let maxLen = String(key).length;
    const sampleLimit = Math.min(data.length, 500);
    for (let i = 0; i < sampleLimit; i++) {
      const valStr = data[i][key] != null ? String(data[i][key]) : "";
      if (valStr.length > maxLen) {
        maxLen = valStr.length;
      }
    }
    return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
  });
}

async function downloadExcelReport() {
  if (typeof XLSX === "undefined") {
    alert("Error: La librería de exportación a Excel no está disponible. Por favor recargue la página.");
    return;
  }

  if (!hasFullHistory && selectedDate === "all") {
    const wantFull = confirm(
      "Actualmente solo están cargadas en memoria las lecturas recientes (~3 a 5 días) para optimizar el consumo de datos.\n\n" +
      "¿Deseas descargar el historial completo de meses anteriores antes de generar el Excel?"
    );
    if (wantFull) {
      await loadFullHistory();
    }
  }

  const rows = getQuickRows();
  if (!rows || rows.length === 0) {
    alert("No hay datos en el rango seleccionado para exportar.");
    return;
  }

  const wb = XLSX.utils.book_new();

  // 1. Hoja: Lecturas Detalladas (Ventana actual filtrada)
  const detailedData = rows.map((r) => {
    const rowObj = {};
    dataColumns.forEach((col) => {
      let v = r[col];
      if (col === "Time_Stamp") {
        const d = parseDotNetDate(v);
        rowObj["Fecha y Hora"] = d ? formatLocalISO(d) : String(v ?? "");
      } else {
        const num = parseFloat(v);
        rowObj[col] = !isNaN(num) && isFinite(num) ? Number(num.toFixed(2)) : (v ?? "");
      }
    });
    return rowObj;
  });
  const wsLecturas = XLSX.utils.json_to_sheet(detailedData);
  setAutoColumnWidth(wsLecturas, detailedData);
  XLSX.utils.book_append_sheet(wb, wsLecturas, "Lecturas");

  // 2. Hoja: Resumen KPIs por Secadora/Equipo
  const lastTs = getLatestTimestamp(rows);
  const since24 = lastTs ? new Date(lastTs.getTime() - 24 * 3600000) : new Date(0);
  const totalRows = rows.length;

  const kpiData = secadoras.map((sec) => {
    let values24 = [], lastVal = null, lastValTime = null, val1hAgo = null, time1hAgo = null;
    let activeCount = 0;

    rows.forEach((r) => {
      const ts = parseDotNetDate(r["Time_Stamp"]);
      const v = parseFloat(r[sec]);
      if (!isFinite(v)) return;

      if (v > 0) activeCount++;

      if (!lastVal || (ts && ts > lastValTime)) {
        lastVal = v;
        lastValTime = ts;
      }
      if (ts && ts >= since24) {
        values24.push(v);
      }
      if (lastTs) {
        const ts1h = new Date(lastTs.getTime() - 3600000);
        if (ts && ts <= ts1h && v !== 0 && (!time1hAgo || ts > time1hAgo)) {
          val1hAgo = v;
          time1hAgo = ts;
        }
      }
    });

    const s = stats(values24);
    const pctUptime = totalRows ? Number(((activeCount / totalRows) * 100).toFixed(1)) : 0;

    let tendencia = "Estable";
    if (val1hAgo != null && lastVal != null) {
      if (lastVal > val1hAgo) tendencia = "Subiendo";
      else if (lastVal < val1hAgo) tendencia = "Bajando";
    }

    let estado = "Normal (<50°C)";
    if (lastVal >= 60) estado = "Crítico (>=60°C)";
    else if (lastVal >= 50) estado = "Advertencia (50-59°C)";

    return {
      "Secadora / Equipo": sec,
      "Última Temp (°C)": lastVal != null ? Number(lastVal.toFixed(2)) : "—",
      "Promedio Ventana (°C)": s.avg != null ? Number(s.avg.toFixed(2)) : "—",
      "Mínimo (°C)": s.min != null ? Number(s.min.toFixed(2)) : "—",
      "Máximo (°C)": s.max != null ? Number(s.max.toFixed(2)) : "—",
      "Lecturas Activas (>0°C)": activeCount,
      "Lecturas Totales": totalRows,
      "% Tiempo Operativo": `${pctUptime}%`,
      "Tendencia Reciente": tendencia,
      "Estado": estado
    };
  });
  const wsKPI = XLSX.utils.json_to_sheet(kpiData);
  setAutoColumnWidth(wsKPI, kpiData);
  XLSX.utils.book_append_sheet(wb, wsKPI, "Resumen KPIs");

  // 3. Hoja: Promedios Diarios
  const { daily, shifts } = groupByMultiple(rows);
  const dailyData = [...daily.keys()].sort((a, b) => b.localeCompare(a)).map((dayKey) => {
    const obj = daily.get(dayKey) || {};
    const rowObj = { "Fecha": dayKey };
    secadoras.forEach((sec) => {
      const arr = obj[sec] || [];
      const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      rowObj[sec] = avg != null ? Number(avg.toFixed(2)) : "—";
    });
    return rowObj;
  });
  if (dailyData.length > 0) {
    const wsDaily = XLSX.utils.json_to_sheet(dailyData);
    setAutoColumnWidth(wsDaily, dailyData);
    XLSX.utils.book_append_sheet(wb, wsDaily, "Promedios Diarios");
  }

  // 4. Hoja: Turnos (12h)
  const shiftsData = [...shifts.keys()].sort((a, b) => b.localeCompare(a)).map((shKey) => {
    const obj = shifts.get(shKey) || {};
    const rowObj = { "Turno": shKey };
    secadoras.forEach((sec) => {
      const arr = obj[sec] || [];
      const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      rowObj[sec] = avg != null ? Number(avg.toFixed(2)) : "—";
    });
    return rowObj;
  });
  if (shiftsData.length > 0) {
    const wsShifts = XLSX.utils.json_to_sheet(shiftsData);
    setAutoColumnWidth(wsShifts, shiftsData);
    XLSX.utils.book_append_sheet(wb, wsShifts, "Turnos 12h");
  }

  // 5. Hoja: Alertas de Sobrecalentamiento
  const cfg = getAlertConfig();
  const alertThreshold = Number(cfg.threshold) || 60;
  const exceptionsData = [];
  rows.forEach((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    secadoras.forEach((sec) => {
      const v = parseFloat(r[sec]);
      if (isFinite(v) && v >= alertThreshold) {
        exceptionsData.push({
          "Fecha y Hora": ts ? formatLocalISO(ts) : "",
          "Secadora / Equipo": sec,
          "Temperatura (°C)": Number(v.toFixed(2)),
          "Umbral Máximo (°C)": alertThreshold,
          "Exceso (°C)": Number((v - alertThreshold).toFixed(2)),
          "Severidad": "Sobrecalentamiento"
        });
      }
    });
  });
  const wsExceptions = exceptionsData.length > 0
    ? XLSX.utils.json_to_sheet(exceptionsData)
    : XLSX.utils.json_to_sheet([{ "Estado": "Sin alertas", "Detalle": `No se registraron temperaturas mayores o iguales a ${alertThreshold}°C en la ventana seleccionada.` }]);
  setAutoColumnWidth(wsExceptions, exceptionsData.length > 0 ? exceptionsData : [{ "Estado": "", "Detalle": "" }]);
  XLSX.utils.book_append_sheet(wb, wsExceptions, "Sobrecalentamiento");

  // Nombre de archivo descriptivo
  const dsLabel = DATASETS[currentDataset]?.label || (currentDataset === "verticales" ? "Verticales" : "Secadoras");
  const cleanLabel = dsLabel.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dateStr = selectedDate !== "all" ? selectedDate : "Historico";
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const fileName = `Reporte_${cleanLabel}_${dateStr}_${timestamp}.xlsx`;

  XLSX.writeFile(wb, fileName);
}

// Mantenemos la función CSV por si se requiere como respaldo
function downloadCSVCurrentFilter() {
  downloadExcelReport();
}

async function exportPDF() {
  const { jsPDF } = window.jspdf; const el = document.getElementById("dashboard");
  const canvas = await html2canvas(el, { scale: 2 }); const img = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4"); const w = pdf.internal.pageSize.getWidth() - 10;
  const h = (canvas.height * w) / canvas.width; pdf.addImage(img, "PNG", 5, 5, w, h); pdf.save("dashboard.pdf");
}

/* ===============================
   MODO TV / KIOSKO
================================*/
let tvScrollInterval = null;
function enterTvMode() {
    document.body.classList.add('tv-mode');
    
    // Add Exit Button dynamically if not exists
    if(!document.getElementById('btnExitTv')) {
        const btn = document.createElement('button');
        btn.id = 'btnExitTv';
        btn.innerHTML = '❌ Salir Modo TV';
        btn.onclick = exitTvMode;
        document.body.appendChild(btn);
    }
    
    // Auto-scroll loop
    const container = document.querySelector('.card-container');
    let scrollPos = 0;
    tvScrollInterval = setInterval(() => {
        if(container.scrollHeight <= container.clientHeight) return;
        scrollPos += 2; // px per tick
        if(scrollPos + container.clientHeight >= container.scrollHeight) {
            scrollPos = 0;
        }
        container.scrollTop = scrollPos;
    }, 50);
}
function exitTvMode() {
    document.body.classList.remove('tv-mode');
    if(tvScrollInterval) clearInterval(tvScrollInterval);
}

/* ===============================
   COMPARATIVA
================================*/
function initComparativeView() {
    const sSec = document.getElementById('compSecadora');
    const sD1 = document.getElementById('compDayBase');
    const sD2 = document.getElementById('compDayTarget');
    
    sSec.innerHTML = secadoras.map(s => `<option value="${s}">${s}</option>`).join("");
    const datesOpts = availableDates.map(d => `<option value="${d}">${d}</option>`).join("");
    sD1.innerHTML = datesOpts;
    sD2.innerHTML = datesOpts;
    
    if(availableDates.length > 1) {
        sD2.value = availableDates[1]; // default compare today vs yesterday
    }
    
    document.getElementById('btnCompare').onclick = renderComparativeChart;
}

function renderComparativeChart() {
    const sec = document.getElementById('compSecadora').value;
    const d1Str = document.getElementById('compDayBase').value;
    const d2Str = document.getElementById('compDayTarget').value;
    const chartDom = document.getElementById('echartsComparative');
    chartDom.style.display = 'block';
    
    if(!comparativeChart) comparativeChart = echarts.init(chartDom);
    
    const rows = dataRows;
    const d1Data = [], d2Data = [];
    
    rows.forEach(r => {
        const ts = parseDotNetDate(r["Time_Stamp"]);
        if(!ts) return;
        const val = parseFloat(r[sec]);
        if(isNaN(val)) return;
        
        const dKey = dayKey(ts);
        // Map to a common date (1970-01-01) for overlapping lines by hour/minute
        const timeOfDay = new Date(1970, 0, 1, ts.getHours(), ts.getMinutes(), ts.getSeconds()).getTime();
        
        if(dKey === d1Str) d1Data.push([timeOfDay, val]);
        if(dKey === d2Str) d2Data.push([timeOfDay, val]);
    });
    
    d1Data.sort((a,b)=>a[0]-b[0]);
    d2Data.sort((a,b)=>a[0]-b[0]);
    
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    const textColor = isDark ? '#e9ecf5' : '#1a1a1a';
    
    comparativeChart.setOption({
        title: { text: `Comparativa ${sec}`, textStyle: { color: textColor } },
        tooltip: { trigger: 'axis', formatter: function (params) {
            let res = new Date(params[0].value[0]).toLocaleTimeString() + '<br/>';
            params.forEach(p => res += p.seriesName + ': ' + p.value[1] + ' °C<br/>');
            return res;
        } },
        legend: { data: [d1Str, d2Str], textStyle: { color: textColor } },
        xAxis: { type: 'time', axisLabel: { formatter: '{HH}:{mm}', color: textColor } },
        yAxis: { type: 'value', axisLabel: { color: textColor } },
        series: [
            { name: d1Str, type: 'line', smooth: true, showSymbol: false, data: d1Data },
            { name: d2Str, type: 'line', smooth: true, showSymbol: false, data: d2Data, lineStyle:{type:'dashed'} }
        ]
    }, true);
}


/* ===============================
   RENDER ALL
================================*/
function resizeCharts() {
    if(timelineChart) timelineChart.resize();
    if(comparativeChart) comparativeChart.resize();
    Object.values(gaugeCharts).forEach(c => c.resize());
}
window.addEventListener('resize', resizeCharts);

function renderAll() {
  renderCards();
  renderTimeline();
  renderHeatmap();
  renderHistoryTables();
  renderTable();
}

function applyDatasetData(json, { resetSelections = true } = {}) {
  const backendLabel = activeBackend === "turso" ? "Turso" : "Firebase";
  if (!json || !json.rows || !json.rows.length) {
    console.warn(`No hay datos todavía en ${backendLabel}.`);
    document.getElementById("datasetTitle").textContent = `Sin datos en ${backendLabel}`;
    return;
  }
  
  dataColumns = json.columns || [];
  // Ordenar cronológicamente para que gráficos y líneas de tiempo fluyan del pasado al presente
  const sorted = (json.rows || []).slice().sort((a, b) => {
    const tsA = parseDateSmart(a["Time_Stamp"])?.getTime() || 0;
    const tsB = parseDateSmart(b["Time_Stamp"])?.getTime() || 0;
    return tsA - tsB;
  });
  dataRows = deduplicateRows(sorted);
  secadoras = dataColumns.filter((c) => { const l = c.toLowerCase(); return l.includes("secadora") || l.includes("vertical"); });
  availableDates = getAvailableDates(dataRows);
  if (selectedDate !== "all" && !availableDates.includes(selectedDate)) { selectedDate = availableDates[0] || "all"; }
  else if (selectedDate === "all" && availableDates.length) { selectedDate = availableDates[0]; }
  updateDateFilterOptions();
  if (!selectedHeatmap.size || resetSelections) selectedHeatmap = new Set(secadoras);
  if (!selectedTimeline.size || resetSelections) selectedTimeline = new Set(secadoras);
  buildHeatmapCheckboxes(); buildTimelineCheckboxes(); buildHornosControls();
  
  initComparativeView();
  document.getElementById("lastUpdated").textContent = `Actualizado (${backendLabel}): ` + new Date().toLocaleString();
  document.getElementById("datasetTitle").textContent = DATASETS[currentDataset]?.label || "Secadoras";
  renderAll();
  evaluateRealtimeAlerts(dataRows);
}

/* ===============================
   ALERTAS Y NOTIFICACIONES (TELEGRAM / OPENWA)
================================*/
const DEFAULT_ALERT_CONFIG = {
  threshold: 60,
  tgEnabled: false,
  tgToken: "",
  tgChatId: "",
  waEnabled: false,
  openwaUrl: "http://localhost:2785",
  openwaSession: "default",
  openwaApiKey: "",
  openwaPhone: ""
};

function getAlertConfig() {
  try {
    const saved = localStorage.getItem("alert_config");
    return saved ? { ...DEFAULT_ALERT_CONFIG, ...JSON.parse(saved) } : { ...DEFAULT_ALERT_CONFIG };
  } catch (e) {
    return { ...DEFAULT_ALERT_CONFIG };
  }
}

function saveAlertConfig(cfg) {
  localStorage.setItem("alert_config", JSON.stringify(cfg));
}

const lastAlertSentTime = new Map();
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos de espera entre alertas repetidas por secadora

async function sendTelegramAlert(message, cfg) {
  if (!cfg.tgToken || !cfg.tgChatId) return false;
  try {
    const url = `https://api.telegram.org/bot${cfg.tgToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.tgChatId,
        text: message,
        parse_mode: "HTML"
      })
    });
    return res.ok;
  } catch (err) {
    console.error("Error enviando Telegram:", err);
    return false;
  }
}

async function sendWhatsAppAlert(message, cfg) {
  if (!cfg.openwaUrl || !cfg.openwaSession || !cfg.openwaPhone) return false;
  try {
    const baseUrl = cfg.openwaUrl.trim().replace(/\/+$/, "");
    const session = encodeURIComponent(cfg.openwaSession.trim());
    const rawDest = cfg.openwaPhone.trim();
    // Si ya incluye @ (ej: @c.us o @g.us), usarlo tal cual; sino agregar @c.us
    const chatId = rawDest.includes("@") ? rawDest : `${rawDest.replace(/\D/g, "")}@c.us`;

    const url = `${baseUrl}/api/sessions/${session}/messages/send-text`;
    const headers = { "Content-Type": "application/json" };
    if (cfg.openwaApiKey && cfg.openwaApiKey.trim()) {
      headers["X-API-Key"] = cfg.openwaApiKey.trim();
    }

    const res = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        chatId: chatId,
        text: message
      })
    });
    return res.ok;
  } catch (err) {
    console.error("Error enviando WhatsApp OpenWA:", err);
    return false;
  }
}

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

// Desbloquear AudioContext en la interacción del usuario
document.addEventListener("click", () => {
  getAudioContext();
}, { once: false });

function playAlertSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Tono de alarma industrial: 4 pulsos sonoros
    const playTone = (startDelay, freq, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startDelay);
      gain.gain.setValueAtTime(0.3, ctx.currentTime + startDelay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startDelay + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + startDelay);
      osc.stop(ctx.currentTime + startDelay + duration);
    };

    playTone(0, 880, 0.22);
    playTone(0.28, 1174, 0.3);
    playTone(0.65, 880, 0.22);
    playTone(0.93, 1174, 0.4);
  } catch (e) {
    console.warn("Audio de alerta silenciado por el navegador:", e);
  }
}

function showBrowserNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>" });
  }
}

async function evaluateRealtimeAlerts(rows) {
  if (!rows || !rows.length) return;

  const cfg = getAlertConfig();
  const threshold = Number(cfg.threshold) || 60;
  const now = Date.now();
  const dsName = DATASETS[currentDataset]?.label || (currentDataset === "verticales" ? "Secadoras Verticales" : "Secadoras");

  // Obtener lectura más reciente por cada secadora
  const latestBySec = {};
  rows.forEach((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    if (!ts) return;
    secadoras.forEach((sec) => {
      const v = parseFloat(r[sec]);
      if (isFinite(v)) {
        if (!latestBySec[sec] || ts > latestBySec[sec].ts) {
          latestBySec[sec] = { ts, temp: v };
        }
      }
    });
  });

  let shouldPlaySound = false;

  for (const sec of secadoras) {
    const item = latestBySec[sec];
    if (!item) continue;
    if (item.temp >= threshold) {
      const lastSent = lastAlertSentTime.get(sec) || 0;
      // Sonar alarma con intervalo de 5 minutos por secadora
      if (now - lastSent >= 5 * 60 * 1000) {
        lastAlertSentTime.set(sec, now);
        shouldPlaySound = true;

        const timeStr = formatLocalISO(item.ts);
        showBrowserNotification(`🔥 Sobrecalentamiento en ${sec}`, `Temperatura: ${item.temp}°C (Umbral: ${threshold}°C) a las ${timeStr}`);

        if (cfg.tgEnabled) {
          const tgMsg = `🚨 <b>ALERTA DE SOBRECALENTAMIENTO</b>\n\n` +
            `🔥 <b>Equipo:</b> ${sec}\n` +
            `🌡️ <b>Temperatura:</b> ${item.temp} °C\n` +
            `⚠️ <b>Umbral Crítico:</b> ${threshold} °C\n` +
            `🕒 <b>Hora:</b> ${timeStr}\n` +
            `🏭 <b>Planta:</b> ${dsName}`;
          sendTelegramAlert(tgMsg, cfg);
        }
        if (cfg.waEnabled) {
          const waMsg = `🚨 *ALERTA DE SOBRECALENTAMIENTO*\n\n` +
            `🔥 *Equipo:* ${sec}\n` +
            `🌡️ *Temperatura:* ${item.temp} °C\n` +
            `⚠️ *Umbral Crítico:* ${threshold} °C\n` +
            `🕒 *Hora:* ${timeStr}\n` +
            `🏭 *Planta:* ${dsName}`;
          sendWhatsAppAlert(waMsg, cfg);
        }
      }
    }
  }

  if (shouldPlaySound) {
    playAlertSound();
  }
}

function updateBackendButtonState() {
  const btn = document.getElementById("btnBackendSwitch");
  if (!btn) return;
  if (activeBackend === "turso") {
    btn.textContent = "☁️ Base de Datos: Turso";
    btn.style.borderColor = "var(--good)";
    btn.style.color = "var(--good)";
  } else {
    btn.textContent = "🔥 Base de Datos: Firebase";
    btn.style.borderColor = "var(--warn)";
    btn.style.color = "var(--warn)";
  }
}

async function tursoQuery(sql, args = []) {
  const endpoint = `${TURSO_CONFIG.url}/v2/pipeline`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TURSO_CONFIG.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requests: [
        {
          type: "execute",
          stmt: {
            sql: sql,
            args: args.map(a => {
              if (a === null || a === undefined) return { type: "null" };
              if (typeof a === "number") return { type: "float", value: a };
              return { type: "text", value: String(a) };
            })
          }
        },
        { type: "close" }
      ]
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Turso HTTP Error (${res.status}): ${txt}`);
  }

  const data = await res.json();
  const first = data.results?.[0];
  if (first?.type === "error") {
    throw new Error(first.error?.message || "Error en Turso SQL");
  }

  const result = first?.response?.result;
  if (!result) return { columns: [], rows: [] };

  const cols = (result.cols || []).map(c => c.name);
  const rows = (result.rows || []).map(row => {
    const obj = {};
    row.forEach((cell, i) => {
      const col = cols[i];
      let val = cell.value;
      if (cell.type === "integer" && val != null) val = Number(val);
      if (cell.type === "float" && val != null) val = Number(val);
      obj[col] = val;
    });
    return obj;
  });

  return { columns: cols, rows: rows };
}

let tursoTablesReady = false;
async function ensureTursoTables() {
  if (tursoTablesReady) return;
  try {
    await tursoQuery(`
      CREATE TABLE IF NOT EXISTS ReporteTemperaturas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        Time_Stamp TEXT NOT NULL,
        "Secadora 1" REAL, "Secadora 2" REAL, "Secadora 3" REAL,
        "Secadora 4" REAL, "Secadora 5" REAL, "Secadora 6" REAL,
        "Secadora 7" REAL, "Secadora 8" REAL, "Secadora 9" REAL,
        "Secadora 10" REAL, "Secadora 11" REAL, "Secadora 12" REAL,
        "Secadora 13" REAL, "Secadora 14" REAL, "Secadora 15" REAL,
        "Secadora 16" REAL, "Secadora 17" REAL, "Secadora 18" REAL
      );
    `);
    await tursoQuery(`
      CREATE TABLE IF NOT EXISTS ReporteVerticales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        Time_Stamp TEXT NOT NULL,
        "Secadora Vertical 1" REAL, "Secadora Vertical 2" REAL,
        "Secadora Vertical 3" REAL, "Secadora Vertical 4" REAL,
        "Secadora Vertical 5" REAL, "Secadora Vertical 6" REAL
      );
    `);
    tursoTablesReady = true;
    console.log("[Dashboard] Tablas Turso inicializadas/verificadas.");
  } catch (err) {
    console.warn("Aviso verificando tablas Turso:", err);
  }
}

async function migrateFirebaseToTurso() {
  const confirmMsg = "🚀 ¿Deseas descargar los datos de Firebase y copiarlos a tu base de datos de Turso?\n\n" +
    "Esto transferirá el historial para que puedas usar Turso sin consumir cuota de Firebase.";
  if (!confirm(confirmMsg)) return;

  const btn = document.getElementById("btnMigrateToTurso");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Migrando datos...";
  }

  const dsTitle = document.getElementById("datasetTitle");
  const oldTitle = dsTitle ? dsTitle.textContent : "";

  try {
    await ensureTursoTables();
    
    const datasetsToMigrate = ["horizontales", "verticales"];
    
    for (const dKey of datasetsToMigrate) {
      const ds = DATASETS[dKey];
      const table = TURSO_CONFIG.tables[dKey];
      if (dsTitle) dsTitle.textContent = `Descargando ${ds.label} de Firebase...`;
      
      const res = await fetch(ds.url);
      const json = await res.json();
      if (!json || !json.rows || json.rows.length === 0) continue;
      
      const rows = json.rows;
      const cols = (json.columns || []).filter(c => c !== "id");
      
      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        const reqs = chunk.map(r => {
          const rowCols = cols.filter(c => r[c] !== undefined);
          const colNames = rowCols.map(c => `"${c}"`).join(", ");
          const placeholders = rowCols.map(() => "?").join(", ");
          const vals = rowCols.map(c => r[c]);
          return {
            type: "execute",
            stmt: {
              sql: `INSERT INTO ${table} (${colNames}) VALUES (${placeholders})`,
              args: vals.map(v => {
                if (v === null || v === undefined) return { type: "null" };
                if (typeof v === "number") return { type: "float", value: v };
                return { type: "text", value: String(v) };
              })
            }
          };
        });
        reqs.push({ type: "close" });

        await fetch(`${TURSO_CONFIG.url}/v2/pipeline`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${TURSO_CONFIG.token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ requests: reqs })
        });

        const pct = Math.round(((i + chunk.length) / rows.length) * 100);
        if (dsTitle) dsTitle.textContent = `Migrando ${ds.label} a Turso: ${pct}% (${i + chunk.length}/${rows.length})...`;
      }
    }

    alert("✅ ¡Migración a Turso completada con éxito!\nLos datos históricos ahora están en tu base de datos de Turso.");
    activeBackend = "turso";
    localStorage.setItem("ds_backend", "turso");
    updateBackendButtonState();
    loadDataset(currentDataset, { resetSelections: true });
  } catch (err) {
    console.error("Error en migración:", err);
    alert("Error durante la migración: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🚀 Migrar Firebase a Turso";
    }
    if (dsTitle) dsTitle.textContent = oldTitle;
  }
}

function updateFullHistoryButtonState() {
  const btn = document.getElementById("btnLoadFullHistory");
  if (!btn) return;
  if (hasFullHistory) {
    btn.disabled = true;
    btn.textContent = "✅ Historial completo";
    btn.style.opacity = "0.6";
  } else {
    btn.disabled = false;
    btn.textContent = "📥 Cargar Historial";
    btn.style.opacity = "1";
  }
}

async function loadFullHistory() {
  if (hasFullHistory) return;
  const btn = document.getElementById("btnLoadFullHistory");
  const oldText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Descargando historial...";
  }

  try {
    if (activeBackend === "turso") {
      const table = TURSO_CONFIG.tables[currentDataset];
      const resTurso = await tursoQuery(`SELECT * FROM ${table} ORDER BY id ASC`);
      if (resTurso && resTurso.rows && resTurso.rows.length > 0) {
        hasFullHistory = true;
        dataColumns = resTurso.columns.filter(c => c !== "id");
        const sorted = resTurso.rows.slice().sort((a, b) => {
          const tsA = parseDateSmart(a["Time_Stamp"])?.getTime() || 0;
          const tsB = parseDateSmart(b["Time_Stamp"])?.getTime() || 0;
          return tsA - tsB;
        });
        dataRows = deduplicateRows(sorted);
        availableDates = getAvailableDates(dataRows);
        updateDateFilterOptions();
        renderAll();
        updateFullHistoryButtonState();
        console.log(`[Dashboard] Historial completo Turso: ${dataRows.length} registros.`);
        return;
      }
    }

    // Fallback Firebase
    const ds = DATASETS[currentDataset];
    if (!ds) return;
    const res = await fetch(ds.url + "?t=" + Date.now(), { cache: "no-store" });
    const json = await res.json();
    if (json && json.rows) {
      hasFullHistory = true;
      dataColumns = json.columns || dataColumns;
      const sorted = (json.rows || []).slice().sort((a, b) => {
        const tsA = parseDateSmart(a["Time_Stamp"])?.getTime() || 0;
        const tsB = parseDateSmart(b["Time_Stamp"])?.getTime() || 0;
        return tsA - tsB;
      });
      dataRows = deduplicateRows(sorted);
      availableDates = getAvailableDates(dataRows);
      updateDateFilterOptions();
      renderAll();
      updateFullHistoryButtonState();
      console.log(`[Dashboard] Historial completo Firebase: ${dataRows.length} registros.`);
    }
  } catch (e) {
    console.error("Error al descargar historial completo:", e);
    alert("Error al descargar historial completo: " + e.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }
}

async function loadDataset(key, { resetSelections = true, forceFull = false } = {}) {
  currentDataset = key;
  hasFullHistory = forceFull;
  updateFullHistoryButtonState();
  updateBackendButtonState();

  try {
    const ds = DATASETS[key];
    if (!ds) throw new Error("Dataset no encontrado");
    document.querySelectorAll(".ds-btn").forEach((b) => b.classList.toggle("active", b.dataset.dataset === key));

    document.getElementById("datasetTitle").textContent = "Cargando datos...";

    let json = null;

    // 1. Intentar con Turso si está activo
    if (activeBackend === "turso") {
      try {
        await ensureTursoTables();
        const table = TURSO_CONFIG.tables[key];
        const limit = forceFull ? 60000 : FAST_LOAD_ROWS_LIMIT;
        // Obtenemos las filas más recientes ordenadas por id DESC
        const resTurso = await tursoQuery(`SELECT * FROM ${table} ORDER BY id DESC LIMIT ${limit}`);
        
        if (resTurso && resTurso.rows && resTurso.rows.length > 0) {
          const cleanCols = resTurso.columns.filter(c => c !== "id");
          const sorted = resTurso.rows.slice().sort((a, b) => {
            const tsA = parseDateSmart(a["Time_Stamp"])?.getTime() || 0;
            const tsB = parseDateSmart(b["Time_Stamp"])?.getTime() || 0;
            return tsA - tsB;
          });
          const dedup = deduplicateRows(sorted);
          json = { columns: cleanCols, rows: dedup };
          console.log(`[Dashboard] Datos cargados desde Turso: ${dedup.length} registros ordenados.`);
        } else {
          console.warn("[Dashboard] Turso no devolvió filas. Intentando con Firebase...");
        }
      } catch (errTurso) {
        console.warn("[Dashboard] Error consultando Turso, usando fallback Firebase:", errTurso);
      }
    }

    // 2. Fallback Firebase si Turso no devolvió datos o no está activo
    if (!json) {
      if (!forceFull && ds.baseUrl) {
        try {
          const [colsRes, rowsRes] = await Promise.all([
            fetch(`${ds.baseUrl}/columns.json`),
            // En Firebase RTDB las claves más recientes son 0, 1, 2... (usar limitToFirst)
            fetch(`${ds.baseUrl}/rows.json?orderBy="$key"&limitToFirst=${FAST_LOAD_ROWS_LIMIT}`)
          ]);

          if (colsRes.ok && rowsRes.ok) {
            const cols = await colsRes.json();
            const rawRows = await rowsRes.json();
            if (cols && rawRows) {
              const rowsArray = Array.isArray(rawRows) ? rawRows : Object.values(rawRows);
              json = { columns: cols, rows: rowsArray };
            }
          }
        } catch (errFast) {
          console.warn("[Dashboard] Carga rápida Firebase no disponible:", errFast);
        }
      }

      if (!json) {
        const res = await fetch(ds.url + "?t=" + Date.now(), { cache: "no-store" });
        json = await res.json();
        hasFullHistory = true;
        updateFullHistoryButtonState();
      }
    }

    applyDatasetData(json, { resetSelections });
  } catch (e) {
    alert("Error al cargar datos: " + e.message);
    console.error(e);
  }
}

async function refreshTimeline() {
  if (isRefreshing) return;

  if (document.hidden && !document.body.classList.contains("tv-mode")) {
    return;
  }

  isRefreshing = true;
  lastRefreshTime = Date.now();

  try {
    const ds = DATASETS[currentDataset];
    if (!ds) return;

    let refreshed = false;

    // Refresco con Turso
    if (activeBackend === "turso") {
      try {
        const table = TURSO_CONFIG.tables[currentDataset];
        const resTurso = await tursoQuery(`SELECT * FROM ${table} ORDER BY id DESC LIMIT ${REFRESH_ROWS_LIMIT}`);
        if (resTurso && resTurso.rows && resTurso.rows.length > 0) {
          const existingTimestamps = new Set(dataRows.map(r => {
            const d = parseDateSmart(r["Time_Stamp"]);
            return d ? d.getTime() : null;
          }).filter(Boolean));

          const freshRows = [];
          for (const r of resTurso.rows) {
            const d = parseDateSmart(r["Time_Stamp"]);
            if (d && !existingTimestamps.has(d.getTime())) {
              existingTimestamps.add(d.getTime());
              freshRows.push(r);
            }
          }

          if (freshRows.length > 0) {
            const merged = dataRows.concat(freshRows).sort((a, b) => {
              const tsA = parseDateSmart(a["Time_Stamp"])?.getTime() || 0;
              const tsB = parseDateSmart(b["Time_Stamp"])?.getTime() || 0;
              return tsA - tsB;
            });
            dataRows = deduplicateRows(merged);
            availableDates = getAvailableDates(dataRows);
            if (selectedDate !== "all" && !availableDates.includes(selectedDate)) {
              selectedDate = availableDates[0] || "all";
            }
            updateDateFilterOptions();
            console.log(`[Dashboard] Refresco incremental Turso: +${freshRows.length} nuevas lecturas.`);
          }

          renderTimeline();
          if (document.body.classList.contains("tv-mode")) renderCards();
          evaluateRealtimeAlerts(dataRows);
          document.getElementById("lastUpdated").textContent = "Actualizado (Turso): " + new Date().toLocaleString();
          refreshed = true;
        }
      } catch (errTurso) {
        console.warn("[Dashboard] Error refrescando desde Turso:", errTurso);
      }
    }

    // Refresco con Firebase si Turso no está activo o falló
    if (!refreshed) {
      if (ds.baseUrl && dataRows && dataRows.length > 0) {
        try {
          const res = await fetch(`${ds.baseUrl}/rows.json?orderBy="$key"&limitToFirst=${REFRESH_ROWS_LIMIT}`);
          if (res.ok) {
            const raw = await res.json();
            if (raw) {
              const incoming = Array.isArray(raw) ? raw : Object.values(raw);
              const existingTimestamps = new Set(dataRows.map((r) => {
                const d = parseDateSmart(r["Time_Stamp"]);
                return d ? d.getTime() : null;
              }).filter(Boolean));
              const freshRows = incoming.filter((r) => {
                const d = parseDateSmart(r["Time_Stamp"]);
                return d && !existingTimestamps.has(d.getTime());
              });

              if (freshRows.length > 0) {
                const merged = dataRows.concat(freshRows).sort((a, b) => {
                  const tsA = parseDateSmart(a["Time_Stamp"])?.getTime() || 0;
                  const tsB = parseDateSmart(b["Time_Stamp"])?.getTime() || 0;
                  return tsA - tsB;
                });
                dataRows = deduplicateRows(merged);
                availableDates = getAvailableDates(dataRows);
                if (selectedDate !== "all" && !availableDates.includes(selectedDate)) {
                  selectedDate = availableDates[0] || "all";
                }
                updateDateFilterOptions();
                console.log(`[Dashboard] Refresco incremental Firebase: +${freshRows.length} lecturas.`);
              }

              renderTimeline();
              if (document.body.classList.contains("tv-mode")) renderCards();
              evaluateRealtimeAlerts(dataRows);
              document.getElementById("lastUpdated").textContent = "Actualizado (Firebase): " + new Date().toLocaleString();
              refreshed = true;
            }
          }
        } catch (errInc) {
          console.warn("[Dashboard] Refresco incremental no disponible, usando fallback:", errInc);
        }
      }

      if (!refreshed) {
        const res = await fetch(ds.url + "?t=" + Date.now(), { cache: "no-store" });
        const json = await res.json();
        const incoming = json.rows || [];
        const sorted = incoming.slice().sort((a, b) => {
          const tsA = parseDateSmart(a["Time_Stamp"])?.getTime() || 0;
          const tsB = parseDateSmart(b["Time_Stamp"])?.getTime() || 0;
          return tsA - tsB;
        });
        dataRows = deduplicateRows(sorted);
        availableDates = getAvailableDates(dataRows);
        if (selectedDate !== "all" && !availableDates.includes(selectedDate)) {
          selectedDate = availableDates[0] || "all";
        }
        updateDateFilterOptions();
        renderTimeline();
        if (document.body.classList.contains("tv-mode")) renderCards();
        evaluateRealtimeAlerts(dataRows);
        document.getElementById("lastUpdated").textContent = "Actualizado (Firebase): " + new Date().toLocaleString();
      }
    }
  } catch (e) {
    console.error("Error refrescando timeline:", e);
  } finally {
    isRefreshing = false;
  }
}

/* ===============================
   EVENTOS
================================*/
document.addEventListener("DOMContentLoaded", () => {
  loadDataset(currentDataset);

  document.getElementById("quickRange").onchange = renderAll;
  document.getElementById("heatmapQuick").onchange = renderHeatmap;
  document.getElementById("timelineRange").onchange = renderTimeline;
  document.getElementById("dateFilter").onchange = async (e) => {
    if (e.target.value === "__load_all__") {
      await loadFullHistory();
      return;
    }
    selectedDate = e.target.value || "all";
    renderAll();
  };
  
  const btnFullHistory = document.getElementById("btnLoadFullHistory");
  if (btnFullHistory) {
    btnFullHistory.onclick = loadFullHistory;
  }

  const btnBackend = document.getElementById("btnBackendSwitch");
  if (btnBackend) {
    btnBackend.onclick = () => {
      activeBackend = activeBackend === "turso" ? "firebase" : "turso";
      localStorage.setItem("ds_backend", activeBackend);
      updateBackendButtonState();
      loadDataset(currentDataset, { resetSelections: true });
    };
  }

  document.getElementById("btnTvMode").onclick = enterTvMode;

  document.querySelectorAll(".ds-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.dataset; if (!key || key === currentDataset) return;
      document.querySelectorAll(".ds-btn").forEach((b) => b.classList.toggle("active", b === btn));
      selectedHeatmap.clear(); selectedTimeline.clear(); selectedDate = "all";
      hasFullHistory = false;
      loadDataset(key, { resetSelections: true });
    });
  });

  const btnExcel = document.getElementById("downloadExcel") || document.getElementById("downloadCSV");
  if (btnExcel) btnExcel.onclick = downloadExcelReport;
  document.getElementById("exportPDF").onclick = exportPDF;

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active")); btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("historyDaily").classList.toggle("hidden", tab !== "daily");
      document.getElementById("historyWeekly").classList.toggle("hidden", tab !== "weekly");
      document.getElementById("historyShifts").classList.toggle("hidden", tab !== "shifts");
      document.getElementById("reportUptime").classList.toggle("hidden", tab !== "uptime");
      document.getElementById("reportExceptions").classList.toggle("hidden", tab !== "exceptions");
      document.getElementById("reportComparative").classList.toggle("hidden", tab !== "comparative");
      if(tab === "comparative" && comparativeChart) comparativeChart.resize();
    });
  });

  // Configuración de Notificaciones (Telegram / WhatsApp)
  const alertModal = document.getElementById("alertModal");
  const btnAlertSettings = document.getElementById("btnAlertSettings");
  const closeAlertModal = document.getElementById("closeAlertModal");
  const btnSaveAlertConfig = document.getElementById("btnSaveAlertConfig");
  const btnTestTg = document.getElementById("btnTestTg");
  const btnTestWa = document.getElementById("btnTestWa");
  const alertTestStatus = document.getElementById("alertTestStatus");

  function populateAlertModal() {
    const cfg = getAlertConfig();
    const elTh = document.getElementById("cfgAlertThreshold");
    if (elTh) elTh.value = cfg.threshold ?? 60;
    const elTgEn = document.getElementById("cfgTgEnabled");
    if (elTgEn) elTgEn.checked = !!cfg.tgEnabled;
    const elTgTok = document.getElementById("cfgTgToken");
    if (elTgTok) elTgTok.value = cfg.tgToken || "";
    const elTgChat = document.getElementById("cfgTgChatId");
    if (elTgChat) elTgChat.value = cfg.tgChatId || "";
    const elWaEn = document.getElementById("cfgWaEnabled");
    if (elWaEn) elWaEn.checked = !!cfg.waEnabled;
    const elWaUrl = document.getElementById("cfgOpenwaUrl");
    if (elWaUrl) elWaUrl.value = cfg.openwaUrl || "http://localhost:2785";
    const elWaSession = document.getElementById("cfgOpenwaSession");
    if (elWaSession) elWaSession.value = cfg.openwaSession || "default";
    const elWaKey = document.getElementById("cfgOpenwaApiKey");
    if (elWaKey) elWaKey.value = cfg.openwaApiKey || "";
    const elWaPh = document.getElementById("cfgOpenwaPhone");
    if (elWaPh) elWaPh.value = cfg.openwaPhone || "";
    if (alertTestStatus) alertTestStatus.textContent = "";
  }

  if (btnAlertSettings) {
    btnAlertSettings.onclick = () => {
      populateAlertModal();
      if (alertModal) alertModal.style.display = "flex";
    };
  }

  if (closeAlertModal) {
    closeAlertModal.onclick = () => {
      if (alertModal) alertModal.style.display = "none";
    };
  }

  if (alertModal) {
    alertModal.onclick = (e) => {
      if (e.target === alertModal) alertModal.style.display = "none";
    };
  }

  if (btnSaveAlertConfig) {
    btnSaveAlertConfig.onclick = async () => {
      const cfg = {
        threshold: parseFloat(document.getElementById("cfgAlertThreshold").value) || 60,
        tgEnabled: document.getElementById("cfgTgEnabled").checked,
        tgToken: document.getElementById("cfgTgToken").value.trim(),
        tgChatId: document.getElementById("cfgTgChatId").value.trim(),
        waEnabled: document.getElementById("cfgWaEnabled").checked,
        openwaUrl: document.getElementById("cfgOpenwaUrl").value.trim() || "http://localhost:2785",
        openwaSession: document.getElementById("cfgOpenwaSession").value.trim() || "default",
        openwaApiKey: document.getElementById("cfgOpenwaApiKey").value.trim(),
        openwaPhone: document.getElementById("cfgOpenwaPhone").value.trim()
      };
      saveAlertConfig(cfg);

      if ("Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch (e) {}
      }

      if (alertTestStatus) {
        alertTestStatus.style.color = "var(--good)";
        alertTestStatus.textContent = "✅ Configuración guardada correctamente.";
      }
      setTimeout(() => {
        if (alertModal) alertModal.style.display = "none";
        renderHistoryTables();
      }, 1000);
    };
  }

  if (btnTestTg) {
    btnTestTg.onclick = async () => {
      if (alertTestStatus) {
        alertTestStatus.style.color = "var(--text)";
        alertTestStatus.textContent = "⏳ Enviando prueba a Telegram...";
      }
      const testCfg = {
        tgToken: document.getElementById("cfgTgToken").value.trim(),
        tgChatId: document.getElementById("cfgTgChatId").value.trim()
      };
      if (!testCfg.tgToken || !testCfg.tgChatId) {
        if (alertTestStatus) {
          alertTestStatus.style.color = "var(--bad)";
          alertTestStatus.textContent = "❌ Ingrese el Bot Token y Chat ID de Telegram.";
        }
        return;
      }
      const msg = `🧪 <b>Prueba de Alerta Exitosa</b>\nEl Dashboard de Secadoras se ha conectado correctamente con Telegram.`;
      const ok = await sendTelegramAlert(msg, testCfg);
      if (alertTestStatus) {
        if (ok) {
          alertTestStatus.style.color = "var(--good)";
          alertTestStatus.textContent = "✅ ¡Mensaje enviado con éxito a Telegram!";
        } else {
          alertTestStatus.style.color = "var(--bad)";
          alertTestStatus.textContent = "❌ Error al enviar. Verifique su Bot Token y Chat ID.";
        }
      }
    };
  }

  if (btnTestWa) {
    btnTestWa.onclick = async () => {
      if (alertTestStatus) {
        alertTestStatus.style.color = "var(--text)";
        alertTestStatus.textContent = "⏳ Conectando con OpenWA Gateway...";
      }
      const testCfg = {
        openwaUrl: document.getElementById("cfgOpenwaUrl").value.trim() || "http://localhost:2785",
        openwaSession: document.getElementById("cfgOpenwaSession").value.trim() || "default",
        openwaApiKey: document.getElementById("cfgOpenwaApiKey").value.trim(),
        openwaPhone: document.getElementById("cfgOpenwaPhone").value.trim()
      };
      if (!testCfg.openwaUrl || !testCfg.openwaSession || !testCfg.openwaPhone) {
        if (alertTestStatus) {
          alertTestStatus.style.color = "var(--bad)";
          alertTestStatus.textContent = "❌ Complete la URL de OpenWA, el Nombre de Sesión y el Destino.";
        }
        return;
      }
      const msg = `🧪 *Prueba de Alerta Exitosa*\nEl Dashboard de Secadoras se ha conectado correctamente con OpenWA Gateway.`;
      const ok = await sendWhatsAppAlert(msg, testCfg);
      if (alertTestStatus) {
        if (ok) {
          alertTestStatus.style.color = "var(--good)";
          alertTestStatus.textContent = "✅ ¡Mensaje enviado con éxito vía OpenWA Gateway!";
        } else {
          alertTestStatus.style.color = "var(--bad)";
          alertTestStatus.textContent = "❌ No se pudo conectar a OpenWA. Verifique que el servidor esté activo, la sesión conectada y la API Key.";
        }
      }
    };
  }

  // Refrescar al reenfocar la pestaña si estuvo oculta más de 2 minutos
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      const elapsed = Date.now() - lastRefreshTime;
      if (elapsed >= 2 * 60 * 1000) {
        refreshTimeline();
      }
    }
  });

  setInterval(refreshTimeline, 5 * 60 * 1000);
});