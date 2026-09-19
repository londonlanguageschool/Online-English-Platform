"use strict";
/*
  Mileo API abstraction.
  V1 runs safely with demo data. When your new Apps Script deployment is ready,
  paste its /exec URL below and set USE_REMOTE_API = true.

  Important: create a NEW Mileo Apps Script project/deployment. Do not point
  this at the live LLS backend.
*/
const MILEO_API_URL = "";
const USE_REMOTE_API = false;

const MileoAPI = (() => {
  const demo = {
    teachers:[
      {id:"T001",name:"Helen Carter",status:"Verified",timezone:"Europe/London",specialisms:["General English","Cambridge"],lessonsThisWeek:14,completed:11,amountOwed:198,qa:"Good"},
      {id:"T002",name:"Marco Silva",status:"Verified",timezone:"Europe/Rome",specialisms:["General English","IELTS"],lessonsThisWeek:9,completed:7,amountOwed:126,qa:"Good"},
      {id:"T003",name:"Sara Khan",status:"Review due",timezone:"Europe/Madrid",specialisms:["Business English"],lessonsThisWeek:6,completed:5,amountOwed:90,qa:"Observation due"}
    ],
    students:[
      {id:"S001",name:"Anna Rossi",course:"General English A1",package:"20 lessons",bought:20,used:8,progress:34},
      {id:"S002",name:"David Chen",course:"General English B1",package:"10 lessons",bought:10,used:6,progress:57},
      {id:"S003",name:"Lucia Bianchi",course:"IELTS Foundations",package:"20 lessons",bought:20,used:18,progress:76},
      {id:"S004",name:"Omar Haddad",course:"Business English B2",package:"10 lessons",bought:10,used:3,progress:24}
    ],
    lessons:[
      {id:"L101",date:"2026-09-19",time:"09:00",student:"Anna Rossi",teacher:"Helen Carter",course:"General English A1",status:"Scheduled",record:"Pending"},
      {id:"L102",date:"2026-09-19",time:"11:00",student:"David Chen",teacher:"Marco Silva",course:"General English B1",status:"Scheduled",record:"Pending"},
      {id:"L103",date:"2026-09-19",time:"14:30",student:"Lucia Bianchi",teacher:"Helen Carter",course:"IELTS Foundations",status:"Record due",record:"Required"},
      {id:"L104",date:"2026-09-18",time:"17:00",student:"Omar Haddad",teacher:"Sara Khan",course:"Business English B2",status:"Completed",record:"Complete"}
    ],
    packages:[
      {id:"P001",student:"Anna Rossi",name:"20-lesson A1 pathway",charged:520,lessons:20,used:8,teacherRate:18,status:"Active"},
      {id:"P002",student:"David Chen",name:"10-lesson Flex",charged:290,lessons:10,used:6,teacherRate:18,status:"Active"},
      {id:"P003",student:"Lucia Bianchi",name:"20-lesson IELTS",charged:640,lessons:20,used:18,teacherRate:21,status:"Renewal soon"},
      {id:"P004",student:"Omar Haddad",name:"10-lesson Business",charged:350,lessons:10,used:3,teacherRate:22,status:"Active"}
    ],
    courses:[
      {id:"C001",name:"General English A1",level:"A1",stages:6,outcomes:42,activeStudents:1,description:"Core pathway from basic communication toward confident A1 performance."},
      {id:"C002",name:"General English B1",level:"B1",stages:8,outcomes:58,activeStudents:1,description:"Integrated skills pathway with measurable language and communication outcomes."},
      {id:"C003",name:"IELTS Foundations",level:"B1–B2",stages:6,outcomes:36,activeStudents:1,description:"Foundation pathway before intensive IELTS preparation."},
      {id:"C004",name:"Business English B2",level:"B2",stages:6,outcomes:38,activeStudents:1,description:"Professional communication pathway for workplace contexts."}
    ]
  };

  async function request(action, params={}) {
    if (!USE_REMOTE_API || !MILEO_API_URL) return null;
    const url = new URL(MILEO_API_URL);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
    const res = await fetch(url, {cache:"no-store"});
    if (!res.ok) throw new Error(`Mileo API HTTP ${res.status}`);
    const payload = await res.json();
    if (payload && payload.success === false) throw new Error(payload.error || "Mileo API error");
    return payload.data ?? payload;
  }

  async function collection(action, fallback) {
    try {
      const data = await request(action);
      return Array.isArray(data) ? data : fallback;
    } catch (err) {
      console.error(err);
      return fallback;
    }
  }

  return {
    isRemote: () => Boolean(USE_REMOTE_API && MILEO_API_URL),
    getTeachers: () => collection("getTeachers", demo.teachers),
    getStudents: () => collection("getStudents", demo.students),
    getLessons: () => collection("getLessons", demo.lessons),
    getPackages: () => collection("getPackages", demo.packages),
    getCourses: () => collection("getCourses", demo.courses),
    async getAdminDashboard(){
      const [teachers,students,lessons,packages,courses] = await Promise.all([
        this.getTeachers(),this.getStudents(),this.getLessons(),this.getPackages(),this.getCourses()
      ]);
      return {teachers,students,lessons,packages,courses};
    }
  };
})();