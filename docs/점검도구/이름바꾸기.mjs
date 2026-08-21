/* 이름을 PKEMS → PEER 로 바꾼 뒤, 옛 이름으로 쌓아 둔 것이 그대로 이어지는지 본다.
   이게 깨지면 쓰던 사람의 기록이 «없는 것»이 된다. 가장 무거운 점검이다.
   실행:  node docs/점검도구/이름바꾸기.mjs [url] */
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] || "http://localhost:8000/";
const PORT = 9345;
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "trace-rename-"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_], { stdio: "ignore" });

let ws, msgId = 0; const pending = new Map(); const errors = [];
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error(method + " 무응답")); }, 30000);
    pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
  });
}
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "실패");
  return r.result.value;
};
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? "  — " + detail : ""}`);
};

let u;
for (let i = 0; i < 60 && !u; i++) {
  try {
    const l = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
    u = l.find(t => t.type === "page" && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
  } catch {}
  if (!u) await wait(250);
}
ws = new WebSocket(u);
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result); return;
  }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
};
await new Promise(r => ws.onopen = r);
await send("Runtime.enable"); await send("Page.enable");
await wait(2200);

/* ---------- 옛 이름(pkems.…)으로만 채워 둔다. 새 이름은 하나도 없다. ---------- */
await ev(`(() => {
  localStorage.clear();
  const L = [
    { id:'old1', type:'experience', title:'옛 버전에서 쓴 기록', tags:['수업설계'],
      relations:[], pinned:true,
      blocks:[{id:'b1',kind:'text',text:'이름을 바꾸기 전에 써 둔 글이다. 이게 사라지면 안 된다.'}],
      createdAt:'2026-05-10T09:00:00.000Z', updatedAt:'2026-05-10T09:00:00.000Z',
      mdId:'MDOLD', mdName:'2026-05-10_경험_옛 버전에서 쓴 기록.md' },
    { id:'old2', type:'reflect', title:'두 번째 옛 기록', tags:['회고'],
      relations:[], pinned:false,
      blocks:[{id:'b2',kind:'text',text:'두 번째.'}],
      createdAt:'2026-04-02T09:00:00.000Z', updatedAt:'2026-04-02T09:00:00.000Z',
      mdId:'MDOLD2', mdName:'2026-04-02_회고_두 번째 옛 기록.md' }
  ];
  localStorage.setItem('pkems.entries.v2', JSON.stringify(L));
  localStorage.setItem('pkems.folder', JSON.stringify({id:'OLDFOLDER', name:'05_교직기록', link:''}));
  localStorage.setItem('pkems.connected', '1');
  localStorage.setItem('pkems.email', 'teacher@example.com');
  localStorage.setItem('pkems.settings.v1', JSON.stringify({ version:1, folderMode:'monthly', alsoGdoc:true, viewMode:'grid' }));
  localStorage.setItem('pkems.draft.v1', JSON.stringify({ title:'쓰다 만 옛 글', tags:'', type:'experience', blocks:[], savedAt: 1 }));
  return true;
})()`);

await send("Page.navigate", { url: URL_ });
await wait(2800);

const got = JSON.parse(await ev(`JSON.stringify({
  cards: document.querySelectorAll('.card.entry, .lrow').length,
  /* ⚠️ document.body.textContent 를 쓰면 «본문 안의 <script> 글자» 까지 딸려 온다.
     그러면 코드에 적힌 옛 이름("PEER-index.json") 때문에 시험이 엉뚱하게 통과한다.
     사람 눈에 보이는 것만 봐야 한다. */
  body: document.body.innerText,
  logo: (document.querySelector('.logo')||{}).textContent || '',
  docTitle: document.title,
  newEntries: !!localStorage.getItem('trace.entries.v2'),
  newFolder: localStorage.getItem('trace.folder') || '',
  newSettings: localStorage.getItem('trace.settings.v1') || '',
  newDraft: localStorage.getItem('trace.draft.v1') || '',
  oldStillThere: !!localStorage.getItem('pkems.entries.v2'),
  draftTitle: (document.getElementById('title')||{}).value || ''
})`));

check("옛 기록이 목록에 그대로 나온다", got.cards >= 2 && got.body.includes("옛 버전에서 쓴 기록"), `${got.cards}편`);
check("옛 저장 키가 새 이름으로 옮겨졌다", got.newEntries);
check("연결해 둔 폴더도 따라온다", got.newFolder.includes("05_교직기록"), got.newFolder.slice(0, 40));
check("설정도 따라온다 (폴더 방식·보기)", got.newSettings.includes("monthly") && got.newSettings.includes("grid"));
check("쓰다 만 글도 되살아난다", got.draftTitle === "쓰다 만 옛 글", got.draftTitle);
check("옛 키를 지우지 않는다 (되돌릴 수 있게)", got.oldStillThere);
check("화면에 보이는 이름이 새 이름이다",
  /TRACE/.test(got.logo) && /TRACE/.test(got.docTitle) && !/PEER|PKEMS/.test(got.logo),
  got.logo.slice(0, 50));

/* ---------- 두 번째로 열어도 덮어쓰지 않는가 ---------- */
await ev(`(() => {
  const cur = JSON.parse(localStorage.getItem('trace.entries.v2'));
  cur.push({ id:'new1', type:'idea', title:'이름 바꾼 뒤 쓴 기록', tags:[], relations:[], pinned:false,
    blocks:[], createdAt:'2026-08-20T09:00:00.000Z', updatedAt:'2026-08-20T09:00:00.000Z' });
  localStorage.setItem('trace.entries.v2', JSON.stringify(cur));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2600);
const after = JSON.parse(await ev(`JSON.stringify({
  cards: document.querySelectorAll('.card.entry, .lrow').length,
  hasNew: document.body.textContent.includes('이름 바꾼 뒤 쓴 기록'),
  hasOld: document.body.textContent.includes('옛 버전에서 쓴 기록')
})`));
check("새로 쓴 것이 옛 것에 덮이지 않는다", after.hasNew && after.hasOld, `${after.cards}편`);

/* ---------- 사슬의 가운데 고리도 본다: peer.* → trace.* ----------
   이름이 두 번 바뀌었으므로, «PEER 버전을 쓰던 사람» 도 이어져야 한다.
   가운데 고리가 끊기면 그 사람들만 기록을 잃는다. */
await ev(`(() => {
  localStorage.clear();
  localStorage.setItem('peer.entries.v2', JSON.stringify([
    { id:'mid1', type:'knowledge', title:'PEER 시절에 쓴 기록', tags:['평가'],
      relations:[], pinned:false,
      blocks:[{id:'m1',kind:'text',text:'가운데 고리가 끊기면 이것이 사라진다.'}],
      createdAt:'2026-07-01T09:00:00.000Z', updatedAt:'2026-07-01T09:00:00.000Z',
      mdId:'MDMID', mdName:'2026-07-01_지식_PEER 시절에 쓴 기록.md' }
  ]));
  localStorage.setItem('peer.folder', JSON.stringify({id:'MIDFOLDER', name:'06_중간폴더', link:''}));
  localStorage.setItem('peer.settings.v1', JSON.stringify({ version:1, folderMode:'tag', viewMode:'list' }));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2600);
const mid = JSON.parse(await ev(`JSON.stringify({
  body: document.body.textContent.includes('PEER 시절에 쓴 기록'),
  folder: localStorage.getItem('trace.folder') || '',
  settings: localStorage.getItem('trace.settings.v1') || ''
})`));
check("PEER 시절 기록도 이어진다", mid.body);
check("PEER 시절 폴더·설정도 따라온다", mid.folder.includes("06_중간폴더") && mid.settings.includes("tag"), mid.folder.slice(0, 36));

/* «연결됨» 상태로 씨앗을 심었으므로 앱이 구글 창을 열려고 한다.
   화면 없는 브라우저에서는 그 창이 막히는 게 정상이다 — 결함이 아니라 예상된 일이다.
   (실제 브라우저에서는 열리거나, 막히면 «다시 연결» 띠가 뜬다) */
const realErrors = errors.filter(e => !/GSI_LOGGER|popup/i.test(String(e)));
check("이관 중 오류 없음", realErrors.length === 0, realErrors[0] || "");

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
edge.kill();
process.exit(failed.length ? 1 : 0);
