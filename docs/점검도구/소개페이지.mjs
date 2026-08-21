/* 소개 페이지가 «구분된 쪽»으로 제대로 갈리는지 본다. */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2], OUT = process.argv[3];
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }
const PORT = 9390;
const wait = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "ic-"));
const edge = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`, URL_],{stdio:"ignore"});
let ws,id=0; const pend=new Map(); const errs=[];
const send=(m,p={})=>{const i=++id; ws.send(JSON.stringify({id:i,method:m,params:p})); return new Promise((res,rej)=>pend.set(i,{res,rej}));};
const ev=async e=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true,userGesture:true}); if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value;};
const shot=async n=>{const r=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false}); writeFileSync(join(OUT,n),Buffer.from(r.data,"base64")); console.log("찍음 "+n);};
const results=[];
const check=(n,ok,d="")=>{results.push({n,ok}); console.log(`${ok?"  OK  ":" FAIL "} ${n}${d?"  — "+d:""}`);};

let u; for(let i=0;i<60&&!u;i++){try{const l=await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r=>r.json()); u=l.find(t=>t.type==="page"&&t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;}catch{} if(!u) await wait(250);}
ws=new WebSocket(u);
ws.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id); pend.delete(m.id); m.error?rej(new Error(m.error.message)):res(m.result); return;}
  if(m.method==="Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  if(m.method==="Runtime.consoleAPICalled"&&m.params.type==="error") errs.push(m.params.args.map(a=>a.value??a.description).join(" "));};
await new Promise(r=>ws.onopen=r);
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride",{width:1120,height:900,deviceScaleFactor:2,mobile:false});
await wait(1800);

const PAGES = ["home","why","what","setup","drive","limits","name"];

const first = JSON.parse(await ev(`(() => {
  const on = Array.from(document.querySelectorAll('.page')).filter(p => p.classList.contains('on')).map(p => p.id.replace(/^p-/, ''));
  return JSON.stringify({ on, tabs: document.querySelectorAll('#tabs a').length,
    h: document.documentElement.scrollHeight, over: document.documentElement.scrollWidth - document.documentElement.clientWidth });
})()`));
check("처음에는 «처음» 쪽만 보인다", first.on.length === 1 && first.on[0] === "home", first.on.join(","));
check("탭이 일곱 개다", first.tabs === 7, `${first.tabs}개`);
check("가로로 안 넘친다", first.over === 0, `${first.over}px`);
await shot("tab-1-처음.png");

const heights = { home: first.h };
for (const p of PAGES.slice(1)) {
  const r = JSON.parse(await ev(`(() => {
    const a = Array.from(document.querySelectorAll('#tabs a')).find(x => x.getAttribute('href') === '#${p}');
    if (!a) return JSON.stringify({ err: 'NO_TAB' });
    a.click();
    return JSON.stringify({});
  })()`));
  await wait(400);
  const st = JSON.parse(await ev(`(() => {
    const on = Array.from(document.querySelectorAll('.page')).filter(x => x.classList.contains('on')).map(x => x.id.replace(/^p-/, ''));
    const active = Array.from(document.querySelectorAll('#tabs a.on')).map(x => x.textContent);
    return JSON.stringify({ on, active, y: window.scrollY, h: document.documentElement.scrollHeight,
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.title, imgs: document.querySelectorAll('.page.on img').length,
      broken: Array.from(document.querySelectorAll('.page.on img')).filter(i=>!i.complete||i.naturalWidth===0).length });
  })()`));
  heights[p] = st.h;
  check(`«${st.active[0] || p}» 쪽만 보인다`, st.on.length === 1 && st.on[0] === p, st.on.join(","));
  check(`«${p}» 로 가면 맨 위로 올라간다`, st.y <= 2, `y=${st.y}`);
  check(`«${p}» 그림이 다 뜬다`, st.broken === 0, `${st.imgs}장 중 ${st.broken}장 깨짐`);
  await shot(`tab-${PAGES.indexOf(p)+1}-${p}.png`);
}

/* 「무엇을 하나」 작은 탭 */
await ev(`(() => { const a=Array.from(document.querySelectorAll('#tabs a')).find(x=>x.getAttribute('href')==='#what'); a.click(); return true; })()`);
await wait(400);
const sub = JSON.parse(await ev(`(() => {
  const btns = Array.from(document.querySelectorAll('#subtabs button'));
  const before = Array.from(document.querySelectorAll('#p-what .sub-page.on')).map(p=>p.id);
  btns.find(b => b.textContent.includes('사진')).click();
  const after = Array.from(document.querySelectorAll('#p-what .sub-page.on')).map(p=>p.id);
  return JSON.stringify({ n: btns.length, before, after,
    h: document.documentElement.scrollHeight });
})()`));
check("«무엇을 하나» 안에 작은 탭이 있다", sub.n === 6, `${sub.n}개`);
check("작은 탭도 한 번에 하나만", sub.after.length === 1 && sub.after[0] === "s-photo", sub.after.join(","));
await wait(400);
await shot("tab-sub-사진.png");

/* 주소(#)로 바로 들어가기 · 뒤로 가기 */
await send("Page.navigate", { url: URL_ + "#limits" });
await wait(1500);
const direct = JSON.parse(await ev(`JSON.stringify({
  on: Array.from(document.querySelectorAll('.page.on')).map(p=>p.id.replace(/^p-/, '')),
  title: document.title
})`));
check("주소로 바로 그 쪽이 열린다", direct.on[0] === "limits", direct.title);

/* 쪽마다 길이가 짧아졌는가 */
const longest = Math.max(...Object.values(heights));
check("한 쪽이 지나치게 길지 않다", longest < 6000, `가장 긴 쪽 ${longest}px`);

/* 표어가 지워졌는가 */
const motto = await ev(`document.body.innerText.includes('다음 사람의 길이 된다')`);
check("표어가 지워졌다", motto === false);

check("오류 없음", errs.length === 0, errs[0] || "");
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
edge.kill();
process.exit(failed.length ? 1 : 0);
