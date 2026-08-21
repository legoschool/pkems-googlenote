/* 구석구석 훑기 — 자동 점검이 안 건드리는 화면을 전부 열어 보고 오류를 줍는다. */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] || "http://localhost:8000/";
const PORT = 9340;

import { existsSync } from "node:fs";
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "sweep-"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1280,940",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", URL_], { stdio: "ignore" });

let ws, msgId = 0; const pending = new Map();
const errors = [];
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
    m.error ? rej(new Error(m.error.message)) : res(m.result);
    return;
  }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
};
await new Promise(r => ws.onopen = r);
await send("Runtime.enable"); await send("Page.enable");
await wait(2200);

/* 진짜처럼 쌓인 자료를 넣어 둔다 */
await ev(`(() => {
  const NM = {experience:'경험',knowledge:'지식',idea:'아이디어',material:'자료',reflect:'회고'};
  const T = [['수업설계','3학년'],['수업설계','평가'],['평가'],['학급운영','3학년'],['연수','수업설계'],['과학실험','3학년']];
  const TY = ['experience','knowledge','idea','material','reflect'];
  const TI = ['물의 상태변화 수업','온도계 사용법','2단원 형성평가','아침 맞이 루틴','원격연수 정리','알코올램프 안전'];
  const L = [];
  for (let i = 0; i < 12; i++) {
    const t = i % 6, ty = TY[i % 5];
    const d = '2026-0' + (1 + i % 8) + '-1' + (i % 9);
    L.push({
      id: 'e' + i, type: ty, title: TI[t] + (i > 5 ? ' ' + (i - 4) : ''), tags: T[t],
      relations: i > 0 ? [{ to: 'e' + (i - 1), label: '여기서 배움' }] : [],
      pinned: i === 2,
      blocks: [
        { id: 'b'+i+'a', kind: 'heading', text: '무엇을 했나' },
        { id: 'b'+i+'b', kind: 'text', text: '얼음이 녹는 동안 온도가 오르지 않는 것을 아이들이 [[온도계 사용법]] 으로 직접 확인했다.' },
        { id: 'b'+i+'c', kind: 'quote', text: '「선생님 왜 안 올라가요?」' },
        { id: 'b'+i+'d', kind: 'link', url: 'https://example.org/science', label: '참고 자료' }
      ],
      createdAt: d + 'T09:00:00.000Z', updatedAt: d + 'T09:00:00.000Z',
      mdId: 'MD' + i, mdName: d + '_' + NM[ty] + '_' + TI[t] + '.md'
    });
  }
  localStorage.setItem('trace.entries.v2', JSON.stringify(L));
  localStorage.setItem('trace.folder', JSON.stringify({id:'X', name:'05_도구개발', link:''}));
  localStorage.removeItem('trace.draft.v1');
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);

const listed = await ev(`document.querySelectorAll('.card.entry, .lrow').length`);
check("기록 목록이 그려진다", listed >= 12, `카드 ${listed}개`);

/* ---- 보기 방식 3가지 ---- */
for (const label of ["나열", "바둑판", "목록"]) {
  const r = await ev(`(() => {
    const b = Array.from(document.querySelectorAll('.vbtn')).find(b => (b.textContent||'').includes('${label}'));
    if (!b) return 'NO_BUTTON';
    b.click();
    return document.querySelectorAll('.card.entry, .lrow').length + '개';
  })()`);
  check(`보기 «${label}» 로 바뀐다`, r !== "NO_BUTTON" && !/^0개$/.test(r), String(r));
  await wait(250);
}

/* ---- 검색 · 유형 거르기 · 태그 거르기 · 고정 ---- */
// 나열 보기로 돌려놓고 검색한다
await ev(`(() => { const b = Array.from(document.querySelectorAll('.vbtn')).find(b => b.textContent.includes('나열')); if (b) b.click(); return true; })()`);
await wait(300);
const all = await ev(`document.querySelectorAll('.card.entry, .lrow').length`);
const searched = await ev(`(() => {
  const s = document.getElementById('search');
  if (!s) return 'NO_SEARCH';
  s.value = '형성평가'; s.dispatchEvent(new Event('input', {bubbles:true}));
  return document.querySelectorAll('.card.entry, .lrow').length;
})()`);
await wait(400);
check("검색이 걸러 준다", typeof searched === "number" && searched > 0 && searched < all, `전체 ${all} → ${searched}`);
await ev(`(() => { const s = document.getElementById('search'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
await wait(300);
const cleared = await ev(`document.querySelectorAll('.card.entry, .lrow').length`);
check("검색을 지우면 다시 다 보인다", cleared === all, `${cleared}개`);

const chips = await ev(`(() => {
  const c = Array.from(document.querySelectorAll('button')).find(c => /^#수업설계/.test((c.textContent||'').trim()));
  if (!c) return 'NO_CHIP';
  c.click();
  return document.querySelectorAll('.card.entry, .lrow').length;
})()`);
await wait(400);
check("태그로 거를 수 있다", typeof chips === "number" && chips > 0 && chips < all, `전체 ${all} → ${chips}`);
await ev(`(() => { const c = Array.from(document.querySelectorAll('button')).find(c => /^#수업설계/.test((c.textContent||'').trim()));
  if (c) c.click(); return true; })()`);
await wait(300);

/* ---- 관계망 ---- */
const graph = await ev(`(() => {
  document.getElementById('btnGraph').click();
  const cv = document.querySelector('.modal canvas, canvas.graph, .graphwrap canvas');
  return cv ? (cv.width + 'x' + cv.height) : 'NO_CANVAS';
})()`);
await wait(1800);
const graphDrawn = await ev(`(() => {
  const cv = Array.from(document.querySelectorAll('canvas')).find(c => c.width > 200);
  if (!cv) return 'NO_CANVAS';
  const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 40) if (d[i+3] > 10) ink++;
  return ink;
})()`);
check("관계망이 열리고 실제로 그려진다", typeof graphDrawn === "number" && graphDrawn > 100, `${graph} · 칠해진 점 ${graphDrawn}`);
await ev(`(() => { const bg = document.querySelector('.modal-bg'); if (bg) bg.remove(); return true; })()`);
await wait(300);

/* ---- 도움말 ---- */
const help = await ev(`(() => {
  document.getElementById('btnHelp').click();
  const t = Array.from(document.querySelectorAll('.tabs .tab')).map(x => x.textContent);
  return t.length ? t.join(' / ') : 'NO_TABS';
})()`);
check("도움말이 열린다", String(help) !== "NO_TABS", String(help));
await ev(`(() => { const bg = document.querySelector('.modal-bg'); if (bg) bg.remove(); return true; })()`);
await wait(300);

/* ---- 설정 탭 전부 ---- */
await ev(`document.getElementById('btnSettings').click(); true`);
await wait(500);
const tabs = await ev(`JSON.stringify(Array.from(document.querySelectorAll('.tabs .tab')).map(t => t.textContent))`);
const tabList = JSON.parse(tabs);
check("설정 탭이 다 있다", tabList.length === 5, tabList.join(" / "));
for (const t of tabList) {
  const r = await ev(`(() => {
    const b = Array.from(document.querySelectorAll('.tabs .tab')).find(x => x.textContent === ${JSON.stringify(t)});
    b.click();
    const body = document.querySelector('.mbody');
    return body ? body.textContent.trim().length : 0;
  })()`);
  await wait(250);
  check(`설정 «${t}» 칸이 그려진다`, r > 40, `${r}자`);
}
await ev(`(() => { const bg = document.querySelector('.modal-bg'); if (bg) bg.remove(); return true; })()`);
await wait(300);

/* ---- 엮어내기 ---- */
const compile = await ev(`(() => {
  const b = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('엮어내기'));
  if (!b) return 'NO_BUTTON';
  b.click();
  const body = document.querySelector('.mbody');
  return body ? body.textContent.slice(0, 40) : 'NO_MODAL';
})()`);
await wait(600);
check("엮어내기가 열린다", String(compile) !== "NO_BUTTON" && String(compile) !== "NO_MODAL", String(compile));
await ev(`(() => { const bg = document.querySelector('.modal-bg'); if (bg) bg.remove(); return true; })()`);
await wait(300);

/* ---- 전체 보기 → 편집 → 저장 ---- */
const viewer = await ev(`(() => {
  const b = Array.from(document.querySelectorAll('.card.entry button')).find(b => (b.textContent||'').includes('전체 보기'));
  if (!b) return 'NO_BUTTON';
  b.click();
  const p = document.querySelector('.vpaper');
  return p ? p.textContent.slice(0, 30).replace(/\\s+/g,' ') : 'NO_PAPER';
})()`);
check("전체 보기가 펼쳐진다", !/^NO_/.test(String(viewer)), String(viewer));
const edit = await ev(`(() => {
  const b = Array.from(document.querySelectorAll('.viewer .vtop button')).find(b => b.textContent.includes('편집'));
  if (!b) return 'NO_EDIT';
  b.click();
  return document.getElementById('title').value;
})()`);
await wait(600);
check("편집으로 불러온다", String(edit).length > 0 && edit !== "NO_EDIT", String(edit));
const saved = await ev(`(() => {
  document.getElementById('title').value = '점검용으로 고친 제목';
  document.getElementById('title').dispatchEvent(new Event('input', {bubbles:true}));
  document.getElementById('btnSave').click();
  return true;
})()`);
await wait(900);
const savedOk = await ev(`document.body.textContent.includes('점검용으로 고친 제목')`);
check("고쳐서 저장하면 목록에 반영된다", savedOk === true);

/* ---- 삭제 ---- */
// 삭제는 «정말 지울까요?» 창을 한 번 더 거친다. 그 창까지 눌러 봐야 진짜 확인이다.
const deleted = await ev(`(() => {
  const before = document.querySelectorAll('.card.entry, .lrow').length;
  const b = Array.from(document.querySelectorAll('.card.entry button')).find(b => /삭제|🗑/.test(b.textContent||''));
  if (!b) return 'NO_DELETE';
  b.click();
  return before;
})()`);
await wait(400);
const confirmed = await ev(`(() => {
  const btns = Array.from(document.querySelectorAll('.modal-bg button'));
  const yes = btns.find(b => /삭제|확인|네|예/.test(b.textContent||'') && !/취소/.test(b.textContent||''));
  if (!yes) return 'NO_CONFIRM';
  yes.click();
  return 'CONFIRMED';
})()`);
check("삭제 전에 한 번 더 묻는다", confirmed === "CONFIRMED", String(confirmed));
await wait(800);
const after = await ev(`document.querySelectorAll('.card.entry, .lrow').length`);
check("삭제하면 목록에서 빠진다", typeof deleted === "number" && after < deleted, `${deleted} → ${after}`);

/* ---- 임시저장 ---- */
await ev(`(() => {
  document.getElementById('title').value = '쓰다 만 글';
  document.getElementById('title').dispatchEvent(new Event('input', {bubbles:true}));
  return true;
})()`);
await wait(2200);
await send("Page.navigate", { url: URL_ });
await wait(2500);
const draft = await ev(`JSON.stringify({
  title: document.getElementById('title').value,
  bar: !document.getElementById('draftBar').classList.contains('hidden')
})`);
const dr = JSON.parse(draft);
check("쓰다 만 글이 되살아난다", dr.title === "쓰다 만 글" && dr.bar, dr.title);

/* ---- 다크 모드 ---- */
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await wait(500);
const dark = await ev(`(() => {
  const bg = getComputedStyle(document.body).backgroundColor;
  const fg = getComputedStyle(document.body).color;
  const lum = s => { const m = s.match(/\\d+/g); return m ? (+m[0]*0.299 + +m[1]*0.587 + +m[2]*0.114) : -1; };
  return JSON.stringify({ bg, fg, bgLum: lum(bg), fgLum: lum(fg) });
})()`);
const dk = JSON.parse(dark);
check("다크 모드에서 바탕이 어두워진다", dk.bgLum < 90, dk.bg);
check("다크 모드에서 글자가 밝다", dk.fgLum > dk.bgLum + 60, `바탕 ${Math.round(dk.bgLum)} · 글자 ${Math.round(dk.fgLum)}`);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

/* ---- 좁은 화면 ---- */
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
await wait(700);
const mobile = await ev(`JSON.stringify({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  addbar: !!document.getElementById('addbar')
})`);
const mb = JSON.parse(mobile);
check("좁은 화면에서 가로로 안 넘친다", mb.overflow <= 2, `넘침 ${mb.overflow}px`);
await send("Emulation.clearDeviceMetricsOverride");

check("훑는 동안 오류 없음", errors.length === 0, errors[0] || "");

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
edge.kill();
process.exit(failed.length ? 1 : 0);
