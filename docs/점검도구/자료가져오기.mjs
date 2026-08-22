/* 「📥 폴더 훑어서 가져오기」가 글(.md) 말고 «자료» 까지 끌어오는지 본다.

   진짜 드라이브에 붙으려면 로그인이 필요해서, 여기서는 «가짜 드라이브» 를 앞에 세운다.
   페이지가 뜨기 전에 window.fetch 를 갈아 끼워, 구글에 나가는 물음을 전부 가로채
   미리 짜 둔 폴더 나무로 답한다. 그래서 계정 없이도 끝까지 돌려 볼 수 있다.

   ⚠️ 이 점검은 «색인에 무엇이 들어오는가» 만 본다.
      드라이브에 실제로 무엇이 올라가는지는 여전히 실제 계정으로 봐야 한다.

   실행:  node docs/점검도구/자료가져오기.mjs [url] */
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] || "http://localhost:8000/";
const PORT = 9351;
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "trace-import-"));
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
   가짜 드라이브 — 십삼 년치 폴더를 작게 줄여 놓은 것

   ROOT 내 폴더/
    ├ 2019/ 3학년/ 과학/        ← 세 겹 안쪽. 태그가 여기서 나와야 한다
    │    ├ 물의 상태변화 학습지.hwp
    │    ├ 수업사진.jpg
    │    └ 2단원 단원평가.pptx
    ├ 연수/
    │    ├ 2019-05-02_경험_연수 다녀옴.md   ← 글. 안을 읽어 되살린다
    │    ├ 연수사진.png                      ← 그 글이 부르는 사진. 따로 세우면 안 된다
    │    └ 강의자료.pdf
    ├ 사진많은폴더/  사진 1100장             ← 1000장이 넘어 «쪽» 이 나뉜다
    ├ .DS_Store · ~$임시.docx                ← 부스러기. 들어오면 안 된다
    ├ 연수 다녀옴.md (바로가기)              ← 표지판. 들어오면 기록이 두 배가 된다
    └ 2020 학급운영계획 (구글 문서)          ← 내려받을 실체가 없다. 링크로 걸어야 한다
   --------------------------------------------------------- */
const FAKE_DRIVE = `(function () {
  /* 이 씨앗은 «쪽이 뜰 때마다» 돈다. 그래서 그냥 비우면 새로고침 한 번에
     점검이 심어 둔 것이 통째로 날아간다. 지켜야 할 때는 빗장(keep)을 걸어 둔다. */
  if (!sessionStorage.getItem('keep')) localStorage.clear();
  localStorage.setItem('trace.connected', '1');
  localStorage.setItem('trace.folder', JSON.stringify({ id: 'ROOT', name: '내 폴더', link: '' }));
  localStorage.setItem('trace.token.v1', JSON.stringify({ t: 'FAKE_TOKEN', exp: Date.now() + 3600000 }));
  localStorage.setItem('trace.email', 'teacher@example.com');

  var FOLDER = 'application/vnd.google-apps.folder';
  function f(id, name, mime, extra) {
    var o = { id: id, name: name, mimeType: mime, size: '1234',
      createdTime: '2019-03-02T01:00:00.000Z', modifiedTime: '2020-06-01T01:00:00.000Z' };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }
  var T = {};
  T.ROOT = [
    f('D2019', '2019', FOLDER),
    f('DYEONSU', '연수', FOLDER),
    f('DMANY', '사진많은폴더', FOLDER),
    f('JUNK1', '.DS_Store', 'application/octet-stream'),
    f('JUNK2', '~$임시.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    f('SC1', '2019-05-02_경험_연수 다녀옴.md', 'application/vnd.google-apps.shortcut'),
    f('GD1', '2020 학급운영계획', 'application/vnd.google-apps.document',
      { webViewLink: 'https://docs.google.com/document/d/GD1/edit' })
  ];
  T.D2019 = [ f('D3', '3학년', FOLDER) ];
  T.D3    = [ f('DSCI', '과학', FOLDER) ];
  T.DSCI  = [
    f('H1', '물의 상태변화 학습지.hwp', 'application/octet-stream'),
    f('P1', '수업사진.jpg', 'image/jpeg'),
    f('S1', '2단원 단원평가.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  ];
  T.DYEONSU = [
    f('MD1', '2019-05-02_경험_연수 다녀옴.md', 'text/markdown'),
    f('IMG1', '연수사진.png', 'image/png'),
    f('PDF1', '강의자료.pdf', 'application/pdf')
  ];
  T.root = T.ROOT;   // 진짜 드라이브에서 'root' 는 「내 드라이브」의 별칭이다
  T.DMANY = [];
  for (var i = 1; i <= 1100; i++) T.DMANY.push(f('M' + i, '사진' + i + '.jpg', 'image/jpeg'));

  var MD1 = ['---','title: 연수 다녀옴','type: 경험','tags: [연수]','---','',
             '# 연수 다녀옴','','오늘 연수를 다녀왔다.','','![강당](연수사진.png)',''].join('\\n');

  /* 원본을 건드리는 요청은 «따로 적어 둔다».
     이 점검에서 가장 중요한 것은 «무엇이 들어왔나» 가 아니라
     «십삼 년치 원본에 손을 댔나» 이기 때문이다. */
  window.__fake = { calls: 0, pages: 0, lists: 0, trashed: [], moved: [], renamed: [], shared: [] };
  var realFetch = window.fetch.bind(window);
  function J(o) {
    return Promise.resolve(new Response(JSON.stringify(o),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  window.fetch = function (url, opts) {
    var u = String(url && url.url ? url.url : url);
    if (u.indexOf('googleapis.com') < 0) return realFetch(url, opts);
    window.__fake.calls++;
    var method = (opts && opts.method) || 'GET';
    if (u.indexOf('/userinfo') >= 0) return J({ email: 'teacher@example.com' });
    if (method !== 'GET') {
      var body = String((opts && opts.body) || '');
      var who = (/files\\/([\\w-]+)/.exec(u) || ['', ''])[1];
      if (/"trashed"\\s*:\\s*true/.test(body)) window.__fake.trashed.push(who);
      if (u.indexOf('addParents=') >= 0) window.__fake.moved.push(who);
      if (u.indexOf('/permissions') >= 0) window.__fake.shared.push(who);
      if (who && /"name"\\s*:/.test(body) && u.indexOf('/upload/') < 0) window.__fake.renamed.push(who);
      return J({ id: 'NEW' + window.__fake.calls, name: 'saved' });
    }
    if (u.indexOf('alt=media') >= 0) {
      var mm = /files\\/([\\w-]+)\\?/.exec(u);
      return Promise.resolve(new Response(mm && mm[1] === 'MD1' ? MD1 : '', { status: 200 }));
    }
    if (u.indexOf('/files?') < 0) {                       // 파일 하나 확인 (verifyFolder)
      var mv = /files\\/([\\w-]+)\\?/.exec(u);
      var fid = mv ? mv[1] : 'ROOT';
      return J({ id: fid, name: fid === 'ROOT' ? '내 폴더' : fid, mimeType: FOLDER });
    }
    var q = decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || ['', ''])[1]);
    // 이름으로 찾는 물음(색인·설정 파일)에는 «없다» 고 답한다 — 앱이 새로 만들게
    if (q.indexOf("name=") >= 0 || q.indexOf("name contains") >= 0) return J({ files: [] });
    var mp = /'([\\w-]+)' in parents/.exec(q);
    if (!mp) return J({ files: [] });
    window.__fake.lists++;
    var kids = T[mp[1]] || [];
    var tok = /[?&]pageToken=([^&]*)/.exec(u);
    var start = tok ? Number(decodeURIComponent(tok[1])) : 0;
    var out = { files: kids.slice(start, start + 1000) };
    if (start + 1000 < kids.length) { out.nextPageToken = String(start + 1000); window.__fake.pages++; }
    return J(out);
  };
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

/* 페이지가 뜨기 «전에» 심어야 앱이 첫 물음부터 가짜 드라이브에 걸린다 */
await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_DRIVE });
await send("Page.navigate", { url: URL_ });
await wait(3500);

const hooked = await ev(`JSON.stringify({ calls: (window.__fake||{}).calls, chip: (document.querySelector('.pill, .chip, #syncPill')||{}).textContent || '' })`);
check("가짜 드라이브에 붙었다", JSON.parse(hooked).calls > 0, `구글 호출 ${JSON.parse(hooked).calls}회`);

/* ---- 설정 → 고급 → 📥 를 실제로 누른다 ---- */
async function pressImport() {
  // 열려 있는 창을 «전부» 치운다 — 하나만 지우면 뒤에 겹친 창이 단추를 가린다
  await ev(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
  await ev(`document.getElementById('btnSettings').click(); true`);
  await wait(500);
  await ev(`(() => {
    const t = Array.from(document.querySelectorAll('.tabs .tab')).find(x => x.textContent === '고급');
    t.click(); return true;
  })()`);
  await wait(400);
  return ev(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('폴더 훑어서 가져오기'));
    if (!b) return 'NO_BUTTON';
    if (b.disabled) return 'DISABLED';
    b.click(); return 'CLICKED';
  })()`);
}

const pressed = await pressImport();
check("«폴더 훑어서 가져오기» 를 누를 수 있다", pressed === "CLICKED", String(pressed));

/* 폴더 6곳 + 사진 1100장(두 쪽) — 다 훑을 때까지 기다린다 */
let ask = "";
for (let i = 0; i < 60; i++) {
  ask = await ev(`(() => {
    const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('자료도 함께'));
    return m ? m.textContent : '';
  })()`);
  if (ask) break;
  await wait(500);
}
check("훑기가 끝나면 물어본다", !!ask, ask ? ask.slice(0, 30) : "안 물어봄");

const paged = JSON.parse(await ev(`JSON.stringify(window.__fake)`));
check("1000장이 넘는 폴더도 쪽을 넘겨 다 받는다", paged.pages >= 1, `나뉜 쪽 ${paged.pages}회 · 목록 물음 ${paged.lists}회`);

check("무엇이 몇 개인지 미리 보여 준다",
  ask.includes("사진 1101개") && ask.includes("한글 1개") && ask.includes("PDF 1개") &&
  ask.includes("발표 1개") && ask.includes("구글 문서 1개"),
  (ask.match(/· [^\n]+/g) || []).join(" ").slice(0, 76));
/* 폴더에 놓인 것은 1110개다. 그 가운데 글 1편·그 글의 사진 1장·부스러기 2개·바로가기 1개를
   뺀 1105개만 «자료» 다. 하나라도 더 세면 안 세야 할 것을 세고 있는 것이다. */
check("글·바로가기·부스러기는 자료로 세지 않는다", /자료가 1105개/.test(ask),
  (ask.match(/자료가 \d+개/) || ["못 찾음"])[0]);

/* ---- 먼저 «취소» — 글만 들어오고 자료는 한 개도 안 들어와야 한다 ---- */
await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('자료도 함께'));
  const b = Array.from(m.querySelectorAll('button')).find(b => b.textContent === '취소');
  b.click(); return true;
})()`);
await wait(1500);

const afterNo = JSON.parse(await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('trace.entries.v2') || '[]');
  return JSON.stringify({ n: L.length, titles: L.map(e => e.title) });
})()`));
check("취소하면 자료는 안 들어온다", afterNo.n === 1, `기록 ${afterNo.n}편: ${afterNo.titles.join(", ")}`);
check("글(.md)은 안을 읽어 되살린다", afterNo.titles[0] === "연수 다녀옴", afterNo.titles[0] || "");

/* ---- 다시 눌러 «가져오기» ---- */
const pressed2 = await pressImport();
check("한 번 더 누를 수 있다", pressed2 === "CLICKED", String(pressed2));
for (let i = 0; i < 60; i++) {
  const has = await ev(`Array.from(document.querySelectorAll('.card.modal')).some(x => (x.textContent||'').includes('자료도 함께'))`);
  if (has) break;
  await wait(500);
}
await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('자료도 함께'));
  const b = Array.from(m.querySelectorAll('button')).find(b => b.textContent === '가져오기');
  b.click(); return true;
})()`);
await wait(6000);

const got = JSON.parse(await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('trace.entries.v2') || '[]');
  const by = t => L.filter(e => e.title === t);
  const one = t => by(t)[0] || null;
  return JSON.stringify({
    n: L.length,
    md: by('연수 다녀옴').length,
    hwp: one('물의 상태변화 학습지'),
    ppt: one('2단원 단원평가'),
    pdf: one('강의자료'),
    jpg: one('수업사진'),
    gdoc: one('2020 학급운영계획'),
    sidecar: by('연수사진').length,
    junk: L.filter(e => /DS_Store|임시/.test(e.title)).length,
    photos: L.filter(e => /^사진\\d+$/.test(e.title)).length,
    types: Array.from(new Set(L.map(e => e.type))).join(",")
  });
})()`));

check("한글 파일이 기록으로 선다", !!got.hwp, got.hwp ? got.hwp.title : "없음");
check("거쳐 온 폴더 이름이 태그가 된다",
  !!got.hwp && ["2019", "3학년", "과학"].every(t => (got.hwp.tags || []).includes(t)),
  got.hwp ? JSON.stringify(got.hwp.tags) : "");
check("발표·PDF도 함께 들어온다", !!got.ppt && !!got.pdf);
check("파일은 원본을 가리키기만 한다 (첨부 블록)",
  !!got.hwp && got.hwp.blocks[0].kind === "file" && got.hwp.blocks[0].fileId === "H1",
  got.hwp ? got.hwp.blocks[0].kind + " · " + got.hwp.blocks[0].fileId : "");
check("사진은 사진 블록으로 들어온다",
  !!got.jpg && got.jpg.blocks[0].kind === "image" && got.jpg.blocks[0].fileId === "P1",
  got.jpg ? got.jpg.blocks[0].kind : "");
check("구글 문서는 링크로 건다",
  !!got.gdoc && got.gdoc.blocks[0].kind === "link" && /docs.google.com/.test(got.gdoc.blocks[0].url),
  got.gdoc ? got.gdoc.blocks[0].kind : "");
check("글에 딸린 사진은 따로 세우지 않는다", got.sidecar === 0, `«연수사진» 으로 선 기록 ${got.sidecar}편`);
check("부스러기(.DS_Store · ~$)는 안 들어온다", got.junk === 0, `${got.junk}개`);
check("바로가기 때문에 글이 두 번 들어오지 않는다", got.md === 1, `«연수 다녀옴» ${got.md}편`);
check("1000장이 넘는 사진도 한 장도 안 빠진다", got.photos === 1100, `${got.photos}/1100장`);
check("자료는 «자료» 유형으로 선다", got.types.includes("material"), got.types);

/* ---- 또 눌러도 늘어나지 않아야 한다 ----
   여기가 이 점검에서 가장 무거운 자리다. 여기가 깨지면 누를 때마다 목록이 불어난다.
   실제로 두 군데가 새고 있었다.
     ① 「태그가 곧 폴더」 가 놓은 «.md 바로가기» 를 진짜 글로 알고 매번 다시 읽었다
     ② 구글 문서는 링크 블록이라 fileId 가 안 남아, 매번 «처음 보는 것» 으로 여겼다 */
const before = got.n;
const pressed3 = await pressImport();
let again = "";
for (let i = 0; i < 40; i++) {
  again = await ev(`(() => {
    const s = document.querySelector('.mfoot .desc');
    return s ? s.textContent : '';
  })()`);
  if (/없습니다|가져왔습니다/.test(again)) break;
  await wait(500);
}
const asked = await ev(`Array.from(document.querySelectorAll('.card.modal')).some(x => (x.textContent||'').includes('자료도 함께'))`);
const after = Number(await ev(`JSON.parse(localStorage.getItem('trace.entries.v2') || '[]').length`));
check("또 눌러도 물어보지 않는다 (남은 자료가 없다)", !asked, asked ? "또 물어봄" : "안 물어봄");
check("또 눌러도 목록이 불어나지 않는다", after === before, `${before} → ${after}`);
check("«.md 바로가기» 를 글로 착각하지 않는다",
  pressed3 === "CLICKED" && !/글 \d+편을 읽는 중/.test(again) && /없습니다/.test(again),
  again.slice(0, 46));
check("구글 문서도 두 번 들어오지 않는다",
  Number(await ev(`JSON.parse(localStorage.getItem('trace.entries.v2')||'[]').filter(e => e.title === '2020 학급운영계획').length`)) === 1);

/* =========================================================
   가져온 «뒤» — 여기서부터가 진짜 위험한 자리다

   목록에 세우는 것까지는 되돌릴 수 있다. 되돌릴 수 없는 것은
   **십삼 년치 원본에 손을 대는 것**이다. 고치고·빼고·지우고·옮겨 보면서
   원본(H1)과 원본이 든 폴더(DSCI)에 손이 가는지 «요청 단위로» 지켜본다.
   ========================================================= */
await ev(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove());
  window.__fake.trashed = []; window.__fake.moved = []; window.__fake.renamed = []; return true; })()`);
await wait(300);

// 목록이 1100편이라 화면에서 찾기 어렵다. 검색으로 좁힌다.
async function findOne(word) {
  return ev(`(() => {
    const q = document.getElementById('search');
    if (!q) return 'NO_SEARCH';
    q.value = ${JSON.stringify(word)};
    q.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`);
}
const searched = await findOne("물의 상태변화");
await wait(700);
const narrowed = Number(await ev(`document.querySelectorAll('.card.entry, .lrow').length`));
check("검색으로 가져온 자료를 찾을 수 있다", searched === "OK" && narrowed >= 1 && narrowed < 50,
  `${narrowed}편으로 좁혀짐`);

/* ---- ① 전체 보기 → «📁 원본 폴더» 로 데려다 주는가 ---- */
const viewer = await ev(`(() => {
  const b = Array.from(document.querySelectorAll('.card.entry button')).find(b => (b.textContent||'').includes('전체 보기'));
  if (!b) return 'NO_BUTTON';
  b.click();
  const tops = Array.from(document.querySelectorAll('.viewer .vtop a, .viewer .vtop button')).map(x => x.textContent.trim());
  return JSON.stringify({ tops: tops, paper: (document.querySelector('.vpaper')||{}).textContent || '' });
})()`);
const vv = /^NO_/.test(viewer) ? null : JSON.parse(viewer);
check("가져온 자료도 전체 보기가 열린다", !!vv && vv.paper.includes("물의 상태변화"),
  vv ? vv.paper.replace(/\s+/g, " ").slice(0, 34) : String(viewer));
check("«📁 원본 폴더» 로 데려다 준다 (내 폴더인 척하지 않는다)",
  !!vv && vv.tops.some(t => t.includes("원본 폴더")) && !vv.tops.some(t => t === "📁 폴더"),
  vv ? vv.tops.join(" | ") : "");

/* ---- ② 고쳐서 저장 — 원본을 옮기거나 이름을 바꾸면 안 된다 ---- */
await ev(`(() => {
  const b = Array.from(document.querySelectorAll('.viewer .vtop button')).find(b => b.textContent.includes('편집'));
  if (b) b.click(); return true;
})()`);
await wait(700);
const loaded = await ev(`document.getElementById('title').value`);
check("가져온 자료를 편집으로 불러온다", loaded === "물의 상태변화 학습지", String(loaded));

await ev(`(() => {
  const t = document.getElementById('title');
  t.value = '물의 상태변화 학습지 — 다시 보니 3차시용';
  t.dispatchEvent(new Event('input', { bubbles: true }));
  const g = document.getElementById('tags');
  if (g) { g.value = '2019, 3학년, 과학, 다시쓸것'; g.dispatchEvent(new Event('input', { bubbles: true })); }
  document.getElementById('btnSave').click(); return true;
})()`);
await wait(4000);

const afterEdit = JSON.parse(await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('trace.entries.v2') || '[]');
  const n = L.find(e => /3차시용/.test(e.title || ''));
  return JSON.stringify({
    saved: !!n, tags: n ? n.tags : [], srcId: n ? n.srcId : null,
    stillPoints: !!(n && (n.blocks||[]).some(b => b.fileId === 'H1')),
    folderId: n ? (n.folderId || null) : null,
    f: window.__fake
  });
})()`));
check("고쳐서 저장하면 목록에 반영된다", afterEdit.saved && afterEdit.tags.includes("다시쓸것"),
  afterEdit.saved ? afterEdit.tags.join(",") : "저장 안 됨");
check("고쳐 저장해도 원본은 제자리에 있다 (안 옮긴다)",
  !afterEdit.f.moved.includes("H1"), `옮긴 것: ${afterEdit.f.moved.join(",") || "없음"}`);
check("고쳐 저장해도 원본 이름을 안 바꾼다",
  !afterEdit.f.renamed.includes("H1"), `이름 바꾼 것: ${afterEdit.f.renamed.join(",") || "없음"}`);
check("고쳐 저장해도 원본은 그대로 가리킨다", afterEdit.stillPoints);
check("가져온 자료는 남의 폴더를 «자기 폴더» 로 삼지 않는다",
  afterEdit.folderId !== "DSCI", `folderId = ${afterEdit.folderId}`);

/* ---- ③ 첨부 줄을 빼고 저장 — 여기서 원본이 휴지통에 가면 안 된다 ---- */
await ev(`(() => { window.__fake.trashed = []; document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await findOne("3차시용");
await wait(700);
const removedBlock = await ev(`(() => {
  const b = Array.from(document.querySelectorAll('.card.entry button')).find(b => (b.textContent||'').includes('전체 보기'));
  if (!b) return 'NO_CARD';
  b.click();
  const e = Array.from(document.querySelectorAll('.viewer .vtop button')).find(x => x.textContent.includes('편집'));
  if (!e) return 'NO_EDIT';
  e.click();
  return 'OK';
})()`);
await wait(800);
const wiped = await ev(`(() => {
  // 첨부 블록을 지우는 단추를 찾아 누른다
  const host = document.querySelector('[data-bid]');
  if (!host) return 'NO_BLOCK';
  const del = Array.from(document.querySelectorAll('[data-bid] button')).find(b => /삭제|✕|×|🗑/.test(b.textContent||''));
  if (!del) return 'NO_DEL';
  del.click();
  return 'OK';
})()`);
await wait(400);
await ev(`(() => { document.getElementById('btnSave').click(); return true; })()`);
await wait(3000);
const trashedAfterWipe = JSON.parse(await ev(`JSON.stringify(window.__fake.trashed)`));
check("첨부 줄을 빼고 저장해도 원본을 안 버린다",
  removedBlock === "OK" && !trashedAfterWipe.includes("H1"),
  `${removedBlock} · 휴지통: ${trashedAfterWipe.join(",") || "없음"}`);

/* ---- ④ 지우기 — 가장 위험한 자리 ----
   전에는 folderId 에 원본 폴더가 들어 있어서, 한 편 지우면 그 폴더가 통째로 갔다.
   즉 「학습지 하나 지우기」가 「2019/3학년/과학/ 통째로 버리기」였다. */
await ev(`(() => { window.__fake.trashed = []; document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await findOne("수업사진");
await wait(700);
await ev(`(() => {
  const b = Array.from(document.querySelectorAll('.card.entry button')).find(b => /삭제|🗑/.test(b.textContent||''));
  if (b) b.click(); return true;
})()`);
await wait(500);
const delAsk = await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('삭제할까요'));
  return m ? m.textContent : 'NO_MODAL';
})()`);
check("지우기 전에 «원본은 그대로» 라고 알려 준다",
  /원본 파일은 그대로 남습니다/.test(delAsk) && !/휴지통으로 이동합니다/.test(delAsk),
  delAsk.replace(/\s+/g, " ").slice(0, 60));

await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('삭제할까요'));
  const yes = Array.from(m.querySelectorAll('button')).find(b => b.textContent === '삭제');
  yes.click(); return true;
})()`);
await wait(2500);
const afterDel = JSON.parse(await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('trace.entries.v2') || '[]');
  return JSON.stringify({ gone: !L.some(e => e.title === '수업사진'), f: window.__fake });
})()`));
check("지우면 목록에서는 빠진다", afterDel.gone);
check("지워도 원본 사진을 안 버린다", !afterDel.f.trashed.includes("P1"),
  `휴지통: ${afterDel.f.trashed.join(",") || "없음"}`);
check("⚠️ 지워도 원본이 든 폴더를 통째로 안 버린다",
  !afterDel.f.trashed.includes("DSCI") && !afterDel.f.trashed.includes("D2019"),
  `휴지통: ${afterDel.f.trashed.join(",") || "없음"}`);

/* ---- ④-2 길찾기 줄 — 이 기록이 «어디에» 있는지 ----
   폴더를 훑을 때 거쳐 온 길을 srcPath 에 남긴다. 그게 화면에서 줄로 서고,
   누르면 그 아래에 있는 것만 남아야 한다. */
await findOne("물의 상태변화 학습지");
await wait(800);
const crumb = await ev(`(() => {
  const c = document.querySelector('.card.entry .crumbs');
  if (!c) return 'NO_CRUMBS';
  return Array.from(c.children).map(e => e.textContent).join(" ");
})()`);
check("기록이 어디에 있는지 줄로 보여 준다",
  /2019/.test(crumb) && /3학년/.test(crumb) && /과학/.test(crumb) && /›/.test(crumb),
  String(crumb));

/* ⚠️ 목록 맨 위 카드를 집으면 안 된다 — 사진 1100장이 위에 깔려 있어 엉뚱한 기록의 줄을 누르게 된다.
   검색으로 좁혀 «그 기록의» 줄을 누른 다음, 검색을 풀어 남은 것을 센다. */
const clicked = await ev(`(() => {
  const c = document.querySelector('.card.entry .crumbs');
  if (!c) return 'NO_CRUMBS';
  const b = Array.from(c.querySelectorAll('.crumb')).find(x => x.textContent === '3학년');
  if (!b) return 'NO_GRADE';
  b.click();
  return 'OK';
})()`);
await ev(`(() => { const q = document.getElementById('search'); q.value=''; q.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
await wait(800);
const after2 = Number(await ev(`document.querySelectorAll('.card.entry, .lrow').length`));
check("길찾기 줄을 누르면 그 아래만 남는다",
  clicked === "OK" && after2 > 0 && after2 < 20, `${clicked} · ${after2}편`);

const chip = await ev(`(() => {
  const mark = String.fromCodePoint(0x1F4C1);
  const c = Array.from(document.querySelectorAll('.chip')).find(x => (x.textContent||'').indexOf(mark) === 0);
  return c ? c.textContent : 'NO_CHIP';
})()`);
check("어느 폴더를 보고 있는지 알려 준다", /2019/.test(chip) && /3학년/.test(chip), String(chip));

await ev(`(() => {
  const mark = String.fromCodePoint(0x1F4C1);
  const c = Array.from(document.querySelectorAll('.chip')).find(x => (x.textContent||'').indexOf(mark) === 0);
  if (c) c.click(); return true;
})()`);
await wait(800);
const restored = Number(await ev(`document.querySelectorAll('.card.entry, .lrow').length`));
check("풀면 다시 다 보인다", restored > after2, `${after2} → ${restored}편`);

/* ---- ⑤ 태그로 걸러 보기 ---- */
await ev(`(() => { const q = document.getElementById('search'); if (q) { q.value=''; q.dispatchEvent(new Event('input',{bubbles:true})); } return true; })()`);
await wait(800);
const tagged = await ev(`(() => {
  const t = Array.from(document.querySelectorAll('.tagchip, .tag, .chip')).find(x => (x.textContent||'').replace('#','').trim() === '과학');
  if (!t) return -1;
  t.click();
  return document.querySelectorAll('.card.entry, .lrow').length;
})()`);
await wait(600);
check("폴더 이름에서 온 태그로 걸러진다", Number(tagged) > 0 && Number(tagged) < 50,
  Number(tagged) < 0 ? "«과학» 태그를 못 찾음" : `${tagged}편`);

/* ---- ⑥ 폴더 찾아보기 — 탐색기처럼 눌러 들어가며 고른다 ----
   링크를 붙여넣는 길은 «주소를 아는 사람» 에게만 쉽다.
   가짜 드라이브가 폴더 나무를 들고 있으니, 실제로 눌러 들어가 본다. */
await ev(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await wait(300);
await ev(`document.getElementById('btnSettings').click(); true`);
await wait(500);
await ev(`(() => {
  const t = Array.from(document.querySelectorAll('.tabs .tab')).find(x => x.textContent === '저장 위치');
  if (t) t.click(); return true;
})()`);
await wait(500);
const opened = await ev(`(() => {
  const b = Array.from(document.querySelectorAll('.mbody button')).find(x => (x.textContent||'').includes('찾아보기'));
  if (!b) return 'NO_BUTTON';
  if (b.disabled) return 'DISABLED';
  b.click(); return 'OK';
})()`);
await wait(1200);
const browser = await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('폴더 고르기'));
  if (!m) return 'NO_MODAL';
  return JSON.stringify({
    crumbs: Array.from(m.querySelectorAll('.crumb')).map(e => e.textContent),
    rows: Array.from(m.querySelectorAll('.pickrow .fname')).map(e => e.textContent),
    icons: m.querySelectorAll('.pickrow svg').length
  });
})()`);
const br = /^NO_/.test(browser) ? null : JSON.parse(browser);
check("«폴더 찾아보기» 가 내 드라이브를 연다 (폴더만)",
  opened === "OK" && !!br && br.crumbs[0] === "내 드라이브" &&
  br.rows.length === 3 && br.rows.join(",") === "2019,연수,사진많은폴더",
  br ? `${br.crumbs.join(" › ")} — ${br.rows.join(", ")}` : `${opened} / ${browser}`);
check("폴더마다 폴더 그림이 붙는다", !!br && br.icons === br.rows.length, br ? `${br.icons}개` : "");

// 폴더를 눌러 «안으로» 들어가고, 길찾기 줄이 따라오는지
const dived = await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('폴더 고르기'));
  const row = Array.from(m.querySelectorAll('.pickrow')).find(r => (r.textContent||'').indexOf('2019') === 0);
  if (!row) return 'NO_2019';
  row.click(); return 'OK';
})()`);
await wait(1200);
const inside = await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('폴더 고르기'));
  return JSON.stringify({
    crumbs: Array.from(m.querySelectorAll('.crumb')).map(e => e.textContent),
    rows: Array.from(m.querySelectorAll('.pickrow .fname')).map(e => e.textContent)
  });
})()`);
const ins = /^NO_/.test(inside) ? null : JSON.parse(inside);
check("폴더를 눌러 안으로 들어간다",
  dived === "OK" && !!ins && ins.crumbs.length === 2 && ins.rows.indexOf("3학년") >= 0,
  ins ? `${ins.crumbs.join(" › ")} — ${ins.rows.join(", ")}` : `${dived} / ${inside}`);

// 「내 드라이브」 통째로는 못 고르게 막았는지 — 뿌리에 기록장 파일을 흩뿌리면 안 된다
const rootGuard = await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('폴더 고르기'));
  const home = Array.from(m.querySelectorAll('.crumb')).find(c => c.textContent === '내 드라이브');
  if (home) home.click();
  return 'OK';
})()`);
await wait(1000);
await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('폴더 고르기'));
  const take = Array.from(m.querySelectorAll('.mfoot button')).find(b => (b.textContent||'').includes('여기로 정하기'));
  if (take) take.click(); return true;
})()`);
await wait(500);
const stillOpen = await ev(`Array.from(document.querySelectorAll('.card.modal')).some(x => (x.textContent||'').includes('폴더 고르기'))`);
check("드라이브 맨 위는 못 고르게 막는다", rootGuard === "OK" && stillOpen === true,
  stillOpen ? "막힘" : "그냥 골라짐");
await ev(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await wait(300);

/* ---- ⑦ 웹 페이지로 공유 ----
   .html 을 드라이브에 올려 링크를 줘도 «웹페이지» 로 안 열린다 (구글이 2016년에 없앴다).
   대신 구글 문서를 «웹에 게시» 하면 사진·링크가 그대로 있는 읽는 쪽이 된다. */
await ev(`(() => {
  const q = document.getElementById('search'); q.value = '물의 상태변화 학습지';
  q.dispatchEvent(new Event('input', { bubbles: true })); return true;
})()`);
await wait(700);
await ev(`(() => {
  const v = Array.from(document.querySelectorAll('.card.entry button')).find(x => (x.textContent||'').includes('전체 보기'));
  if (v) v.click(); return true;
})()`);
await wait(700);
const shareUi = await ev(`(() => {
  const b = Array.from(document.querySelectorAll('.viewer .vtop button')).find(x => (x.textContent||'').includes('공유'));
  if (!b) return 'NO_BUTTON';
  b.click();
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('링크로 공유'));
  if (!m) return 'NO_MODAL';
  return m.textContent;
})()`);
/* 넷이 비슷해 보이면 «무엇을 눌러야 하나» 가 안 잡힌다.
   이름이 갈려 있고, 고르는 잣대가 한 줄로 있어야 한다. */
const rows = ["① 🌐 웹 쪽으로", "② 📰 구글 문서 쪽으로", "③ 📄 구글 문서 파일", "④ 📁 폴더 통째로"];
check("공유하는 길 넷이 이름으로 갈려 있다",
  rows.every(r => String(shareUi).indexOf(r) >= 0),
  rows.filter(r => String(shareUi).indexOf(r) < 0).join(" / ") || "넷 다 있음");
check("무엇을 고를지 한 줄로 알려 준다", /고르는 잣대/.test(String(shareUi)));
await ev(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await wait(300);

/* ---------- 목록 보기 = 디렉토리 · 연결을 그 자리에서 보기 ---------- */
/* ⚠️ 여기서 새로고침하면 안 된다 — 가짜 드라이브가 뜰 때 localStorage 를 비운다.
   화면에 있는 「목록」 단추를 눌러 보기 방식을 바꾼다. 사람이 하는 것과 같은 길이다. */
await ev(`(() => {
  const q = document.getElementById('search'); if (q) { q.value=''; q.dispatchEvent(new Event('input',{bubbles:true})); }
  const b = Array.from(document.querySelectorAll('.vbtn')).find(x => (x.textContent||'').includes('목록'));
  if (b) b.click();
  return !!b;
})()`);
await wait(900);
const dirList = await ev(`(() => {
  const folders = Array.from(document.querySelectorAll('.lfolder .lfname')).map(e => e.textContent);
  return JSON.stringify({
    folders: folders.slice(0, 3),
    count: folders.length,
    indented: document.querySelectorAll('.lrow.lin').length,
    icons: document.querySelectorAll('.lfolder svg').length
  });
})()`);
const dl = JSON.parse(dirList);
check("목록 보기가 디렉토리처럼 폴더로 갈린다", dl.count > 0 && dl.indented > 0 && dl.icons === dl.count,
  `폴더 ${dl.count}개 · 들여쓴 줄 ${dl.indented}개`);
check("폴더가 최신 것부터 온다", dl.folders.length < 2 || dl.folders[0] >= dl.folders[1],
  dl.folders.join(" / "));

// 폴더를 접으면 그 안의 줄이 사라져야 한다
const folded = await ev(`(() => {
  const before = document.querySelectorAll('.lrow').length;
  const f = document.querySelector('.lfolder');
  if (!f) return -1;
  f.click();
  return before - document.querySelectorAll('.lrow').length;
})()`);
await wait(500);
check("폴더를 접으면 그 안이 접힌다", Number(folded) > 0, `${folded}줄 줄어듦`);
await ev(`(() => { const f = document.querySelector('.lfolder'); if (f) f.click(); return true; })()`);
await wait(500);

/* ---- ⑧ 웹 쪽 링크는 «누른 그 순간의 사진» 이다 ----
   주소에 글과 모양이 박혀 가므로, 뒤에 고쳐도 이미 보낸 링크는 옛것이다.
   그 사실을 화면이 말해 주지 않으면 «고쳤는데 왜 그대로냐» 가 된다. */
await ev(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await wait(300);
// 링크를 이미 만들어 둔 것처럼 꾸며 놓는다 (실제 만들기는 드라이브가 필요하다)
const faked = await ev(`(() => {
  const L = JSON.parse(localStorage.getItem('trace.entries.v2') || '[]');
  const n = L.find(e => /물의 상태변화 학습지/.test(e.title || ''));
  if (!n) return 'NO_ENTRY';
  n.shareWebUrl = location.origin + '/view.html#d=FAKE';
  n.shareWebAt = Date.now();
  n.shareWebTheme = 'base';
  localStorage.setItem('trace.entries.v2', JSON.stringify(L));
  sessionStorage.setItem('keep', '1');   // 아래 새로고침에서 씨앗이 안 날아가게
  // ⚠️ 앞 점검이 보기 방식을 «목록» 으로 바꿔 놓았다. 목록에는 .card.entry 가 없다.
  const st = JSON.parse(localStorage.getItem('trace.settings.v1') || '{}');
  st.viewMode = 'stream'; st.theme = 'base';
  localStorage.setItem('trace.settings.v1', JSON.stringify(st));
  return n.title;
})()`);
await send("Page.reload", { ignoreCache: true });
await wait(3000);

async function openShare() {
  await ev(`(() => {
    const q = document.getElementById('search'); q.value = '물의 상태변화 학습지';
    q.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`);
  await wait(700);
  await ev(`(() => {
    const v = Array.from(document.querySelectorAll('.card.entry button')).find(x => (x.textContent||'').includes('전체 보기'));
    if (v) v.click(); return true;
  })()`);
  await wait(700);
  return ev(`(() => {
    const b = Array.from(document.querySelectorAll('.viewer .vtop button')).find(x => (x.textContent||'').includes('공유'));
    if (!b) return 'NO_BUTTON';
    b.click(); return 'OK';
  })()`);
}

// ① 모양이 그대로면 «낡음» 경고가 없어야 한다
const opened1 = await openShare();
await wait(800);
const fresh = await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('링크로 공유'));
  if (!m) return 'NO_MODAL';
  return JSON.stringify({
    warn: /링크를 만든 뒤에/.test(m.textContent),
    again: !!Array.from(m.querySelectorAll('button')).find(b => (b.textContent||'').includes('다시 만들기'))
  });
})()`);
const fr = /^NO_/.test(fresh) ? null : JSON.parse(fresh);
check("갓 만든 링크에는 «낡음» 경고가 없다",
  opened1 === "OK" && !!fr && !fr.warn && !fr.again, fresh);

// ② 모양(프리셋)을 바꾸면 낡은 것이 되어야 한다
await ev(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await wait(300);
await ev(`(() => {
  const s = JSON.parse(localStorage.getItem('trace.settings.v1') || '{}');
  s.theme = 'brick'; localStorage.setItem('trace.settings.v1', JSON.stringify(s));
  return true;
})()`);
await send("Page.reload", { ignoreCache: true });
await wait(3000);
const opened2 = await openShare();
await wait(800);
const stale = await ev(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('링크로 공유'));
  if (!m) return 'NO_MODAL';
  return JSON.stringify({
    warn: /링크를 만든 뒤에/.test(m.textContent),
    again: !!Array.from(m.querySelectorAll('button')).find(b => (b.textContent||'').includes('다시 만들기'))
  });
})()`);
const st = /^NO_/.test(stale) ? null : JSON.parse(stale);
check("모양을 바꾸면 «다시 만들라» 고 알려 준다",
  opened2 === "OK" && !!st && st.warn && st.again, stale);
await ev(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await wait(300);

const realErrors = errors.filter(e => !/GSI_LOGGER|popup|ERR_INTERNET|ERR_NAME|gsi\/client/i.test(String(e)));
check("가져오고 고치고 지우는 내내 오류 없음", realErrors.length === 0, realErrors[0] || "");

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
edge.kill();
process.exit(failed.length ? 1 : 0);
