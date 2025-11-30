/* ===============================
   CONFIG
================================*/
const JSON_URL =
  "https://raw.githubusercontent.com/olamMat/TemperaturasRepo/refs/heads/main/ReporteTemperaturas.json";

let dataColumns = [];
let dataRows = [];
let secadoras = [];

/* ===============================
   THEME (auto + toggle)
================================*/
(function initTheme(){
  const saved = localStorage.getItem("ds_theme");
  if (saved){
    document.documentElement.setAttribute("data-theme", saved);
  } else {
    // respetar preferencia del sistema
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches){
      document.documentElement.setAttribute("data-theme", "light");
    }
  }
})();

document.addEventListener("click", (e)=>{
  if (e.target.id === "toggleTheme"){
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

function getQuickRows() {
  const quick = document.getElementById("quickRange").value;
  if (quick === "all") return dataRows;
  const hours = parseInt(quick);
  const limit = new Date(Date.now() - hours * 3600000);
  return dataRows.filter(r => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    return ts && ts >= limit;
  });
}

function stats(vals) {
  if (!vals.length) return { min: null, max: null, avg: null };
  return {
    min: Math.min(...vals),
    max: Math.max(...vals),
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
  };
}

/* ===============================
   TARJETAS KPI (colores + iconos)
================================*/
function renderCards() {
  const wrap = document.getElementById("statsCards");
  wrap.innerHTML = "";

  const rows = getQuickRows();
  if (!rows.length) return;

  const lastTs = parseDotNetDate(rows[0]["Time_Stamp"]);
  const since24 = new Date(lastTs.getTime() - 24 * 3600000);

  secadoras.forEach((sec) => {
    let values24 = [];
    let lastValue = null;
    let lastValueTime = null;
    let value1hAgo = null;

    rows.forEach((r) => {
      const ts = parseDotNetDate(r["Time_Stamp"]);
      const val = parseFloat(r[sec]);
      if (!isFinite(val)) return;

      if (!lastValue || ts > lastValueTime) {
        lastValue = val;
        lastValueTime = ts;
      }

      if (ts >= since24) values24.push(val);

      const ts1h = new Date(lastTs.getTime() - 3600000);
      if (ts <= ts1h) value1hAgo = val;
    });

    const s = stats(values24);

    // iconos por estado
    const iconMax = s.max != null ? (s.max>=60 ? "🔥" : (s.max>=50 ? "🌡️" : "🧊")) : "–";
    const iconAvg = s.avg != null ? (s.avg>=60 ? "🔥" : (s.avg>=50 ? "🌡️" : "🧊")) : "–";
    const iconLast = lastValue != null ? (lastValue>=60 ? "🔥" : (lastValue>=50 ? "🌡️" : "🧊")) : "–";

    let tendencia = "—";
    let trendIcon = "•";
    let colorTend = "inherit";
    if (value1hAgo != null && lastValue != null) {
      if (lastValue > value1hAgo) { tendencia = "Subiendo"; trendIcon="⬆"; colorTend="var(--good)"; }
      else if (lastValue < value1hAgo) { tendencia = "Bajando"; trendIcon="⬇"; colorTend="var(--bad)"; }
      else { tendencia = "Estable"; trendIcon="→"; colorTend="var(--warn)"; }
    }

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${sec}</h3>

      <div class="kpi-grid">

        <div class="kpi">
          <div class="label">Máximo 24h</div>
          <div class="badge" style="color:${colorTemp(s.max)}">${iconMax} <strong>${fmt(s.max)}</strong></div>
        </div>

        <div class="kpi">
          <div class="label">Mínimo 24h</div>
          <div class="badge" style="color:#4FA3F7">🧊 <strong>${fmt(s.min)}</strong></div>
        </div>

        <div class="kpi">
          <div class="label">Promedio 24h</div>
          <div class="badge" style="color:${colorTemp(s.avg)}">${iconAvg} <strong>${fmt(s.avg)}</strong></div>
        </div>

        <div class="kpi">
          <div class="label">Última lectura</div>
          <div class="badge" style="color:${colorTemp(lastValue)}">${iconLast} <strong>${fmt(lastValue)}</strong></div>
        </div>

        <div class="kpi">
          <div class="label">Registros 24h</div>
          <div class="badge" style="color:#8AB4F8">📄 <strong>${values24.length}</strong></div>
        </div>

        <div class="kpi">
          <div class="label">Tendencia (1h)</div>
          <div class="badge" style="color:${colorTend}">${trendIcon} <strong>${tendencia}</strong></div>
        </div>

      </div>
    `;
    wrap.appendChild(card);
  });
}

/* ===============================
   HEATMAP (con explicación)
================================*/
function renderHeatmap() {
  const wrap = document.getElementById("heatmap");
  wrap.innerHTML = `
    <p class="hm-help">
      El heatmap muestra el promedio térmico por secadora en cada hora de la ventana seleccionada.
      Verde = valores bajos, Amarillo = medios, Rojo = altos. Cada columna es una hora.
    </p>
  `;

  const rows = getQuickRows();
  if (!rows.length) return;

  const hoursWindow = 24;
  const lastTs = parseDotNetDate(rows[0]["Time_Stamp"]);
  const since = new Date(lastTs.getTime() - hoursWindow * 3600000);

  const buckets = {};
  rows.forEach((r) => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    if (!ts || ts < since) return;

    const hourKey = new Date(ts);
    hourKey.setMinutes(0,0,0);
    const hk = hourKey.getTime();

    secadoras.forEach((sec)=>{
      const v = parseFloat(r[sec]);
      if (!isFinite(v)) return;
      buckets[sec] ??= {};
      buckets[sec][hk] ??= [];
      buckets[sec][hk].push(v);
    });
  });

  const all = [];
  Object.values(buckets).forEach(obj => Object.values(obj).forEach(arr => all.push(...arr)));
  const gmin = Math.min(...all);
  const gmax = Math.max(...all);

  const colorFor = (v) => {
    if (!isFinite(v)) return "transparent";
    const t = (v - gmin) / (gmax - gmin || 1);
    const r = Math.round(255 * t);
    const g = Math.round(255 * (1 - t));
    return `rgb(${r},${g},50)`;
  };

  // 24 columnas (horas)
  const hours = [];
  const base = new Date(); base.setMinutes(0,0,0);
  for (let i=hoursWindow-1; i>=0; i--) hours.push(new Date(base.getTime() - i*3600000).getTime());

  secadoras.forEach((sec)=>{
    const row = document.createElement("div");
    row.className = "hm-row";

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = sec;
    row.appendChild(label);

    hours.forEach(hk=>{
      const cell = document.createElement("div");
      cell.className = "hm-cell";
      const arr = (buckets[sec]||{})[hk] || [];
      const avg = arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : NaN;
      cell.style.background = colorFor(avg);
      row.appendChild(cell);
    });

    wrap.appendChild(row);
  });
}

/* ===============================
   HISTORIAL (Diario y Semanal)
================================*/
function groupByDayWeek(rows) {
  // retorna { daily: Map(dayStr -> {sec-> [vals]}), weekly: Map(weekStr -> {sec->[vals]}) }
  const daily = new Map();
  const weekly = new Map();

  function weekKey(d){
    // Año-ISOWeek (simple): año + "W" + semana aproximada
    const firstJan = new Date(d.getFullYear(),0,1);
    const offset = Math.floor((d - firstJan)/86400000);
    const week = Math.floor((offset + firstJan.getDay()+6)/7) + 1;
    return `${d.getFullYear()}-W${String(week).padStart(2,'0')}`;
  }

  rows.forEach(r=>{
    const ts = parseDotNetDate(r["Time_Stamp"]);
    if (!ts) return;
    const day = `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}`;
    const wk = weekKey(ts);

    if (!daily.has(day)) daily.set(day, {});
    if (!weekly.has(wk)) weekly.set(wk, {});

    secadoras.forEach(sec=>{
      const v = parseFloat(r[sec]);
      if (!isFinite(v)) return;
      (daily.get(day)[sec] ||= []).push(v);
      (weekly.get(wk)[sec] ||= []).push(v);
    });
  });

  return { daily, weekly };
}

function renderHistoryTables() {
  const rows = getQuickRows();
  const { daily, weekly } = groupByDayWeek(rows);

  const renderTable = (map, containerId, label) => {
    const container = document.getElementById(containerId);
    if (map.size === 0){
      container.innerHTML = `<div class="muted">Sin datos ${label}.</div>`;
      return;
    }
    // header: Periodo + secadoras
    const header = `<tr><th>${label}</th>${secadoras.map(s=>`<th>${s}</th>`).join("")}</tr>`;
    const body = [...map.keys()].sort().map(key=>{
      const obj = map.get(key);
      const tds = secadoras.map(s=>{
        const vals = obj[s] || [];
        const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : NaN;
        return `<td style="color:${colorTemp(avg)}">${fmt(avg)}</td>`;
      }).join("");
      return `<tr><td><strong>${key}</strong></td>${tds}</tr>`;
    }).join("");

    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>${header}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  };

  renderTable(daily, "historyDaily", "Día");
  renderTable(weekly, "historyWeekly", "Semana");
}

/* ===============================
   TABLA DE DATOS
================================*/
function renderTable() {
  const rows = getQuickRows();

  document.getElementById("tableHead").innerHTML =
    `<tr>${dataColumns.map((c) => `<th>${c}</th>`).join("")}</tr>`;

  document.getElementById("tableBody").innerHTML =
    rows
      .map((r) => {
        return `<tr>${dataColumns
          .map((c) => {
            let v = r[c];
            if (c === "Time_Stamp") {
              const d = parseDotNetDate(v);
              if (d) {
                v = d.toLocaleString("es-NI", {
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit", second: "2-digit",
                });
              }
            }
            return `<td>${v ?? ""}</td>`;
          })
          .join("")}</tr>`;
      })
      .join("");

  document.getElementById("rowCount").textContent = rows.length + " filas";
}

/* ===============================
   EXPORTAR CSV / PDF
================================*/
function downloadCSVCurrentFilter() {
  const rows = getQuickRows();
  const headers = dataColumns.join(",");
  const body = rows.map(r =>
    dataColumns.map(c=>{
      let v = r[c];
      if (c==="Time_Stamp"){
        const d = parseDotNetDate(v);
        v = d ? d.toISOString() : v;
      }
      const s = String(v ?? "");
      return (s.includes(",")||s.includes('"')) ? `"${s.replaceAll('"','""')}"` : s;
    }).join(",")
  ).join("\n");
  const blob = new Blob([headers+"\n"+body], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "datos_filtrados.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportPDF() {
  const { jsPDF } = window.jspdf;
  const dashboard = document.getElementById("dashboard");

  const canvas = await html2canvas(dashboard, { scale: 2, backgroundColor: null });
  const imgData = canvas.toDataURL("image/png");

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const imgWidth = pageWidth - 10; // margen
  const imgHeight = canvas.height * imgWidth / canvas.width;

  let y = 5;
  if (imgHeight < pageHeight){
    pdf.addImage(imgData, "PNG", 5, y, imgWidth, imgHeight);
  } else {
    // multipágina
    let position = 0;
    const pageCanvas = document.createElement("canvas");
    const pageCtx = pageCanvas.getContext("2d");
    const ratio = canvas.width / imgWidth;
    const pageImgHeight = pageHeight * ratio;

    for (let page = 0; position < canvas.height; page++){
      pageCanvas.width = canvas.width;
      pageCanvas.height = Math.min(pageImgHeight, canvas.height - position);
      pageCtx.fillStyle = "#ffffff"; pageCtx.fillRect(0,0,pageCanvas.width,pageCanvas.height);
      pageCtx.drawImage(canvas, 0, position, pageCanvas.width, pageCanvas.height,
                               0, 0, pageCanvas.width, pageCanvas.height);
      const pageData = pageCanvas.toDataURL("image/png");
      if (page>0) pdf.addPage();
      pdf.addImage(pageData, "PNG", 5, 5, imgWidth, (pageCanvas.height / ratio));
      position += pageImgHeight;
    }
  }

  pdf.save(`Dashboard_Secadoras_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.pdf`);
}

/* ===============================
   RENDER ALL
================================*/
function renderAll() {
  renderCards();
  renderHeatmap();
  renderHistoryTables();
  renderTable();
}

/* ===============================
   INIT
================================*/
async function init() {
  try {
    const res = await fetch(JSON_URL + "?t=" + Date.now(), { cache: "no-store" });
    const json = await res.json();

    dataColumns = json.columns;
    dataRows = json.rows;

    secadoras = dataColumns.filter(c => c.toLowerCase().includes("secadora"));

    document.getElementById("lastUpdated").textContent =
      "Actualizado: " + new Date().toLocaleString();

    renderAll();
  } catch (e) {
    alert("Error cargando JSON: " + e.message);
    console.error(e);
  }
}

/* ===============================
   EVENTOS
================================*/
document.addEventListener("DOMContentLoaded", () => {
  init();

  document.getElementById("quickRange").onchange = renderAll;
  document.getElementById("downloadCSV").onclick = downloadCSVCurrentFilter;
  document.getElementById("exportPDF").onclick = exportPDF;

  // Tabs historial
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("historyDaily").classList.toggle("hidden", tab!=="daily");
      document.getElementById("historyWeekly").classList.toggle("hidden", tab!=="weekly");
    });
  });

  // Auto refresh cada 5 min
  setInterval(init, 5 * 60 * 1000);
});
