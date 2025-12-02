/* ===============================
   CONFIG
================================*/
const JSON_URL =
  "https://raw.githubusercontent.com/olamMat/TemperaturasRepo/refs/heads/main/ReporteTemperaturas.json";

let dataColumns = [];
let dataRows = [];
let secadoras = [];
let selectedHeatmap = new Set(); // checks

/* ===============================
   THEME
================================*/
(function initTheme(){
  const saved = localStorage.getItem("ds_theme");
  if (saved){
    document.documentElement.setAttribute("data-theme", saved);
  } else if (window.matchMedia('(prefers-color-scheme: light)').matches){
    document.documentElement.setAttribute("data-theme", "light");
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
function parseDotNetDate(str){
  if (!str) return null;
  const m = /\/Date\((\d+)\)\//.exec(str);
  return m ? new Date(Number(m[1])) : null;
}
function fmt(v){ return v == null || isNaN(v) ? "—" : Number(v).toFixed(2); }
function colorTemp(v){
  if (v == null || isNaN(v)) return "inherit";
  if (v >= 60) return "var(--bad)";
  if (v >= 50) return "var(--warn)";
  return "var(--good)";
}
function formatLocalISO(d){
  // YYYY-MM-DD HH:mm:ss en zona local
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function getQuickRows(){
  const quick = document.getElementById("quickRange").value;
  if (quick === "all") return dataRows;
  const hours = parseInt(quick);
  const limit = new Date(Date.now() - hours * 3600000);
  return dataRows.filter(r=>{
    const ts = parseDotNetDate(r["Time_Stamp"]);
    return ts && ts >= limit;
  });
}
function stats(vals){
  // SOLO ignorar ceros en KPI promedio
  const clean = vals.filter(v => v != null && !isNaN(v) && v !== 0);
  if (!clean.length) return { min:null, max:null, avg:null };
  return {
    min: Math.min(...clean),
    max: Math.max(...clean),
    avg: clean.reduce((a,b)=>a+b,0) / clean.length
  };
}

/* ===============================
   KPI
================================*/
function renderCards(){
  const wrap = document.getElementById("statsCards");
  wrap.innerHTML = "";

  const rows = getQuickRows();
  if (!rows.length) return;

  const lastTs = parseDotNetDate(rows[0]["Time_Stamp"]);
  const since24 = new Date(lastTs.getTime() - 24*3600000);

  secadoras.forEach(sec=>{
    let values24=[], lastValue=null, lastValueTime=null, value1hAgo=null, count24=0;

    rows.forEach(r=>{
      const ts=parseDotNetDate(r["Time_Stamp"]);
      const val=parseFloat(r[sec]);
      if (!isFinite(val)) return;

      if (!lastValue || ts>lastValueTime){ lastValue=val; lastValueTime=ts; }
      if (ts >= since24){ values24.push(val); if (val!==0) count24++; }

      const ts1h=new Date(lastTs.getTime()-3600000);
      if (ts<=ts1h && val!==0) value1hAgo=val;
    });

    const s=stats(values24);
    const iconMax=s.max!=null?(s.max>=60?"🔥":s.max>=50?"🌡️":"🧊"):"–";
    const iconAvg=s.avg!=null?(s.avg>=60?"🔥":s.avg>=50?"🌡️":"🧊"):"–";
    const iconLast=lastValue!=null?(lastValue>=60?"🔥":lastValue>=50?"🌡️":"🧊"):"–";

    let tendencia="—", trendIcon="•", colorTend="inherit";
    if (value1hAgo!=null && lastValue!=null){
      if (lastValue>value1hAgo){ tendencia="Subiendo"; trendIcon="⬆"; colorTend="var(--good)"; }
      else if (lastValue<value1hAgo){ tendencia="Bajando"; trendIcon="⬇"; colorTend="var(--bad)"; }
      else { tendencia="Estable"; trendIcon="→"; colorTend="var(--warn)"; }
    }

    const card=document.createElement("div");
    card.className="card";
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
/* gradiente azul→verde→rojo */
function lerp(a,b,t){ return Math.round(a + (b-a)*t); }
function rgb(r,g,b){ return `rgb(${r},${g},${b})`; }
function bgrGradient(t){
  t = Math.max(0, Math.min(1, t));
  const blue  = [0,120,255];
  const green = [0,200,0];
  const red   = [255,60,60];
  if (t <= 0.5){
    const k = t/0.5;
    return rgb(lerp(blue[0],green[0],k), lerp(blue[1],green[1],k), lerp(blue[2],green[2],k));
  } else {
    const k = (t-0.5)/0.5;
    return rgb(lerp(green[0],red[0],k), lerp(green[1],red[1],k), lerp(green[2],red[2],k));
  }
}

function buildHeatmapCheckboxes(){
  const box = document.getElementById("hmCheckboxes");
  box.innerHTML = secadoras.map(s=>{
    const checked = selectedHeatmap.has(s) ? "checked" : "";
    return `<label><input type="checkbox" value="${s}" ${checked}> ${s}</label>`;
  }).join("");

  // eventos
  box.querySelectorAll("input[type='checkbox']").forEach(chk=>{
    chk.addEventListener("change", ()=>{
      if (chk.checked) selectedHeatmap.add(chk.value);
      else selectedHeatmap.delete(chk.value);
      renderHeatmap(); // actualiza
    });
  });

  // botones masivos
  document.getElementById("hmSelectAll").onclick = ()=>{
    secadoras.forEach(s=>selectedHeatmap.add(s));
    buildHeatmapCheckboxes();
    renderHeatmap();
  };
  document.getElementById("hmClearAll").onclick = ()=>{
    selectedHeatmap.clear();
    buildHeatmapCheckboxes();
    renderHeatmap();
  };
}

function renderHeatmap(){
  const container = document.getElementById("heatmap");
  container.innerHTML = "";

  const rows = getQuickRows();
  if (!rows.length) return;

  const quick = document.getElementById("quickRange").value;
  const hoursWindow = quick === "all" ? 24 : parseInt(quick);

  const lastTs = parseDotNetDate(rows[0]["Time_Stamp"]);
  const since = new Date(lastTs.getTime() - hoursWindow*3600000);

  // eje X: horas
  const hours = [];
  for (let h=hoursWindow-1; h>=0; h--){
    const d = new Date(lastTs.getTime() - h*3600000);
    d.setMinutes(0,0,0);
    hours.push(d.getTime());
  }

  // header (grid consistente)
  const header = document.createElement("div");
  header.className = "hm-header";
  header.style.gridTemplateColumns = `var(--label-w) ${hours.map(()=> 'var(--cell-w)').join(' ')}`;
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = "Secadora / Hora";
  header.appendChild(label);
  hours.forEach(h=>{
    const d = new Date(h);
    const c = document.createElement("div");
    c.className = "hm-hour";
    c.textContent = d.getHours().toString().padStart(2,"0");
    header.appendChild(c);
  });
  container.appendChild(header);

  // si no hay seleccionadas, mostrar aviso y salir
  if (selectedHeatmap.size === 0){
    const row = document.createElement("div");
    row.className = "hm-row";
    row.style.gridTemplateColumns = `var(--label-w) ${hours.map(()=> 'var(--cell-w)').join(' ')}`;
    const msg = document.createElement("div");
    msg.className = "label";
    msg.textContent = "— Seleccioná al menos una secadora —";
    row.appendChild(msg);
    container.appendChild(row);
    return;
  }

  // buckets: sec -> hourKey -> [vals] (INCLUYE ceros)
  const buckets = {};
  rows.forEach(r=>{
    const ts = parseDotNetDate(r["Time_Stamp"]);
    if (!ts || ts<since) return;
    const hour = new Date(ts); hour.setMinutes(0,0,0);
    const hk = hour.getTime();

    secadoras.forEach(sec=>{
      const v = parseFloat(r[sec]);
      if (!isFinite(v)) return;
      (buckets[sec] ||= {}); (buckets[sec][hk] ||= []).push(v);
    });
  });

  // min/max global SOLO de las seleccionadas
  const all = [];
  [...selectedHeatmap].forEach(sec=>{
    const obj = buckets[sec] || {};
    Object.values(obj).forEach(arr => all.push(...arr));
  });
  const gmin = all.length ? Math.min(...all) : 0;
  const gmax = all.length ? Math.max(...all) : 1;

  // filas (solo seleccionadas)
  [...selectedHeatmap].forEach(sec=>{
    const row = document.createElement("div");
    row.className = "hm-row";
    row.style.gridTemplateColumns = `var(--label-w) ${hours.map(()=> 'var(--cell-w)').join(' ')}`;

    const l = document.createElement("div");
    l.className = "label";
    l.textContent = sec;
    row.appendChild(l);

    hours.forEach(hk=>{
      const arr = (buckets[sec]||{})[hk] || [];
      // promedio INCLUYENDO 0
      const avg = arr.length ? (arr.reduce((a,b)=>a+b,0) / arr.length) : NaN;

      const cell = document.createElement("div");
      cell.className = "hm-cell";
      if (isNaN(avg)){
        cell.style.background = "transparent";
        cell.textContent = "";
      } else {
        const t = (avg - gmin) / ((gmax - gmin) || 1);
        cell.style.background = bgrGradient(t);  // Azul→Verde→Rojo
        cell.textContent = fmt(avg);             // valor visible SIEMPRE
        cell.title = `${sec} · ${new Date(hk).toLocaleString("es-NI")} · ${fmt(avg)} °C`;
      }
      row.appendChild(cell);
    });

    container.appendChild(row);
  });
}

/* ===============================
   TIMELINE (animada + tooltips)
================================*/
function renderTimeline() {
  const svg = document.getElementById("timelineSvg");
  svg.innerHTML = "";

  const sec = document.getElementById("timelineSecadora").value;
  const range = document.getElementById("timelineRange").value;

  const rows = getQuickRows();
  if (!rows.length) return;

  const limit = range === "all" ? null : new Date(Date.now() - parseInt(range) * 3600000);
  const pts = [];

  rows.forEach(r => {
    const ts = parseDotNetDate(r["Time_Stamp"]);
    const val = parseFloat(r[sec]);
    if (!ts || isNaN(val)) return;
    if (limit && ts < limit) return;
    pts.push({ ts: ts.getTime(), val, rawTs: ts });
  });
  if (!pts.length) return;

  const width = 1100;
  const height = 520;
  const padL = 70, padR = 28, padT = 40, padB = 60;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const minTs = Math.min(...pts.map(p => p.ts));
  const maxTs = Math.max(...pts.map(p => p.ts));
  const minVal = Math.min(...pts.map(p => p.val));
  const maxVal = Math.max(...pts.map(p => p.val));

  const mapX = ts => padL + (ts - minTs) / (maxTs - minTs || 1) * (width - padL - padR);
  const mapY = v => height - padB - (v - minVal) / (maxVal - minVal || 1) * (height - padT - padB);

  // Grid horizontal + etiquetas Y
  for (let i = 0; i <= 5; i++) {
    const yVal = minVal + (maxVal - minVal) * (i / 5);
    const y = mapY(yVal);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", padL);
    line.setAttribute("x2", width - padR);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "#3a3f4b");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);

    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("x", padL - 10);
    txt.setAttribute("y", y + 4);
    txt.setAttribute("text-anchor", "end");
    txt.setAttribute("fill", "var(--muted)");
    txt.setAttribute("font-size", "12");
    txt.textContent = fmt(yVal);
    svg.appendChild(txt);
  }

  // Líneas verticales y horas
  const tickEvery = Math.max(1, Math.floor(pts.length / 12));
  pts.forEach((p, i) => {
    if (i % tickEvery !== 0) return;
    const x = mapX(p.ts);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("y1", padT);
    line.setAttribute("y2", height - padB);
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    line.setAttribute("stroke", "#2c303b");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);

    const d = new Date(p.ts);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", x);
    label.setAttribute("y", height - padB + 20);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "var(--muted)");
    label.setAttribute("font-size", "12");
    label.textContent = d.getHours().toString().padStart(2, "0");
    svg.appendChild(label);
  });

  // Línea principal (animada)
  let d = `M ${mapX(pts[0].ts)} ${mapY(pts[0].val)}`;
  pts.forEach(p => d += ` L ${mapX(p.ts)} ${mapY(p.val)}`);

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("stroke", "#4FA3F7");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("fill", "none");
  path.style.strokeDasharray = "2000";
  path.style.strokeDashoffset = "2000";
  svg.appendChild(path);

  setTimeout(() => {
    path.style.transition = "stroke-dashoffset 2.5s ease";
    path.style.strokeDashoffset = "0";
  }, 50);

  // Tooltip flotante
  const tooltip = document.createElement("div");
  tooltip.style.position = "fixed";
  tooltip.style.background = "rgba(0,0,0,0.75)";
  tooltip.style.color = "white";
  tooltip.style.padding = "6px 10px";
  tooltip.style.borderRadius = "6px";
  tooltip.style.pointerEvents = "none";
  tooltip.style.fontSize = "12px";
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  const showTip = (evt, p) => {
    tooltip.style.display = "block";
    tooltip.style.left = (evt.clientX + 10) + "px";
    tooltip.style.top = (evt.clientY + 10) + "px";
    tooltip.innerHTML = `<strong>${sec}</strong><br>Temp: ${fmt(p.val)} °C<br>Hora: ${p.rawTs.toLocaleString("es-NI")}`;
  };
  const hideTip = () => tooltip.style.display = "none";

  // Puntos interactivos
  pts.forEach(p => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", mapX(p.ts));
    c.setAttribute("cy", mapY(p.val));
    c.setAttribute("r", "5");
    c.setAttribute("fill", "#fff");
    c.setAttribute("stroke", "#4FA3F7");
    c.setAttribute("stroke-width", "2");
    c.style.cursor = "pointer";

    c.addEventListener("mouseenter", evt => showTip(evt, p));
    c.addEventListener("mouseleave", hideTip);
    c.addEventListener("touchstart", evt => { evt.preventDefault(); showTip(evt.touches[0], p); });
    c.addEventListener("touchend", hideTip);
    svg.appendChild(c);
  });
}

/* ===============================
   HISTORIAL
================================*/
function groupByDayWeek(rows){
  const daily=new Map(), weekly=new Map();
  function weekKey(d){
    const f=new Date(d.getFullYear(),0,1);
    const diff=Math.floor((d-f)/86400000);
    const week=Math.floor((diff+f.getDay()+6)/7)+1;
    return `${d.getFullYear()}-W${String(week).padStart(2,"0")}`;
  }
  rows.forEach(r=>{
    const ts=parseDotNetDate(r["Time_Stamp"]);
    if (!ts) return;
    const day=`${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}`;
    const wk=weekKey(ts);
    if (!daily.has(day)) daily.set(day,{});
    if (!weekly.has(wk)) weekly.set(wk,{});
    secadoras.forEach(sec=>{
      const v=parseFloat(r[sec]); if (!isFinite(v) || v===0) return; // historial con ceros ignorados
      (daily.get(day)[sec] ||= []).push(v);
      (weekly.get(wk)[sec] ||= []).push(v);
    });
  });
  return {daily,weekly};
}
function renderHistoryTables(){
  const rows=getQuickRows();
  const {daily,weekly}=groupByDayWeek(rows);

  const renderTable=(map,id,label)=>{
    const cont=document.getElementById(id);
    if (map.size===0){ cont.innerHTML="<div class='muted'>Sin datos.</div>"; return; }
    const header=`<tr><th>${label}</th>${secadoras.map(s=>`<th>${s}</th>`).join("")}</tr>`;
    const body=[...map.keys()].sort().map(k=>{
      const obj=map.get(k);
      return `<tr><td><strong>${k}</strong></td>${
        secadoras.map(s=>{
          const arr=obj[s]||[];
          const avg = arr.length ? (arr.reduce((a,b)=>a+b,0) / arr.length) : 0;
          return `<td style="color:${colorTemp(avg)}">${fmt(avg)}</td>`;
        }).join("")
      }</tr>`;
    }).join("");
    cont.innerHTML = `<div class="table-wrapper"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
  };
  renderTable(daily,"historyDaily","Día");
  renderTable(weekly,"historyWeekly","Semana");
}

/* ===============================
   TABLA
================================*/
function renderTable(){
  const rows=getQuickRows();
  document.getElementById("tableHead").innerHTML =
    `<tr>${dataColumns.map(c=>`<th>${c}</th>`).join("")}</tr>`;
  document.getElementById("tableBody").innerHTML =
    rows.map(r=>{
      return `<tr>${dataColumns.map(c=>{
        let v=r[c];
        if (c==="Time_Stamp"){
          const d=parseDotNetDate(v);
          v=d? d.toLocaleString("es-NI",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}) : v;
        }
        return `<td>${v??""}</td>`;
      }).join("")}</tr>`;
    }).join("");
  document.getElementById("rowCount").textContent = rows.length+" filas";
}

/* ===============================
   EXPORTS
================================*/
function downloadCSVCurrentFilter(){
  const rows=getQuickRows();
  const headers=dataColumns.join(",");
  const body=rows.map(r=>
    dataColumns.map(c=>{
      let v=r[c];
      if (c==="Time_Stamp"){
        const d=parseDotNetDate(v);
        v=d? formatLocalISO(d) : v;
      }
      const s=String(v??"");
      return (s.includes(",")||s.includes('"')) ? `"${s.replaceAll('"','""')}"` : s;
    }).join(",")
  ).join("\n");
  const blob=new Blob([headers+"\n"+body],{type:"text/csv"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="datos.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
async function exportPDF(){
  const { jsPDF } = window.jspdf;
  const el=document.getElementById("dashboard");
  const canvas=await html2canvas(el,{scale:2});
  const img=canvas.toDataURL("image/png");
  const pdf=new jsPDF("p","mm","a4");
  const w=pdf.internal.pageSize.getWidth()-10;
  const h=canvas.height * w / canvas.width;
  pdf.addImage(img,"PNG",5,5,w,h);
  pdf.save("dashboard.pdf");
}

/* ===============================
   RENDER ALL
================================*/
function renderAll(){
  renderCards();
  renderTimeline();
  renderHeatmap();
  renderHistoryTables();
  renderTable();
}

/* ===============================
   INIT
================================*/
async function init(){
  try{
    const res=await fetch(JSON_URL+"?t="+Date.now(),{cache:"no-store"});
    const json=await res.json();
    dataColumns=json.columns;
    dataRows=json.rows;

    secadoras = dataColumns.filter(c=>c.toLowerCase().includes("secadora"));

    // seleccionar todas por defecto la PRIMERA vez
    if (selectedHeatmap.size === 0) secadoras.forEach(s=>selectedHeatmap.add(s));
    buildHeatmapCheckboxes(); // construir checks

    // timeline dropdown
    const sel = document.getElementById("timelineSecadora");
    sel.innerHTML = secadoras.map(s=>`<option>${s}</option>`).join("");

    document.getElementById("lastUpdated").textContent =
      "Actualizado: " + new Date().toLocaleString();

    renderAll();
  } catch(e){
    alert("Error al cargar JSON: " + e.message);
    console.error(e);
  }
}

/* ===============================
   EVENTOS
================================*/
document.addEventListener("DOMContentLoaded", ()=>{
  init();

  document.getElementById("quickRange").onchange = renderAll;
  document.getElementById("timelineSecadora").onchange = renderTimeline;
  document.getElementById("timelineRange").onchange = renderTimeline;

  document.getElementById("downloadCSV").onclick = downloadCSVCurrentFilter;
  document.getElementById("exportPDF").onclick = exportPDF;

  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const tab=btn.dataset.tab;
      document.getElementById("historyDaily").classList.toggle("hidden",tab!=="daily");
      document.getElementById("historyWeekly").classList.toggle("hidden",tab!=="weekly");
    });
  });

  // Auto-refresh
  setInterval(init, 5*60*1000);
});
