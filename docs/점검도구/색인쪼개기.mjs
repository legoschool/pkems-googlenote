/* 색인이 커졌을 때 «조각으로 나뉘는지» 와, 무엇보다 «기록이 안 사라지는지» 를 본다.

   왜 만들었나 —
   색인 하나에 십삼 년치를 다 담으면, 글자 하나를 고쳐도 그 전부를 다시 올려야 한다.
   폰에서는 그게 곧 「저장이 안 되는 도구」 다. 그래서 색인을 조각으로 나눴다.
   나누는 순간 «못 읽은 조각을 빈 것으로 알고 덮어쓰는» 사고가 생길 수 있다.
   여기서 보는 것은 나뉘는지가 아니라 **덮어쓰지 않는지** 다.

   진짜 드라이브에 붙으려면 로그인이 필요해서, 여기서는 «가짜 드라이브» 를 앞에 세운다.
   이 가짜는 자료가져오기 점검의 것과 달리 **올린 것을 실제로 들고 있다.**
   그래야 올렸다 → 다시 읽었다 를 이어서 겪어 볼 수 있다.

   실행:  node docs/점검도구/색인쪼개기.mjs [url]                                    */
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] || "http://localhost:8000/";
const PORT = 9353;
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "trace-shard-"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });

let ws, msgId = 0; const pending = new Map(); const errors = [];
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error(method + " 무응답")); }, 60000);
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

/* ---------------------------------------------------------
   가짜 드라이브 — 올린 것을 그대로 들고 있는다

   sessionStorage 에 넣어 두므로 **새로고침해도 살아남는다.**
   그래서 「올렸다 → 새로고침 → 다시 읽었다」 를 한 줄로 겪어 볼 수 있다.
   --------------------------------------------------------- */
const FAKE_DRIVE = `(function () {
  // about:blank 에는 sessionStorage 가 없다. 거기서는 아무것도 하지 않는다
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  var FOLDER = 'application/vnd.google-apps.folder';

  // 드라이브 안의 파일들 — 새로고침을 넘어 살아남게 sessionStorage 에 둔다
  function db() { try { return JSON.parse(sessionStorage.getItem('fakedrive') || '{}'); } catch (e) { return {}; } }
  function put(d) { sessionStorage.setItem('fakedrive', JSON.stringify(d)); }
  if (!sessionStorage.getItem('fakedrive')) put({});

  // 올린 것을 기록해 둔다 — «통째로 올렸나, 조각만 올렸나» 를 여기서 잰다
  window.__up = [];
  window.__calls = 0;
  window.__break = sessionStorage.getItem('break') || '';   // 이 이름의 파일은 못 읽는 척한다

  function J(o, status) {
    return Promise.resolve(new Response(JSON.stringify(o),
      { status: status || 200, headers: { 'Content-Type': 'application/json' } }));
  }
  var realFetch = window.fetch.bind(window);

  // multipart 몸통에서 메타(JSON)와 알맹이를 갈라낸다
  function splitMultipart(body) {
    var i = body.indexOf('{'), j = body.indexOf('}', i);
    var meta = {};
    try { meta = JSON.parse(body.slice(i, j + 1)); } catch (e) {}
    var k = body.indexOf('\\r\\n\\r\\n', j);          // 두 번째 칸막이 뒤가 알맹이
    var rest = body.slice(k + 4);
    var tail = rest.lastIndexOf('\\r\\n--');
    return { meta: meta, payload: tail >= 0 ? rest.slice(0, tail) : rest };
  }

  window.fetch = function (url, opts) {
    var u = String(url && url.url ? url.url : url);
    if (u.indexOf('googleapis.com') < 0) return realFetch(url, opts);
    window.__calls++;
    var method = (opts && opts.method) || 'GET';
    if (u.indexOf('/userinfo') >= 0) return J({ email: 'teacher@example.com' });

    var d = db();

    if (u.indexOf('/upload/') >= 0) {                                   // 파일 올리기
      var mu = /files\\/([\\w-]+)\\?/.exec(u);
      var parsed = splitMultipart(String((opts && opts.body) || ''));
      var id = mu ? mu[1] : ('F' + (Object.keys(d).length + 1) + '_' + Math.random().toString(36).slice(2, 6));
      var was = d[id];
      d[id] = {
        id: id,
        name: parsed.meta.name || (was && was.name) || 'noname',
        mimeType: parsed.meta.mimeType || (was && was.mimeType) || 'application/octet-stream',
        parents: parsed.meta.parents || (was && was.parents) || ['ROOT'],
        body: parsed.payload
      };
      put(d);
      window.__up.push({ name: d[id].name, bytes: parsed.payload.length, made: !mu });
      return J({ id: id, name: d[id].name });
    }

    if (method !== 'GET') return J({ id: 'X', name: 'x' });              // 이름 바꾸기·옮기기 등

    if (u.indexOf('alt=media') >= 0) {                                   // 파일 내려받기
      var mm = /files\\/([\\w-]+)\\?/.exec(u);
      var f = mm && d[mm[1]];
      if (!f) return Promise.resolve(new Response('not found', { status: 404 }));
      if (window.__break && f.name === window.__break)
        return Promise.resolve(new Response('gone', { status: 404 }));   // 조각 하나를 못 읽는 척
      return Promise.resolve(new Response(f.body, { status: 200 }));
    }

    if (u.indexOf('/files?') < 0) {                                      // 파일 하나 확인
      var mv = /files\\/([\\w-]+)\\?/.exec(u);
      var fid = mv ? mv[1] : 'ROOT';
      if (fid === 'ROOT') return J({ id: 'ROOT', name: '내 폴더', mimeType: FOLDER, webViewLink: '' });
      var g = d[fid];
      return g ? J({ id: g.id, name: g.name, mimeType: g.mimeType, parents: g.parents })
               : J({ error: { message: '없음' } }, 404);
    }

    var q = decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || ['', ''])[1]);
    var all = Object.keys(d).map(function (k) { return d[k]; });
    var mEq = /name='([^']*)'/.exec(q);
    var mHas = /name contains '([^']*)'/.exec(q);
    var out = [];
    if (mEq) out = all.filter(function (f) { return f.name === mEq[1]; });
    else if (mHas) out = all.filter(function (f) { return f.name.indexOf(mHas[1]) >= 0; });
    return J({ files: out.map(function (f) { return { id: f.id, name: f.name }; }) });
  };
})()`;

/* 기록 N편을 만든다. 글자를 채워 색인이 실제로 커지게 한다. */
function seed(n, pad) {
  return `(function () {
  var N = ${n}, PAD = ${pad};
  var body = new Array(PAD + 1).join('가');
  var list = [];
  for (var i = 0; i < N; i++) {
    list.push({
      id: 'n' + i, type: 'experience', title: '기록 ' + i, tags: ['시험'],
      blocks: [{ id: 'b' + i, kind: 'text', text: body }],
      relations: [], pinned: false,
      createdAt: 1700000000000 - i * 1000, updatedAt: 1700000000000 - i * 1000,
      mdId: 'MD' + i, mdName: '기록 ' + i + '.md'
    });
  }
  localStorage.setItem('trace.entries.v2', JSON.stringify(list));
  return list.length;
})()`;
}

const BOOT = `(function () {
  localStorage.setItem('trace.connected', '1');
  localStorage.setItem('trace.clientId', 'FAKE.apps.googleusercontent.com');
  localStorage.setItem('trace.folder', JSON.stringify({ id: 'ROOT', name: '내 폴더', link: '' }));
  localStorage.setItem('trace.token.v1', JSON.stringify({ t: 'FAKE_TOKEN', exp: Date.now() + 3600000 }));
  localStorage.setItem('trace.email', 'teacher@example.com');
  return true;
})()`;

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
await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_DRIVE });

async function open(seedScript) {
  await send("Page.navigate", { url: "about:blank" });
  await wait(200);
  await send("Page.navigate", { url: URL_ });
  await wait(600);
  if (seedScript) { await ev(BOOT); await ev(seedScript); }
  await send("Page.navigate", { url: URL_ });
  await wait(3000);
}

// 드라이브 안을 들여다본다
const drive = () => ev(`(() => {
  const d = JSON.parse(sessionStorage.getItem('fakedrive') || '{}');
  return JSON.stringify(Object.keys(d).map(k => ({ name: d[k].name, bytes: (d[k].body||'').length })));
})()`).then(JSON.parse);
const uploads = () => ev(`JSON.stringify(window.__up || [])`).then(JSON.parse);
// 목록 첫 카드의 📌 를 누른다 — saveIndex() 를 부르는 가장 짧은 길
const pin = () => ev(`(() => {
  const b = document.querySelector('.pinbtn');
  if (!b) return 'NO_PIN';
  b.click(); return 'CLICKED';
})()`);

/* ═══ ① 작을 때는 나누지 않는다 — 옛 버전으로 열어도 그대로 보여야 한다 ═══ */
await open(seed(3, 50));
check("가짜 드라이브에 붙었다", (await ev(`window.__calls || 0`)) > 0,
  `구글 호출 ${await ev(`window.__calls || 0`)}회`);
check("기록 3편이 화면에 떴다", (await ev(`document.querySelectorAll('.card.entry, .entry').length`)) >= 3,
  `카드 ${await ev(`document.querySelectorAll('.card.entry, .entry').length`)}장`);

check("📌 을 누를 수 있다", (await pin()) === "CLICKED");
await wait(1200);
let files = await drive();
const smallIdx = files.find(f => f.name === "TRACE-index.json");
check("작은 색인은 한 파일에 그대로 둔다", !!smallIdx && !files.some(f => /^TRACE-index-/.test(f.name)),
  files.map(f => f.name).join(" · ") || "빈 드라이브");
check("옛 버전도 읽을 수 있는 모양이다 (entries 가 그 안에 있다)",
  (await ev(`(() => {
    const d = JSON.parse(sessionStorage.getItem('fakedrive')||'{}');
    const f = Object.values(d).find(x => x.name === 'TRACE-index.json');
    const j = JSON.parse(f.body);
    return j.version === 3 && Array.isArray(j.entries) && j.entries.length === 3;
  })()`)) === true);

/* ═══ ② 커지면 조각으로 나뉜다 ═══ */
await ev(`sessionStorage.removeItem('fakedrive')`);
await open(seed(400, 1200));            // 400편 × 1200자 ≈ 500KB
check("기록 400편을 심었다", (await ev(`JSON.parse(localStorage.getItem('trace.entries.v2')||'[]').length`)) === 400);
check("📌 을 누를 수 있다 (큰 색인)", (await pin()) === "CLICKED");
await wait(3000);
files = await drive();
const shards = files.filter(f => /^TRACE-index-[0-9a-f]{2}\.json$/.test(f.name));
check("색인이 커지면 조각으로 나뉜다", shards.length >= 2,
  `조각 ${shards.length}개 · ${shards.map(s => s.name.replace("TRACE-index-", "")).join(",")}`);
check("조각 하나가 한 아름(256KB)을 넘지 않는다", shards.every(s => s.bytes <= 256 * 1024),
  `가장 큰 조각 ${Math.max(...shards.map(s => s.bytes))}바이트`);
const man0 = await ev(`(() => {
  const d = JSON.parse(sessionStorage.getItem('fakedrive')||'{}');
  const f = Object.values(d).find(x => x.name === 'TRACE-index.json');
  return f ? f.body : '';
})()`);
check("목차에는 조각의 자리만 적힌다", (() => {
  try { const j = JSON.parse(man0); return j.version === 4 && j.shards.length === shards.length && !j.entries; }
  catch { return false; }
})(), man0.slice(0, 60));

/* ═══ ③ 하나를 고치면 «그 조각만» 다시 올라간다 — 이것이 이 작업의 이유다 ═══ */
await ev(`window.__up = []`);
await pin();                             // 고정을 풀었다 = 기록 하나가 바뀌었다
await wait(2500);
const up = await uploads();
const idxUp = up.filter(x => /^TRACE-index/.test(x.name));
const shardUp = idxUp.filter(x => x.name !== "TRACE-index.json");
const totalIdx = shards.reduce((a, s) => a + s.bytes, 0);
const sentBytes = idxUp.reduce((a, x) => a + x.bytes, 0);
check("고친 기록이 든 조각 하나만 다시 올린다", shardUp.length === 1,
  `다시 올린 조각 ${shardUp.length}개: ${shardUp.map(x => x.name).join(",")}`);
check("통째로 올리지 않는다", sentBytes < totalIdx / 2,
  `${sentBytes}바이트 올림 (색인 전체는 ${totalIdx}바이트)`);

/* ═══ ④ 새로 켠 기기에서도 400편이 다 돌아온다 ═══ */
await ev(`sessionStorage.setItem('keepdrive','1')`);
await send("Page.navigate", { url: "about:blank" });
await wait(200);
await send("Page.navigate", { url: URL_ });
await wait(600);
await ev(BOOT);
await ev(`localStorage.removeItem('trace.entries.v2')`);   // 이 기기에는 아무것도 없는 상태로
await send("Page.navigate", { url: URL_ });
await wait(4000);
const back = await ev(`JSON.parse(localStorage.getItem('trace.entries.v2')||'[]').length`);
check("빈 기기에서도 조각을 다 읽어 400편이 돌아온다", back === 400, `${back}편`);

/* ═══ ⑤ 조각 하나를 못 읽으면 «덮어쓰지 않는다» — 가장 중요한 곳 ═══ */
const victim = shards[0].name;
await ev(`sessionStorage.setItem('break', ${JSON.stringify(victim)})`);
await send("Page.navigate", { url: "about:blank" });
await wait(200);
await send("Page.navigate", { url: URL_ });
await wait(600);
await ev(BOOT);
await ev(`localStorage.removeItem('trace.entries.v2')`);
await send("Page.navigate", { url: URL_ });
await wait(4000);
await ev(`window.__up = []`);
await pin();                             // 이 상태에서 저장을 눌러 본다
await wait(2500);
const upBroken = (await uploads()).filter(x => /^TRACE-index/.test(x.name));
check("조각을 못 읽으면 색인을 한 글자도 덮어쓰지 않는다", upBroken.length === 0,
  upBroken.map(x => x.name).join(",") || "덮어쓴 것 없음");
const still = await drive();
check("드라이브의 조각도 그대로 남아 있다",
  still.filter(f => /^TRACE-index-[0-9a-f]{2}\.json$/.test(f.name)).length === shards.length,
  `조각 ${still.filter(f => /^TRACE-index-/.test(f.name)).length}개`);
check("사람에게도 알린다", (await ev(`(document.body.textContent||'').includes('덮어쓰지 않습니다')`)) === true);

/* ═══ ⑥ 옛 버전이 목차를 덮어써도, 남은 조각을 함께 읽는다 ═══ */
await ev(`sessionStorage.removeItem('break')`);
// 옛 버전이 저장한 것처럼 — 목차 자리에 «기록 1편만 든 v3 색인» 을 밀어 넣는다
await ev(`(() => {
  const d = JSON.parse(sessionStorage.getItem('fakedrive')||'{}');
  const k = Object.keys(d).find(k => d[k].name === 'TRACE-index.json');
  d[k].body = JSON.stringify({ version: 3, app: 'TRACE', entries: [{
    id: 'old1', type: 'experience', title: '옛 버전이 남긴 기록', tags: [], blocks: [],
    relations: [], pinned: false, createdAt: 1600000000000, updatedAt: 1600000000000
  }], deleted: [] });
  sessionStorage.setItem('fakedrive', JSON.stringify(d));
  return true;
})()`);
await send("Page.navigate", { url: "about:blank" });
await wait(200);
await send("Page.navigate", { url: URL_ });
await wait(600);
await ev(BOOT);
await ev(`localStorage.removeItem('trace.entries.v2')`);
await send("Page.navigate", { url: URL_ });
await wait(5000);
const mixed = JSON.parse(await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('trace.entries.v2')||'[]');
  return JSON.stringify({ n: L.length, hasOld: L.some(e => e.id === 'old1') });
})()`));
check("옛 형식으로 덮여도 조각을 찾아 함께 읽는다", mixed.n >= 401 && mixed.hasOld,
  `기록 ${mixed.n}편 · 옛 것 ${mixed.hasOld ? "있음" : "없음"}`);

/* ═══ ⑦ 기록이 더 늘어 조각을 다시 나눠도 하나도 안 빠진다 ═══ */
await ev(`sessionStorage.removeItem('fakedrive')`);
await open(seed(400, 1200));
await pin();
await wait(3000);
const before7 = (await drive()).filter(f => /^TRACE-index-[0-9a-f]{2}\.json$/.test(f.name)).length;
// 400편을 더 얹는다 — 조각 하나가 한 아름을 넘어 «다시 나누기» 가 일어나야 한다
await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('trace.entries.v2') || '[]');
  const body = new Array(1201).join('나');
  for (let i = 400; i < 800; i++) L.push({
    id: 'n' + i, type: 'experience', title: '기록 ' + i, tags: ['시험'],
    blocks: [{ id: 'b' + i, kind: 'text', text: body }],
    relations: [], pinned: false,
    createdAt: 1700000000000 - i * 1000, updatedAt: 1700000000000 - i * 1000,
    mdId: 'MD' + i, mdName: '기록 ' + i + '.md'
  });
  localStorage.setItem('trace.entries.v2', JSON.stringify(L));
  return L.length;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(4000);
await pin();
await wait(6000);
const after7 = (await drive()).filter(f => /^TRACE-index-[0-9a-f]{2}\.json$/.test(f.name)).length;
check("기록이 늘면 조각을 더 잘게 다시 나눈다", after7 > before7, `조각 ${before7}개 → ${after7}개`);
await ev(`localStorage.removeItem('trace.entries.v2')`);
await send("Page.navigate", { url: URL_ });
await wait(6000);
const back7 = await ev(`JSON.parse(localStorage.getItem('trace.entries.v2')||'[]').length`);
check("다시 나눈 뒤에도 800편이 하나도 안 빠진다", back7 === 800, `${back7}편`);

/* ═══ ⑧ 지운 것은 조각에서도 빠지고, 다른 기기에서 되살아나지 않는다 ═══ */
const delRes = await ev(`(() => {
  const b = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('🗑️ 삭제'));
  if (!b) return 'NO_DEL';
  b.click(); return 'OPENED';
})()`);
await wait(600);
const okRes = await ev(`(() => {
  const y = Array.from(document.querySelectorAll('.modal-bg button, .card.modal button'))
    .find(b => (b.textContent||'').trim() === '삭제');
  if (!y) return 'NO_OK';
  y.click(); return 'CONFIRMED';
})()`);
await wait(5000);
check("기록 하나를 지울 수 있다", delRes === "OPENED" && okRes === "CONFIRMED", delRes + "/" + okRes);
await ev(`localStorage.removeItem('trace.entries.v2')`);
await send("Page.navigate", { url: URL_ });
await wait(6000);
const back8 = await ev(`JSON.parse(localStorage.getItem('trace.entries.v2')||'[]').length`);
check("지운 기록은 조각에서도 빠진다 (되살아나지 않는다)", back8 === 799, `${back8}편`);

/* ---- 마무리 ---- */
const real = errors.filter(e => !/favicon|manifest|sw\.js|gsi|accounts\.google/i.test(String(e)));
check("콘솔에 빨간 오류가 없다", real.length === 0, real.slice(0, 2).join(" | "));

const bad = results.filter(r => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} 통과`);
try { ws.close(); } catch {}
edge.kill();
process.exit(bad ? 1 : 0);
