"use strict";
let data={teachers:[],students:[],lessons:[],packages:[],courses:[]};

document.addEventListener("DOMContentLoaded", init);
async function init(){
  bindNavigation(); bindControls(); await refresh();
  navigate(location.hash.replace("#","") || "overview", false);
}
function bindNavigation(){
  document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.go)));
  window.addEventListener("hashchange",()=>navigate(location.hash.replace("#","")||"overview",false));
}
function bindControls(){
  document.getElementById("refreshBtn").addEventListener("click",refresh);
  document.getElementById("menuBtn").addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("open"));
  document.getElementById("lessonSearch").addEventListener("input",renderLessons);
  document.getElementById("lessonStatus").addEventListener("change",renderLessons);
}
function navigate(page, hash=true){
  const valid=["overview","lessons","teachers","students","packages","courses"];
  if(!valid.includes(page)) page="overview";
  document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",x.id===`page-${page}`));
  document.querySelectorAll("[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
  document.getElementById("pageTitle").textContent=page[0].toUpperCase()+page.slice(1);
  if(hash) history.replaceState(null,"",`#${page}`);
  document.getElementById("sidebar").classList.remove("open");
}
async function refresh(){
  try{
    data=await MileoAPI.getAdminDashboard();
    const status=document.getElementById("apiStatus");
    status.textContent=MileoAPI.isRemote()?"Live API":"Demo data";
    status.className=`pill ${MileoAPI.isRemote()?"success":"warning"}`;
    renderAll(); toast("Admin data refreshed");
  }catch(e){ console.error(e); toast("Could not load data"); }
}
function renderAll(){renderOverview();renderLessons();renderTeachers();renderStudents();renderPackages();renderCourses()}
const money=n=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n||0);
const badge=(v,c="")=>`<span class="badge ${c}">${esc(v)}</span>`;
function renderOverview(){
  const today="2026-09-19";
  const todayLessons=data.lessons.filter(l=>l.date===today);
  const revenue=data.packages.reduce((s,p)=>s+Number(p.charged||0),0);
  const owed=data.teachers.reduce((s,t)=>s+Number(t.amountOwed||0),0);
  document.getElementById("stats").innerHTML=[
    ["Lessons today",todayLessons.length,"Across all teachers"],
    ["Active students",data.students.length,"Current learning journeys"],
    ["Package revenue",money(revenue),"Prototype booked revenue"],
    ["Teacher pay owed",money(owed),"Based on completed lessons"]
  ].map(x=>`<article class="stat"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></article>`).join("");
  document.getElementById("todayLessons").innerHTML=todayLessons.length?todayLessons.map(l=>`<div class="list-row"><strong>${esc(l.time)}</strong><div><strong>${esc(l.student)}</strong><small>${esc(l.course)} · ${esc(l.teacher)}</small></div>${badge(l.status,l.status==="Record due"?"coral":"")}</div>`).join(""):`<div class="empty">No lessons today.</div>`;
  const recordDue=data.lessons.filter(l=>l.record==="Required");
  const renewal=data.packages.filter(p=>p.status==="Renewal soon");
  const review=data.teachers.filter(t=>t.status!=="Verified");
  const actions=[
    ...recordDue.map(x=>["Lesson record due",`${x.teacher} · ${x.student}`,"coral"]),
    ...renewal.map(x=>["Package renewal",`${x.student} · ${x.used}/${x.lessons} used`,"yellow"]),
    ...review.map(x=>["Teacher QA",`${x.name} · ${x.qa}`,"yellow"])
  ];
  document.getElementById("actions").innerHTML=actions.length?actions.map(a=>`<div class="list-row"><div>${badge("!",a[2])}</div><div><strong>${a[0]}</strong><small>${a[1]}</small></div></div>`).join(""):`<div class="empty">Nothing requires attention.</div>`;
  document.getElementById("packageHealth").innerHTML=data.packages.map(p=>{const left=p.lessons-p.used;return `<div class="metric-line"><span>${esc(p.student)}</span><strong>${left} lessons left</strong></div>`}).join("");
  document.getElementById("courseActivity").innerHTML=data.courses.map(c=>`<div class="metric-line"><span>${esc(c.name)}</span><strong>${c.activeStudents} active</strong></div>`).join("");
}
function renderLessons(){
  const q=(document.getElementById("lessonSearch").value||"").toLowerCase(), status=document.getElementById("lessonStatus").value;
  const rows=data.lessons.filter(l=>(!q||`${l.student} ${l.teacher} ${l.course}`.toLowerCase().includes(q))&&(!status||l.status===status));
  document.getElementById("lessonsBody").innerHTML=rows.map(l=>`<tr><td><strong>${esc(l.date)}</strong><br><span class="muted">${esc(l.time)}</span></td><td>${esc(l.student)}</td><td>${esc(l.teacher)}</td><td>${esc(l.course)}</td><td>${badge(l.status,l.status==="Record due"?"coral":l.status==="Completed"?"green":"")}</td><td>${badge(l.record,l.record==="Complete"?"green":l.record==="Required"?"coral":"")}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">No matching lessons.</td></tr>`;
}
function renderTeachers(){
  document.getElementById("teachersGrid").innerHTML=data.teachers.map(t=>`<article class="entity-card"><p class="eyebrow">Teacher ${esc(t.id)}</p><h3>${esc(t.name)}</h3><span class="muted">${esc(t.timezone)}</span><div class="meta">${badge(t.status,t.status==="Verified"?"green":"yellow")}${t.specialisms.map(s=>badge(s)).join("")}</div><div class="metric-line"><span>Lessons this week</span><strong>${t.lessonsThisWeek}</strong></div><div class="metric-line"><span>Completed</span><strong>${t.completed}</strong></div><div class="metric-line"><span>Amount owed</span><strong>${money(t.amountOwed)}</strong></div><div class="metric-line"><span>QA</span><strong>${esc(t.qa)}</strong></div></article>`).join("");
}
function renderStudents(){
  document.getElementById("studentsBody").innerHTML=data.students.map(s=>`<tr><td><strong>${esc(s.name)}</strong><br><span class="muted">${esc(s.id)}</span></td><td>${esc(s.course)}</td><td>${esc(s.package)}</td><td>${s.used}</td><td><strong>${s.bought-s.used}</strong></td><td><span>${s.progress}%</span><div class="progress"><span style="width:${Math.min(100,s.progress)}%"></span></div></td></tr>`).join("");
}
function renderPackages(){
  document.getElementById("packagesBody").innerHTML=data.packages.map(p=>{const teacherCost=p.used*p.teacherRate,contribution=p.charged-teacherCost;return `<tr><td><strong>${esc(p.student)}</strong></td><td>${esc(p.name)}</td><td>${money(p.charged)}</td><td>${p.used}/${p.lessons}</td><td>${money(teacherCost)}</td><td><strong>${money(contribution)}</strong></td><td>${badge(p.status,p.status==="Renewal soon"?"yellow":"green")}</td></tr>`}).join("");
}
function renderCourses(){
  document.getElementById("coursesGrid").innerHTML=data.courses.map(c=>`<article class="entity-card"><p class="eyebrow">${esc(c.level)} pathway</p><h3>${esc(c.name)}</h3><p class="muted">${esc(c.description)}</p><div class="metric-line"><span>Stages</span><strong>${c.stages}</strong></div><div class="metric-line"><span>Defined outcomes</span><strong>${c.outcomes}</strong></div><div class="metric-line"><span>Active students</span><strong>${c.activeStudents}</strong></div><div class="meta">${badge("Outcomes")}${badge("Teacher guidance")}${badge("Resources")}${badge("Checkpoints")}</div></article>`).join("");
}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function toast(msg){const t=document.getElementById("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1600)}