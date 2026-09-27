/* GI Siting — Baltimore : client-side weighted overlay.
   Pre-computed sub-scores (1-5) per lot are loaded from lots.json;
   the browser only does the weighted sum, so slider changes are instant. */

const CRITERIA = [
  {key:"flood",  label:"Proximity to flood-prone areas", idx:2,
   desc:"Target stormwater where flooding is worst."},
  {key:"stream", label:"Proximity to historic streams",  idx:3,
   desc:"Daylighting & natural drainage opportunity."},
  {key:"school", label:"Proximity to schools",           idx:4,
   desc:"Community & educational co-benefits."},
  {key:"own",    label:"City ownership",                  idx:5,
   desc:"City-owned lots are cheaper/faster to build on."},
  {key:"size",   label:"Lot size",                        idx:6,
   desc:"Larger lots store more stormwater."},
];

// default (student) weights vs expert reference (0..100 for sliders)
const DEFAULTS = {flood:20, stream:20, school:20, own:20, size:20};
let EXPERT = {flood:35, stream:20, own:20, school:10, size:15};

let LOTS = [];          // raw records
let META = null;
let weights = {...DEFAULTS};
let topN = 400;
let expertTop50 = new Set();

const map = L.map("map", {zoomControl:true}).setView([39.30, -76.61], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom:19, attribution:"© OpenStreetMap"
}).addTo(map);

let markerLayer = L.layerGroup().addTo(map);

function color(s){
  if (s>=4.5) return "#7f2704";
  if (s>=4.0) return "#a63603";
  if (s>=3.5) return "#d94801";
  if (s>=3.0) return "#f16913";
  if (s>=2.5) return "#fd8d3c";
  return "#fdae6b";
}

// weighted suitability for one lot record given normalized weights
function suitability(rec, w){
  const wsum = w.flood + w.stream + w.school + w.own + w.size || 1;
  const val = rec[2]*w.flood + rec[3]*w.stream + rec[4]*w.school
            + rec[5]*w.own   + rec[6]*w.size;
  return val / wsum;
}

// compute a ranked list [{rec, s}] using given weight object (0..100)
function rank(w){
  const arr = LOTS.map(rec => ({rec, s: suitability(rec, w)}));
  arr.sort((a,b) => b.s - a.s);
  return arr;
}

function lotId(rec){ return rec[0]+","+rec[1]; }   // lon,lat as stable id

function render(){
  const ranked = rank(weights);
  const shown = ranked.slice(0, topN);

  // metrics
  const mean = ranked.reduce((a,x)=>a+x.s,0)/ranked.length;
  const high = ranked.filter(x=>x.s>=4.0).length;
  document.getElementById("mMean").textContent = mean.toFixed(2);
  document.getElementById("mHigh").textContent = high.toLocaleString();
  document.getElementById("mShown").textContent = shown.length.toLocaleString();

  // agreement of student's top-50 with expert's top-50
  const myTop50 = new Set(ranked.slice(0,50).map(x=>lotId(x.rec)));
  let overlap = 0; myTop50.forEach(id => { if (expertTop50.has(id)) overlap++; });
  document.getElementById("mAgree").textContent = overlap + "/50";

  // draw
  markerLayer.clearLayers();
  for (const {rec, s} of shown){
    L.circleMarker([rec[1], rec[0]], {
      radius:5, color:"#333", weight:0.5, fillColor:color(s),
      fillOpacity:0.9
    }).bindPopup(
      `<b>Suitability: ${s.toFixed(2)}</b><br>`+
      `Flood: ${rec[2]}/5 (${rec[7].toLocaleString()} ft)<br>`+
      `Stream: ${rec[3]}/5 (${rec[8].toLocaleString()} ft)<br>`+
      `School: ${rec[4]}/5 · Ownership: ${rec[5]}/5 · Size: ${rec[6]}/5<br>`+
      `Area: ${rec[9].toLocaleString()} ft²`
    ).addTo(markerLayer);
  }
}

function buildSliders(){
  const box = document.getElementById("sliders");
  box.innerHTML = "";
  for (const c of CRITERIA){
    const row = document.createElement("div");
    row.className = "slider-row";
    row.innerHTML =
      `<label><span>${c.label}</span><b id="v_${c.key}">${weights[c.key]}</b></label>`+
      `<input type="range" min="0" max="100" step="5" value="${weights[c.key]}" id="s_${c.key}"/>`+
      `<div class="desc">${c.desc}</div>`;
    box.appendChild(row);
    row.querySelector("input").addEventListener("input", e=>{
      weights[c.key] = +e.target.value;
      document.getElementById("v_"+c.key).textContent = weights[c.key];
      render();
    });
  }
}

function syncSliders(){
  for (const c of CRITERIA){
    document.getElementById("s_"+c.key).value = weights[c.key];
    document.getElementById("v_"+c.key).textContent = weights[c.key];
  }
}

document.getElementById("btnExpert").addEventListener("click", ()=>{
  weights = {...EXPERT}; syncSliders(); render();
});
document.getElementById("btnReset").addEventListener("click", ()=>{
  weights = {...DEFAULTS}; syncSliders(); render();
});
document.getElementById("topN").addEventListener("input", e=>{
  topN = +e.target.value;
  document.getElementById("topNval").textContent = topN;
  render();
});

// ---- load data ----
fetch("flood.geojson").then(r=>r.json()).then(gj=>{
  L.geoJSON(gj, {style:{color:"#2b83ba", weight:1, fillColor:"#2b83ba", fillOpacity:0.22}})
   .addTo(map);
}).catch(()=>{});

fetch("lots.json").then(r=>r.json()).then(data=>{
  META = data.meta;
  LOTS = data.lots;
  if (META.expert_weights){
    // convert 0..1 -> 0..100
    EXPERT = {};
    for (const k in META.expert_weights) EXPERT[k] = Math.round(META.expert_weights[k]*100);
  }
  // precompute expert top-50 for the agreement metric
  expertTop50 = new Set(rank(EXPERT).slice(0,50).map(x=>lotId(x.rec)));

  document.getElementById("meta").innerHTML =
    `<b>${META.n_lots.toLocaleString()}</b> city-owned vacant lots · ${META.source}`;

  buildSliders();
  render();
});

// ---- Ask the evidence (client-side cited retrieval over kb.json) ----
let KB = [];
const STOP = new Set(["the","a","an","of","to","for","and","or","is","are","do","does",
  "why","what","which","how","in","on","with","this","that","it","be","as","at","by",
  "i","you","should","would","can","my","me","near","matter","matters","use","used","fit","fits"]);

function tokenize(s){
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => !STOP.has(t) && t.length>1);
}

function searchKB(query){
  const qt = tokenize(query);
  if (!qt.length) return [];
  const scored = KB.map(card => {
    const hayKw = card.keywords.join(" ").toLowerCase();
    const hayText = (card.title + " " + card.body).toLowerCase();
    let s = 0;
    for (const t of qt){
      // keyword hits are worth most; title next; body least
      if (card.keywords.some(k => k.includes(t) || t.includes(k))) s += 5;
      if (card.title.toLowerCase().includes(t)) s += 3;
      if (hayText.includes(t)) s += 1;
    }
    return {card, s};
  }).filter(x => x.s > 0);
  scored.sort((a,b)=>b.s-a.s);
  return scored.slice(0,3);
}

function renderAnswers(query){
  const box = document.getElementById("askResults");
  const hits = searchKB(query);
  if (!hits.length){
    box.innerHTML = '<div class="ask-empty">No matching evidence found. '+
      'Try keywords like slope, soil, weights, green roof, heat, or workflow.</div>';
    return;
  }
  box.innerHTML = hits.map(h =>
    `<div class="ans">`+
    `<div class="a-title">${h.card.title}</div>`+
    `<div class="a-body">${h.card.body}</div>`+
    `<div class="a-src">Source: ${h.card.source}</div>`+
    `</div>`).join("");
}

function initAsk(){
  const input = document.getElementById("askInput");
  const chipsBox = document.getElementById("askChips");
  const examples = [
    "Why does slope matter?",
    "Which GI reduces urban heat?",
    "How is suitability calculated?",
    "Why do weights matter?",
    "What criteria does this demo use?",
  ];
  chipsBox.innerHTML = examples.map(e => `<span class="chip">${e}</span>`).join("");
  chipsBox.querySelectorAll(".chip").forEach(c =>
    c.addEventListener("click", ()=>{ input.value = c.textContent; renderAnswers(c.textContent); }));

  let t = null;
  input.addEventListener("input", e=>{
    clearTimeout(t);
    const v = e.target.value;
    t = setTimeout(()=>{ if (v.trim().length>=2) renderAnswers(v); else document.getElementById("askResults").innerHTML=""; }, 200);
  });
}

fetch("kb.json").then(r=>r.json()).then(d=>{ KB = d.cards; initAsk(); }).catch(()=>{
  document.getElementById("askResults").innerHTML =
    '<div class="ask-empty">Knowledge base unavailable.</div>';
});

// legend
const legend = L.control({position:"bottomright"});
legend.onAdd = function(){
  const d = L.DomUtil.create("div","legend");
  d.innerHTML =
    "<b>Suitability</b><br>"+
    '<i style="background:#7f2704"></i>≥ 4.5 (best)<br>'+
    '<i style="background:#d94801"></i>3.5 – 4.5<br>'+
    '<i style="background:#fd8d3c"></i>2.5 – 3.5<br>'+
    '<i style="background:#fdae6b"></i>&lt; 2.5<br>'+
    '<i style="background:#2b83ba;opacity:.5"></i>Flood area';
  return d;
};
legend.addTo(map);
