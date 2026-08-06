
const SOURCES = [
  {day:"Monday",date:"2026-08-24",url:"https://ifac.papercept.net/conferences/conferences/IFAC26/program/IFAC26_ContentListWeb_1.html"},
  {day:"Tuesday",date:"2026-08-25",url:"https://ifac.papercept.net/conferences/conferences/IFAC26/program/IFAC26_ContentListWeb_2.html"},
  {day:"Wednesday",date:"2026-08-26",url:"https://ifac.papercept.net/conferences/conferences/IFAC26/program/IFAC26_ContentListWeb_3.html"},
  {day:"Thursday",date:"2026-08-27",url:"https://ifac.papercept.net/conferences/conferences/IFAC26/program/IFAC26_ContentListWeb_4.html"},
  {day:"Friday",date:"2026-08-28",url:"https://ifac.papercept.net/conferences/conferences/IFAC26/program/IFAC26_ContentListWeb_5.html"}
];
const $=s=>document.querySelector(s);
let items=JSON.parse(localStorage.getItem("ifac26-items")||"[]");
let favorites=new Set(JSON.parse(localStorage.getItem("ifac26-favs")||"[]"));
let view="browse";

function proxy(url){return "https://r.jina.ai/http://"+url.replace(/^https?:\/\//,"")}
function clean(s){return (s||"").replace(/\s+/g," ").trim()}
function idFor(x){return [x.date,x.code,x.time,x.title].join("|")}

function parsePage(text, source){
  const lines=text.split("\n").map(clean).filter(Boolean);
  const out=[]; let session={}; let paper=null; let mode="";
  const sessionRx=/^([A-Z][a-zA-Z0-9_]+)\s+(Plenary Session|Semi-Plenary Session|Special Session|Regular Session|Interactive Session|Invited Session|Open Invited Track Session|Tutorial Session|Panel Session)(?:,\s*(.*))?$/;
  const paperRx=/^(\d{2}:\d{2}-\d{2}:\d{2}),\s*Paper\s+([A-Za-z0-9_.-]+)/;
  for(let i=0;i<lines.length;i++){
    let l=lines[i].replace(/\s*Add to My Program.*$/,"");
    let m=l.match(sessionRx);
    if(m){
      if(paper) out.push(finish(paper,session,source));
      paper=null; session={code:m[1],type:m[2],room:clean(m[3])}; mode="session";
      continue;
    }
    m=l.match(paperRx);
    if(m){
      if(paper) out.push(finish(paper,session,source));
      paper={time:m[1],code:m[2],title:"",authors:[],keywords:[],abstract:""}; mode="paper";
      continue;
    }
    if(!paper) continue;
    if(!paper.title && !/^(Chair|Co-Chair|Keywords|Abstract):/.test(l) && !/^\*+$/.test(l)){
      paper.title=l.replace(/^[-–—]\s*/,""); continue;
    }
    if(l.startsWith("Keywords:")){paper.keywords=l.slice(9).split(",").map(clean);mode="keywords";continue}
    if(l.startsWith("Abstract:")){paper.abstract=l.slice(9);mode="abstract";continue}
    if(mode==="abstract"){paper.abstract+=" "+l;continue}
    if(!/^\*+$/.test(l) && !/^(Chair|Co-Chair):/.test(l) && !l.includes("University")===false){
      // handled below
    }
    if(!/^\*+$/.test(l) && !/^(Chair|Co-Chair):/.test(l) && !/^Keywords:/.test(l)){
      // PaperCept's text representation places author names/institutions before keywords.
      if(mode==="paper" && paper.title && !l.match(/^\d{2}:\d{2}/)) paper.authors.push(l);
    }
  }
  if(paper) out.push(finish(paper,session,source));
  return out.filter(x=>x.title && x.time);
}
function finish(p,s,src){
  const authors=p.authors.filter(x=>x.length<150 && !x.startsWith("Keywords:") && !x.startsWith("Abstract:"));
  const x={...p,authors,...s,day:src.day,date:src.date,source:src.url};
  x.id=idFor(x); return x;
}

async function sync(){
  $("#syncBtn").disabled=true; $("#status").textContent="Syncing live PaperCept program…";
  try{
    const all=[];
    for(const src of SOURCES){
      $("#status").textContent=`Syncing ${src.day}…`;
      const r=await fetch(proxy(src.url),{cache:"no-store"});
      if(!r.ok) throw new Error(`${src.day}: HTTP ${r.status}`);
      const t=await r.text();
      all.push(...parsePage(t,src));
    }
    if(all.length<100) throw new Error("The program format could not be parsed reliably.");
    items=all;
    localStorage.setItem("ifac26-items",JSON.stringify(items));
    localStorage.setItem("ifac26-sync",new Date().toISOString());
    setupFilters(); render();
  }catch(e){
    $("#status").textContent="Sync failed: "+e.message+" Existing cached data was kept.";
  }finally{$("#syncBtn").disabled=false}
}
function setupFilters(){
  const day=$("#dayFilter"), type=$("#typeFilter");
  const oldD=day.value, oldT=type.value;
  day.innerHTML='<option value="">All days</option>'+SOURCES.map(x=>`<option>${x.day}</option>`).join("");
  const types=[...new Set(items.map(x=>x.type).filter(Boolean))].sort();
  type.innerHTML='<option value="">All types</option>'+types.map(x=>`<option>${x}</option>`).join("");
  day.value=oldD;type.value=oldT;
}
function matches(x){
  const q=$("#search").value.toLowerCase(), d=$("#dayFilter").value, t=$("#typeFilter").value;
  const hay=[x.title,x.code,x.sessionCode,x.type,x.room,(x.authors||[]).join(" "),(x.keywords||[]).join(" ")].join(" ").toLowerCase();
  return (!q||hay.includes(q))&&(!d||x.day===d)&&(!t||x.type===t)&&($("#favoritesOnly").getAttribute("aria-pressed")!=="true"||favorites.has(x.id));
}
function render(){
  const el=$("#results"); el.innerHTML="";
  const syncAt=localStorage.getItem("ifac26-sync");
  $("#status").textContent=items.length?`${items.length} talks cached${syncAt?" · synced "+new Date(syncAt).toLocaleString():""}`:"Tap ↻ to load the live program.";
  if(view==="about"){
    el.innerHTML=`<div class="notice"><b>IFAC 2026 Pocket Program</b><br><br>This unofficial app reads the public PaperCept technical-program pages and stores the parsed schedule on this device. Favorites never leave your browser.<br><br><a href="${SOURCES[0].url}" target="_blank" rel="noopener">Open official PaperCept program</a></div>`;return;
  }
  let shown=items.filter(matches);
  if(view==="agenda") shown=shown.filter(x=>favorites.has(x.id));
  shown.sort((a,b)=>(a.date+a.time+a.code).localeCompare(b.date+b.time+b.code));
  if(!shown.length){el.innerHTML='<div class="empty">No matching talks.</div>';return}
  let last="";
  for(const x of shown){
    if(x.day!==last){const h=document.createElement("h3");h.className="day-heading";h.textContent=`${x.day}, ${new Date(x.date+"T12:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"})}`;el.append(h);last=x.day}
    const n=$("#cardTemplate").content.cloneNode(true), card=n.querySelector(".card");
    n.querySelector(".time").textContent=x.time;
    n.querySelector(".meta").textContent=[x.code,x.type,x.room].filter(Boolean).join(" · ");
    n.querySelector("h2").textContent=x.title;
    n.querySelector(".authors").textContent=(x.authors||[]).slice(0,6).join(" · ");
    n.querySelector(".keywords").textContent=(x.keywords||[]).join(" · ");
    const fav=n.querySelector(".fav"); fav.textContent=favorites.has(x.id)?"★":"☆";fav.classList.toggle("on",favorites.has(x.id));
    fav.onclick=e=>{e.stopPropagation();toggleFav(x.id)};
    card.onclick=()=>detail(x);
    el.append(n);
  }
}
function toggleFav(id){favorites.has(id)?favorites.delete(id):favorites.add(id);localStorage.setItem("ifac26-favs",JSON.stringify([...favorites]));render()}
function esc(s){return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function detail(x){
  $("#detailContent").innerHTML=`<div class="time">${esc(x.day)} · ${esc(x.time)}</div><p class="meta">${esc([x.code,x.type,x.room].filter(Boolean).join(" · "))}</p><h2>${esc(x.title)}</h2><p>${esc((x.authors||[]).join(" · "))}</p><p class="keywords">${esc((x.keywords||[]).join(" · "))}</p>${x.abstract?`<p>${esc(x.abstract)}</p>`:""}<p><a href="${x.source}" target="_blank" rel="noopener">Open official source</a></p>`;
  $("#detailDialog").showModal();
}
$("#syncBtn").onclick=sync;
$("#search").oninput=render;$("#dayFilter").onchange=render;$("#typeFilter").onchange=render;
$("#favoritesOnly").onclick=e=>{const on=e.currentTarget.getAttribute("aria-pressed")==="true";e.currentTarget.setAttribute("aria-pressed",String(!on));render()};
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("active",x===b));render()});
$("#closeDialog").onclick=()=>$("#detailDialog").close();
setupFilters();render();
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
