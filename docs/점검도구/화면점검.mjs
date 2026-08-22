/* PEER 화면 점검 — Edge 를 머리 없이 띄워 CDP 로 직접 눌러 본다.
   설치할 것 없음: 노드 24 에 들어 있는 WebSocket 만 쓴다.
   실행:  node smoke.mjs [url] */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] || "http://localhost:8000/";
const PORT = 9333;

// 엣지든 크롬이든 있는 것을 쓴다
import { existsSync } from "node:fs";
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "trace-smoke-"));
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1280,900",
  // 마이크가 없는 기계에서도 녹음을 시험할 수 있게 «가짜 마이크» 를 붙인다
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
  URL_,
], { stdio: "ignore" });

let ws, msgId = 0;
const pending = new Map();
const errors = [];
const logs = [];

/* 답이 안 오면 영원히 매달린다 — 그러면 「멈춘 채로 끝」이라 무엇이 잘못됐는지 모른다.
   30초 안에 답이 없으면 그 자리에서 실패로 알린다. */
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const t = setTimeout(() => {
      pending.delete(id);
      rej(new Error(`${method} 이 30초 안에 답하지 않았습니다`));
    }, 30000);
    pending.set(id, {
      res: v => { clearTimeout(t); res(v); },
      rej: e => { clearTimeout(t); rej(e); },
    });
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluate failed");
  return r.result.value;
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 아직 안 떴다 */ }
    await wait(250);
  }
  throw new Error("Edge 디버깅 포트에 붙지 못했습니다");
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? "  — " + detail : ""}`);
}

const wsUrl = await connect();
ws = new WebSocket(wsUrl);
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
    return;
  }
  if (m.method === "Runtime.exceptionThrown") {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  }
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");
await send("DOM.enable");
await wait(2500);

/* ---------- 1. 첫 화면 ---------- */
const boot = await evaluate(`JSON.stringify({
  title: document.title,
  editor: !!document.getElementById('blocks'),
  banner: (document.getElementById('banner')||{}).textContent || '',
  addButtons: document.querySelectorAll('[data-add]').length
})`);
const b = JSON.parse(boot);
check("첫 화면이 그려진다", b.editor && b.addButtons > 0, `＋버튼 ${b.addButtons}개`);
check("자바스크립트 오류 없음", errors.length === 0, errors[0] || "");

/* ---------- 1-2. 모양 프리셋 ----------
   처음 온 사람(기록이 하나도 없는 사람)에게는 «어떤 모양으로 쓸까요?» 를 먼저 묻는다.
   이걸 안 치우면 뒤따르는 점검이 전부 이 창에 가로막힌다 — 실제 사람도 마찬가지다. */
await wait(700);
const askedLook = await evaluate(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('어떤 모양으로'));
  return m ? Array.from(m.querySelectorAll('.themecard .themename strong')).map(e => e.textContent).join(",") : 'NO_ASK';
})()`);
check("처음 오면 모양부터 묻는다", askedLook === "블록놀이,메모지,블록,공책,기본,문서,설계도", String(askedLook));

// «블록» 을 골라 보고, 화면이 실제로 그 값으로 바뀌는지 본다
const picked = await evaluate(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('어떤 모양으로'));
  if (!m) return 'NO_MODAL';
  // 이름이 겹친다 — '블록'을 찾으면 '블록놀이'가 먼저 잡힌다. 이름 칸만 정확히 견준다.
  const c = Array.from(m.querySelectorAll('.themecard')).find(x => {
    const n = x.querySelector('.themename strong');
    return n && n.textContent === '블록';
  });
  if (!c) return 'NO_CARD';
  c.click();
  const cs = getComputedStyle(document.documentElement);
  return JSON.stringify({
    attr: document.documentElement.getAttribute('data-theme'),
    bg: cs.getPropertyValue('--bg').trim(),
    bw: cs.getPropertyValue('--bw').trim(),
    stud: cs.getPropertyValue('--stud').trim()
  });
})()`);
const pk = /^NO_/.test(picked) ? null : JSON.parse(picked);
check("고르면 그 자리에서 값이 바뀐다",
  !!pk && pk.attr === "brick" && pk.bw === "2.5px" && pk.stud === "block",
  pk ? `${pk.attr} · 테두리 ${pk.bw} · 돌기 ${pk.stud}` : String(picked));

await evaluate(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('어떤 모양으로'));
  const go = Array.from(m.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('시작하기'));
  go.click(); return true;
})()`);
await wait(500);
const kept = await evaluate(`JSON.stringify({
  saved: (JSON.parse(localStorage.getItem('trace.settings.v1')||'{}')).theme || '',
  open: !!document.querySelector('.modal-bg')
})`);
const kp = JSON.parse(kept);
check("고른 모양이 설정에 남는다", kp.saved === "brick", kp.saved || "(빈 값)");
check("고르고 나면 창이 닫힌다", !kp.open);

/* 기록 카드가 «유형 색» 을 물려받는지 — 프리셋의 핵심이다.
   색을 유형 키로 정하면 사용자가 만든 유형에 색이 없어지므로, 차례(자리)로 돌려 쓴다. */
const tinted = await evaluate(`(() => {
  const chips = Array.from(document.querySelectorAll('#typeChips .chip'));
  if (chips.length < 3) return 'NO_CHIPS';
  const v = chips.slice(0, 3).map(c => getComputedStyle(c).getPropertyValue('--c').trim());
  return JSON.stringify(v);
})()`);
const tn = /^NO_/.test(tinted) ? null : JSON.parse(tinted);
check("유형마다 다른 색이 붙는다", !!tn && new Set(tn).size >= 3, tn ? tn.join(" ") : String(tinted));

// 다시 기본으로 돌려 놓는다. 뒤따르는 점검이 «지금 화면» 기준으로 짜여 있다.
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('trace.settings.v1') || '{}');
  s.theme = 'base'; localStorage.setItem('trace.settings.v1', JSON.stringify(s));
  document.documentElement.removeAttribute('data-theme');
  return true;
})()`);

/* ---------- 1-3. 녹음 — 제목과 내용이 갈려 있는가 ----------
   전에는 받아 적은 글의 앞 60자가 «자료 제목» 이 되어 파일 이름에 통째로 박혔다.
   («2026-08-21_부기_협의회_아직 교사가 안 다듬어져서 요거 다듬어지고…_02.webm»)
   제목은 사람이 짧게 적는 칸이 따로 있어야 하고, 말한 내용은 글 블록이 맡아야 한다. */
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await wait(300);
const voiceUi = await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('[data-add]')).find(x => (x.textContent||'').includes('녹음'));
  if (!b) return 'NO_BUTTON';
  b.click();
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('녹음'));
  if (!m) return 'NO_MODAL';
  const labels = Array.from(m.querySelectorAll('.field > label')).map(e => e.textContent);
  return JSON.stringify({ labels: labels, inputs: m.querySelectorAll('.field input.inp').length });
})()`);
const vu = /^NO_/.test(voiceUi) ? null : JSON.parse(voiceUi);
check("녹음 창에 «제목» 칸이 따로 있다",
  !!vu && vu.labels.some(l => /제목/.test(l)) && vu.labels.some(l => /받아 적은 글/.test(l)) && vu.inputs >= 1,
  vu ? vu.labels.join(" / ") : String(voiceUi));

// 제목을 비운 채로 받아 적은 글만 넣어 본다 — 그 글이 «자료 제목» 으로 새면 안 된다
const voiceSplit = await evaluate(`(() => {
  const m = Array.from(document.querySelectorAll('.card.modal')).find(x => (x.textContent||'').includes('녹음'));
  const ta = m.querySelector('textarea.inp');
  ta.value = '아직 교사가 안 다듬어져서 요거 다듬어지고 나면 이제 학생은 거기에 맞게 그냥 세팅만 하거든요';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const go = Array.from(m.querySelectorAll('.mfoot button')).find(b => /넣기|담기|넣습|확인|저장/.test(b.textContent||''));
  if (go) go.click();
  return go ? 'OK' : Array.from(m.querySelectorAll('.mfoot button')).map(b=>b.textContent).join('|');
})()`);
await wait(700);
const blocksNow = await evaluate(`(() => {
  const nodes = Array.from(document.querySelectorAll('#blocks .block'));
  const txt = nodes.map(n => (n.querySelector('.bkind')||{}).textContent || '').join(',');
  const caps = nodes.map(n => { const i = n.querySelector('input.inp'); return i ? i.value : ''; }).filter(Boolean);
  return JSON.stringify({ kinds: txt, caps: caps });
})()`);
const bn = JSON.parse(blocksNow);
check("받아 적은 글이 «자료 제목» 으로 새지 않는다",
  !bn.caps.some(c => /다듬어져서/.test(c)),
  bn.caps.length ? bn.caps.join(" | ") : "(제목 칸 비어 있음)");
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove());
  blocks = []; return true; })()`).catch(() => {});
await evaluate(`(() => {
  document.querySelectorAll('#blocks .block').forEach(n => {
    const x = Array.from(n.querySelectorAll('button')).find(b => /✕|×/.test(b.textContent||''));
    if (x) x.click();
  });
  return true;
})()`);
await wait(400);

/* ---------- 1-4. 폴더 정리 방식 — 고르는 목록이 그림을 가리지 않는가 ----------
   전에는 <select> 였다. 펼치면 그 아래 폴더 그림을 통째로 덮었다 — 정작 봐야 할 것을 가렸다. */
await evaluate(`document.getElementById('btnSettings').click(); true`);
await wait(500);
await evaluate(`(() => {
  const t = Array.from(document.querySelectorAll('.tabs .tab')).find(x => x.textContent === '저장 위치');
  if (t) t.click(); return true;
})()`);
await wait(600);
const modeUi = await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.modecard'));
  return JSON.stringify({
    cards: cards.length,
    selects: document.querySelectorAll('.mbody select').length,
    trees: document.querySelectorAll('.modecard .ftree').length,
    icons: document.querySelectorAll('.modecard .ftree svg').length,
    browse: !!Array.from(document.querySelectorAll('.mbody button')).find(b => (b.textContent||'').includes('찾아보기'))
  });
})()`);
const mu = JSON.parse(modeUi);
check("정리 방식 다섯이 한눈에 펼쳐진다", mu.cards === 5, `카드 ${mu.cards}개`);
check("고르는 목록(select)이 그림을 덮지 않는다", mu.selects === 0, `select ${mu.selects}개`);
check("방식마다 폴더 그림이 붙는다", mu.trees === 5 && mu.icons >= 15, `그림 ${mu.trees}개 · 아이콘 ${mu.icons}개`);
check("«폴더 찾아보기» 단추가 있다", mu.browse === true);

// 눌러서 바꾸면 그 카드로 «고름» 이 옮겨가야 한다
const switched = await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.modecard'));
  const target = cards.find(c => !c.classList.contains('on'));
  if (!target) return 'NO_TARGET';
  const name = target.querySelector('strong').textContent;
  target.click();
  const nowOn = document.querySelector('.modecard.on strong');
  return JSON.stringify({ picked: name, on: nowOn ? nowOn.textContent : '' });
})()`);
const sw = /^NO_/.test(switched) ? null : JSON.parse(switched);
check("눌러서 정리 방식을 바꿀 수 있다", !!sw && sw.picked === sw.on, sw ? `${sw.picked} → ${sw.on}` : String(switched));
await evaluate(`(() => { document.querySelectorAll('.modal-bg').forEach(b => b.remove()); return true; })()`);
await wait(300);

/* ---------- 2. 사진을 하나 넣는다 (파일 고르기 없이 직접 투입) ---------- */
// 잔무늬가 많은 200x120 PNG. 줄무늬로 하면 «칸 크기와 줄 간격이 맞아» 뭉갠 티가 안 나서
// 판정이 흐려진다. 매번 같은 그림이 나오도록 씨앗을 고정한 잡음을 쓴다.
const dropped = await evaluate(`(async () => {
  const c = document.createElement('canvas');
  c.width = 200; c.height = 120;
  const x = c.getContext('2d');
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const im = x.createImageData(c.width, c.height);
  for (let i = 0; i < im.data.length; i += 4) {
    im.data[i] = rnd() * 255; im.data[i+1] = rnd() * 255; im.data[i+2] = rnd() * 255; im.data[i+3] = 255;
  }
  x.putImageData(im, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], '시험사진.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const inp = document.getElementById('cropPickInput');   // 자르기 화면으로 들어가는 입구
  if (!inp) return 'NO_INPUT';
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 'DROPPED';
})()`);
check("사진 입력 경로가 살아 있다", dropped === "DROPPED", String(dropped));
await wait(1500);

/* ---------- 3. 자르기/모자이크 창이 뜨는가 ---------- */
const modal = await evaluate(`JSON.stringify({
  open: !!document.querySelector('.cropwrap'),
  modes: Array.from(document.querySelectorAll('.modebar button')).map(b => b.textContent),
  title: (document.querySelector('.modal .mhead h3')||{}).textContent || ''
})`);
const mo = JSON.parse(modal);
check("자르기 창이 뜬다", mo.open, mo.title);
check("모자이크 단추가 있다", mo.modes.some((t) => t.includes("모자이크")), mo.modes.join(" / "));

/* ---------- 4. 모자이크 모드로 바꾸고 영역을 가려 본다 ---------- */
if (mo.open) {
  await evaluate(`Array.from(document.querySelectorAll('.modebar button'))
    .find(b => b.textContent.includes('모자이크')).click(); true`);
  await wait(300);
  const masked = await evaluate(`JSON.stringify({
    hint: (document.querySelector('.crophint')||{}).textContent || '',
    primary: (document.querySelector('.mfoot .primary')||{}).textContent || '',
    head: (document.querySelector('.modal .mhead h3')||{}).textContent || ''
  })`);
  const ma = JSON.parse(masked);
  check("모자이크 모드로 바뀐다", ma.primary.includes("가리기"), ma.head);

  // 이미지 위에서 드래그 흉내 — 왼쪽 절반을 고른다
  const dragged = await evaluate(`(() => {
    const img = document.querySelector('.cropwrap img');
    const r = img.getBoundingClientRect();
    const wrap = document.querySelector('.cropwrap');
    function ev(type, x, y, target) {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y
      }));
    }
    ev('mousedown', r.left + 4, r.top + 4, wrap);
    ev('mousemove', r.left + r.width/2, r.top + r.height - 4, window);
    ev('mouseup', r.left + r.width/2, r.top + r.height - 4, window);
    const sel = document.querySelector('.cropsel');
    return JSON.stringify({ shown: sel.style.display !== 'none', size: (document.querySelector('.cropsize')||{}).textContent });
  })()`);
  const dr = JSON.parse(dragged);
  check("드래그로 영역이 잡힌다", dr.shown, dr.size || "");

  // 가리기 전 픽셀을 한 줄 떠 둔다 (나중에 «어디가 바뀌었나» 를 정확히 본다)
  await evaluate(`(async () => {
    const img = document.querySelector('.cropwrap img');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    window.__before = Array.from(c.getContext('2d').getImageData(0, Math.floor(c.height/2), c.width, 1).data);
    window.__w = c.width;
    return true;
  })()`);
  const before = await evaluate(`document.querySelector('.cropwrap img').src.length`);
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button'))
    .find(b => b.textContent.includes('이 부분 가리기')).click(); true`);
  await wait(600);
  const after = await evaluate(`JSON.stringify({
    len: document.querySelector('.cropwrap img').src.length,
    undo: !!Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('되돌리기') && b.style.display !== 'none')
  })`);
  const af = JSON.parse(after);
  check("가리기가 실제로 그림을 바꾼다", af.len !== before, `${before} → ${af.len} bytes`);
  check("되돌리기 단추가 나타난다", af.undo);

  // 가린 쪽 픽셀은 «바뀌어야» 하고, 안 가린 쪽은 «한 점도 안 바뀌어야» 한다
  const pixels = await evaluate(`(async () => {
    const img = document.querySelector('.cropwrap img');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const now = c.getContext('2d').getImageData(0, Math.floor(c.height/2), c.width, 1).data;
    const was = window.__before;
    const half = Math.floor(c.width / 2);
    let changedLeft = 0, changedRight = 0;
    for (let x = 0; x < c.width; x++) {
      const i = x * 4;
      const diff = Math.abs(now[i]-was[i]) + Math.abs(now[i+1]-was[i+1]) + Math.abs(now[i+2]-was[i+2]);
      if (diff > 12) { if (x < half - 3) changedLeft++; else if (x > half + 3) changedRight++; }
    }
    return JSON.stringify({ changedLeft, changedRight, half });
  })()`);
  const px = JSON.parse(pixels);
  check("가린 쪽 픽셀이 실제로 뭉개진다", px.changedLeft > px.half * 0.3, `${px.changedLeft}px 바뀜`);
  check("안 가린 쪽은 원본 그대로다", px.changedRight === 0, `${px.changedRight}px 바뀜`);

  // 넣기까지 끝내 본다
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button'))
    .find(b => b.textContent.includes('전체 사용')).click(); true`);
  await wait(900);
  const placed = await evaluate(`JSON.stringify({
    blocks: document.querySelectorAll('#blocks .block').length,
    maskBtn: !!Array.from(document.querySelectorAll('#blocks button')).find(b => b.textContent.includes('가리기'))
  })`);
  const pl = JSON.parse(placed);
  check("사진 블록으로 들어간다", pl.blocks > 0, `블록 ${pl.blocks}개`);
  check("넣은 사진에도 «가리기» 단추가 붙는다", pl.maskBtn);
}

/* ---------- 4-1-2. 사진 가리기 (여러 장 한 번에) ----------
   사진 두 장을 더 넣어 놓고, 원 도장이 진짜로 뭉개는지 픽셀로 본다. */
await evaluate(`(async () => {
  const mk = (seed) => new Promise(async res => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 180;
    const x = c.getContext('2d');
    let s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const im = x.createImageData(c.width, c.height);
    for (let i = 0; i < im.data.length; i += 4) {
      im.data[i] = rnd()*255; im.data[i+1] = rnd()*255; im.data[i+2] = rnd()*255; im.data[i+3] = 255;
    }
    x.putImageData(im, 0, 0);
    c.toBlob(b => res(new File([b], '단체사진' + seed + '.png', { type: 'image/png' })), 'image/png');
  });
  const dt = new DataTransfer();
  dt.items.add(await mk(7)); dt.items.add(await mk(21));
  const inp = document.getElementById('imgInput');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await wait(1200);

const maskBar = JSON.parse(await evaluate(`JSON.stringify({
  shown: !document.getElementById('maskBar').classList.contains('hidden'),
  hint: (document.getElementById('maskBarHint')||{}).textContent || ''
})`));
check("사진이 있으면 «사진 가리기» 줄이 나온다", maskBar.shown, maskBar.hint);

const studio = await evaluate(`(() => {
  document.getElementById('btnMaskAll').click();
  return document.querySelector('.maskpad') ? 'OPEN' : 'NO_PAD';
})()`);
check("가리기 화면이 열린다", studio === "OPEN", String(studio));

if (studio === "OPEN") {
  await wait(700);
  const setup = JSON.parse(await evaluate(`JSON.stringify({
    thumbs: document.querySelectorAll('.maskthumb').length,
    sizes: Array.from(document.querySelectorAll('.modebar:not(.grainbar) button')).map(b => b.textContent.trim()),
    grains: Array.from(document.querySelectorAll('.grainbar button')).map(b => b.textContent.trim()),
    canvasW: document.querySelector('.maskpad').width
  })`));
  check("이 기록의 사진이 전부 늘어선다", setup.thumbs >= 3, `${setup.thumbs}장`);
  check("원 크기를 고를 수 있다", setup.sizes.length === 4, setup.sizes.join(" / "));
  // 「픽셀이 너무 크다」는 말을 이 자리에서 풀 수 있어야 한다
  check("모자이크 칸 굵기를 고를 수 있다", setup.grains.length === 3, setup.grains.join(" / "));

  // 가운데를 한 번 «톡» 누른다
  const stamped = JSON.parse(await evaluate(`(() => {
    const cv = document.querySelector('.maskpad');
    cv.setPointerCapture = () => {}; cv.releasePointerCapture = () => {};
    const x = cv.getContext('2d');
    const was = Array.from(x.getImageData(0, 0, cv.width, cv.height).data);
    const r = cv.getBoundingClientRect();
    const ev = (t, cx, cy) => cv.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
      isPrimary: true, clientX: cx, clientY: cy }));
    ev('pointerdown', r.left + r.width/2, r.top + r.height/2);
    ev('pointerup', r.left + r.width/2, r.top + r.height/2);
    const now = x.getImageData(0, 0, cv.width, cv.height).data;
    // 가운데(원 안)와 모서리(원 밖)를 나눠 센다
    let inside = 0, outside = 0;
    const cxp = cv.width/2, cyp = cv.height/2;
    const rad = Math.max(cv.width, cv.height) * 0.06;
    for (let y = 0; y < cv.height; y += 2) for (let px = 0; px < cv.width; px += 2) {
      const i = (y*cv.width + px)*4;
      const d = Math.abs(now[i]-was[i]) + Math.abs(now[i+1]-was[i+1]) + Math.abs(now[i+2]-was[i+2]);
      if (d <= 12) continue;
      if (Math.hypot(px-cxp, y-cyp) <= rad * 1.15) inside++; else outside++;
    }
    return JSON.stringify({ inside, outside,
      badge: (document.querySelector('.maskdone')||{}).textContent || '' });
  })()`));
  check("누른 자리가 동그랗게 뭉개진다", stamped.inside > 60, `${stamped.inside}px 바뀜`);
  check("원 밖은 한 점도 안 건드린다", stamped.outside === 0, `${stamped.outside}px 바뀜`);
  check("가린 사진에 ✓ 가 붙는다", /✓/.test(stamped.badge), stamped.badge);

  /* 가장자리 얼굴 — 왼쪽 위 모서리에 찍어 본다.
     원이 사진 밖으로 넘칠 때도 «그 자리는 반드시 지워져야» 한다.
     (넘치는 네모를 잘라내는 계산이 틀리면 모서리가 빈 채로 남을 수 있다) */
  const corner = JSON.parse(await evaluate(`(() => {
    const cv = document.querySelector('.maskpad');
    const x = cv.getContext('2d');
    const was = Array.from(x.getImageData(0, 0, cv.width, cv.height).data);
    const r = cv.getBoundingClientRect();
    ['pointerdown','pointerup'].forEach(t => cv.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch',
      isPrimary: true, clientX: r.left + 2, clientY: r.top + 2 })));
    const now = x.getImageData(0, 0, cv.width, cv.height).data;
    // 모서리 바로 안쪽(0,0 근처)이 실제로 바뀌었는가
    let nearCorner = 0;
    for (let y = 0; y < 12; y++) for (let px = 0; px < 12; px++) {
      const i = (y*cv.width + px)*4;
      if (Math.abs(now[i]-was[i]) + Math.abs(now[i+1]-was[i+1]) + Math.abs(now[i+2]-was[i+2]) > 12) nearCorner++;
    }
    return JSON.stringify({ nearCorner });
  })()`));
  check("모서리에 찍어도 그 자리가 지워진다", corner.nearCorner > 60, `모서리 ${corner.nearCorner}/144px 바뀜`);
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('한 번 되돌리기')).click(); true`);

  // 다음 사진으로 넘어갔다 돌아와도 남아 있는가
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('다음')).click(); true`);
  await wait(600);
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('이전')).click(); true`);
  await wait(600);
  const kept = JSON.parse(await evaluate(`JSON.stringify({
    badges: document.querySelectorAll('.maskdone').length,
    doneLabel: (Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('다 됐습니다'))||{}).textContent || ''
  })`));
  check("사진을 넘나들어도 가린 것이 남는다", kept.badges >= 1, `✓ ${kept.badges}장`);
  check("몇 장 고쳤는지 단추에 보인다", /\(\d+장\)/.test(kept.doneLabel), kept.doneLabel);

  const applied = await evaluate(`(() => {
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('다 됐습니다')).click();
    return true;
  })()`);
  await wait(1200);
  const back = JSON.parse(await evaluate(`JSON.stringify({
    modalGone: !document.querySelector('.maskpad'),
    imgs: document.querySelectorAll('#blocks img.thumb').length
  })`));
  check("«다 됐습니다» 를 누르면 사진에 반영된다", back.modalGone && back.imgs > 0, `사진 ${back.imgs}장`);
}

/* ---------- 4-1-3. 파일 이름에 태그·자료제목이 들어가는가 ---------- */
const naming = JSON.parse(await evaluate(`(() => {
  document.getElementById('title').value = '물의 상태변화 수업';
  document.getElementById('tags').value = '수업설계, 3학년';
  document.getElementById('tags').dispatchEvent(new Event('input', {bubbles:true}));
  const cap = Array.from(document.querySelectorAll('#blocks input.inp'))
    .find(i => /제목|캡션/.test(i.placeholder || ''));
  if (!cap) return JSON.stringify({ err: 'NO_CAPTION_FIELD' });
  const before = (document.querySelector('#blocks .savedname')||{}).textContent || '';
  cap.value = '칠판 정리';
  cap.dispatchEvent(new Event('input', { bubbles: true }));
  const after = (document.querySelector('#blocks .savedname')||{}).textContent || '';
  return JSON.stringify({ placeholder: cap.placeholder, before, after });
})()`));
check("사진 칸이 «제목»이라고 말해 준다",
  /파일 이름에 들어갑니다/.test(naming.placeholder || ""), naming.placeholder || naming.err || "");
check("태그가 파일 이름에 들어간다", /수업설계/.test(naming.after || ""), naming.after || "");
check("적은 제목이 파일 이름에 들어간다",
  /칠판 정리/.test(naming.after || "") && naming.after !== naming.before, naming.after || "");

/* ---------- 4-1-4. 밖에서 넣은 파일 이름 정리 ---------- */
const tidy = await evaluate(`(() => {
  const b = document.getElementById('btnMap');
  if (!b) return 'NO_MAP';
  b.click();
  const t = Array.from(document.querySelectorAll('.mfoot button'))
    .find(x => x.textContent.includes('이름 정리'));
  if (!t) return 'NO_BUTTON';
  t.click();
  const toast = document.getElementById('toast');
  const msg = (toast && toast.classList.contains('show')) ? toast.textContent : '';
  document.querySelectorAll('.modal-bg').forEach(e => e.remove());
  return msg || (document.querySelector('.renamebox') ? 'OPENED' : 'NOTHING');
})()`);
check("폴더 구조에 «파일 이름 정리»가 있다", tidy !== "NO_MAP" && tidy !== "NO_BUTTON", String(tidy));
check("연결 전에는 막히고 이유를 말해 준다", /연결/.test(String(tidy)), String(tidy));

/* ---------- 4-2. 손 메모 ---------- */
const drawOpen = await evaluate(`(() => {
  const b = document.querySelector('[data-add="draw"]');
  if (!b) return 'NO_BUTTON';
  b.click();
  return document.querySelector('.drawpad') ? 'OPEN' : 'NO_PAD';
})()`);
check("«＋ 손 메모» 판이 열린다", drawOpen === "OPEN", String(drawOpen));

if (drawOpen === "OPEN") {
  await wait(300);
  const drew = await evaluate(`(() => {
    const cv = document.querySelector('.drawpad');
    const r = cv.getBoundingClientRect();
    function ev(type, x, y, extra) {
      cv.dispatchEvent(new PointerEvent(type, Object.assign({
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'pen',
        isPrimary: true, pressure: 0.7, clientX: x, clientY: y
      }, extra || {})));
    }
    cv.setPointerCapture = () => {}; cv.releasePointerCapture = () => {};
    ev('pointerdown', r.left + 30, r.top + 30);
    for (let i = 1; i <= 25; i++) ev('pointermove', r.left + 30 + i * 8, r.top + 30 + Math.sin(i/3) * 25);
    ev('pointerup', r.left + 230, r.top + 40);
    // 흰 종이 위에 실제로 잉크가 남았는지 센다
    const x = cv.getContext('2d');
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i+1] < 200 || d[i+2] < 200) ink++;
    const undoBtn = Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('되돌리기'));
    return JSON.stringify({ ink, undoOn: undoBtn ? !undoBtn.disabled : false });
  })()`);
  const dw = JSON.parse(drew);
  // 판 크기는 화면에 따라 달라진다. «획 하나가 남을 만큼» 만 보면 된다.
  check("펜으로 그은 획이 남는다", dw.ink > 200, `잉크 ${dw.ink}px`);
  check("되돌리기가 켜진다", dw.undoOn);

  const saved = await evaluate(`(() => {
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('넣기')).click();
    return true;
  })()`);
  await wait(1200);
  const inBlocks = await evaluate(`JSON.stringify({
    names: Array.from(document.querySelectorAll('#blocks .origname')).map(e => e.textContent).join(' | '),
    imgs: document.querySelectorAll('#blocks img.thumb').length
  })`);
  const ib = JSON.parse(inBlocks);
  check("손 메모가 사진 블록으로 들어간다", ib.imgs > 0 && ib.names.includes("손메모"), ib.names.slice(0, 60));
}

/* ---------- 4-3. 녹음 ---------- */
const voiceOpen = await evaluate(`(() => {
  const b = document.querySelector('[data-add="voice"]');
  if (!b) return 'NO_BUTTON';
  b.click();
  return document.querySelector('.voiceclock') ? 'OPEN' : 'NO_PANEL';
})()`);
check("«＋ 녹음» 판이 열린다", voiceOpen === "OPEN", String(voiceOpen));

if (voiceOpen === "OPEN") {
  await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('녹음 시작')).click(); true`);
  await wait(3200);
  const rec = await evaluate(`JSON.stringify({
    clock: (document.querySelector('.voiceclock')||{}).textContent,
    btn: (Array.from(document.querySelectorAll('.mfoot button')).find(b => b.offsetParent) || {}).textContent || '',
    meter: parseFloat((document.querySelector('.voicebar')||{}).style.width) || 0,
    status: (document.querySelector('.mfoot .desc')||{}).textContent || ''
  })`);
  const rc = JSON.parse(rec);
  check("시계가 돈다", rc.clock !== "0:00", rc.clock);
  check("녹음 중 표시가 뜬다", rc.status.includes("녹음 중"), rc.status);
  check("소리 크기 막대가 움직인다", rc.meter > 0, `${rc.meter}%`);

  await evaluate(`Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('멈추기')).click(); true`);
  await wait(1200);
  const done = await evaluate(`JSON.stringify({
    status: (document.querySelector('.mfoot .desc')||{}).textContent || '',
    player: (document.querySelector('.mbody audio')||{}).style ? document.querySelector('.mbody audio').style.display !== 'none' : false,
    put: !!Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('넣기') && b.style.display !== 'none')
  })`);
  const dn = JSON.parse(done);
  check("멈추면 소리가 실제로 담긴다", /\d+(\.\d+)?\s*(B|KB|MB)/i.test(dn.status), dn.status);
  check("바로 들어볼 수 있다", dn.player);

  await evaluate(`(() => {
    document.querySelector('.mbody textarea').value = '증발과 끓음의 차이를 다음 시간에 실험으로 확인하기';
    document.querySelector('.mbody textarea').dispatchEvent(new Event('input', {bubbles:true}));
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent.includes('이 녹음 넣기')).click();
    return true;
  })()`);
  await wait(900);
  const vb = JSON.parse(await evaluate(`JSON.stringify({
    audios: document.querySelectorAll('#blocks audio').length,
    names: Array.from(document.querySelectorAll('#blocks .origname')).map(e => e.textContent).join(' | '),
    texts: Array.from(document.querySelectorAll('#blocks textarea')).map(e => e.value).join(' ')
  })`));
  check("녹음이 블록으로 들어간다", vb.audios > 0 && vb.names.includes("녹음_"), vb.names.slice(-60));
  check("받아 적은 글도 함께 들어간다", vb.texts.includes("증발과 끓음"), "");
}

/* ---------- 5. 설정 → 웹 캡처 칸 ---------- */
await evaluate(`document.getElementById('blocks').innerHTML=''; true`);
const capTab = await evaluate(`(() => {
  const btn = Array.from(document.querySelectorAll('header button, .top button'))
    .find(b => (b.textContent||'').includes('설정'));
  if (btn) btn.click();
  return !!btn;
})()`);
await wait(400);
const capUi = await evaluate(`(() => {
  const tab = Array.from(document.querySelectorAll('.tabs .tab')).find(t => t.textContent.includes('웹 캡처'));
  if (!tab) return JSON.stringify({ found: false });
  tab.click();
  const a = document.querySelector('.mbody a.btn');
  return JSON.stringify({
    found: true,
    href: a ? a.href.slice(0, 60) : '',
    hasAppUrl: a ? a.href.includes(location.origin + location.pathname) : false,
    mentionsShare: (document.querySelector('.mbody')||{}).textContent.includes('공유')
  });
})()`);
const cu = JSON.parse(capUi);
check("설정에 «웹 캡처» 칸이 있다", cu.found, capTab ? "" : "설정 단추를 못 찾음");
check("즐겨찾기 한 줄이 만들어진다", cu.hasAppUrl && cu.href.startsWith("javascript:"), cu.href);

/* ---------- 6. 웹 캡처가 실제로 블록이 되는가 ----------
   ⚠️ 앞 시험들이 제목 칸을 채워 놓았다. 웹 캡처는 «제목이 비어 있을 때만» 채우므로
      먼저 쓰다 만 것을 비워야 이 시험이 제 뜻대로 돌아간다. */
await evaluate(`(() => {
  localStorage.removeItem('trace.draft.v1');
  const t = document.getElementById('title'); if (t) { t.value = ''; t.dispatchEvent(new Event('input', {bubbles:true})); }
  return true;
})()`);
await wait(300);
const payload = encodeURIComponent(JSON.stringify({
  title: "물의 상태변화 정리",
  url: "https://example.org/science/water",
  text: "얼음이 녹는 동안에는 온도가 오르지 않는다.",
}));
await send("Page.navigate", { url: URL_ + "?fresh=1#capture=" + payload });
await wait(2500);
const captured = await evaluate(`JSON.stringify({
  title: (document.getElementById('title')||{}).value || '',
  blocks: document.querySelectorAll('#blocks .block').length,
  text: ((document.getElementById('blocks')||{}).textContent || '') +
        Array.from(document.querySelectorAll('#blocks input, #blocks textarea')).map(e => e.value).join(' '),
  hashGone: !location.hash
})`);
const cp2 = JSON.parse(captured);
check("웹 캡처가 제목을 채운다", cp2.title === "물의 상태변화 정리", cp2.title);
check("주소와 뽑아 둔 글이 블록이 된다", cp2.blocks >= 2, `블록 ${cp2.blocks}개`);
check("가져온 주소가 들어 있다", cp2.text.includes("example.org"), "");
check("주소창이 깨끗해진다", cp2.hashGone);

/* ---------- 7. 안드로이드 공유 시트 경로 (서비스 워커) ---------- */
const swReady = await evaluate(`navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false)`);
check("서비스 워커가 살아 있다", swReady === true, String(swReady));

if (swReady) {
  const shared = await evaluate(`(async () => {
    const fd = new FormData();
    fd.append('title', '3학년 과학 수업 자료');
    fd.append('text', '증발과 끓음의 차이');
    fd.append('url', 'https://example.org/lesson/evaporation');
    const c = document.createElement('canvas'); c.width = 40; c.height = 40;
    c.getContext('2d').fillRect(0, 0, 40, 40);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    fd.append('files', new File([blob], '칠판사진.png', { type: 'image/png' }));
    await fetch('./share', { method: 'POST', body: fd });
    const cache = await caches.open('trace-share-inbox');
    const meta = await cache.match('/__share__/meta');
    const file = await cache.match('/__share__/file0');
    return JSON.stringify({
      meta: meta ? await meta.json() : null,
      fileBytes: file ? (await file.blob()).size : 0
    });
  })()`);
  const sh = JSON.parse(shared);
  check("공유 시트가 보낸 것을 워커가 받는다", !!sh.meta && sh.meta.url.includes("evaporation"),
    sh.meta ? sh.meta.title : "받지 못함");
  check("공유된 사진도 함께 넘어온다", sh.fileBytes > 0, `${sh.fileBytes} bytes`);

  // 화면 쪽에서 실제로 꺼내 블록이 되는지 — ?share=1 로 다시 들어간다
  await send("Page.navigate", { url: URL_ + "?share=1" });
  await wait(3000);
  const intake = await evaluate(`JSON.stringify({
    all: ((document.getElementById('blocks')||{}).textContent || '') +
         Array.from(document.querySelectorAll('#blocks input, #blocks textarea')).map(e => e.value).join(' '),
    imgs: document.querySelectorAll('#blocks img.thumb').length,
    clean: location.search === ''
  })`);
  const it = JSON.parse(intake);
  check("공유한 주소가 블록으로 들어온다", it.all.includes("evaporation"), "");
  check("공유한 사진이 첨부로 들어온다", it.imgs > 0, `사진 ${it.imgs}장`);
  check("주소창의 ?share=1 이 지워진다", it.clean);
}

/* ---------- 8. 폴더 지도 ---------- */
await evaluate(`(() => {
  const mk = (i, type, tags) => ({
    id: 'e' + i, type, title: '기록 ' + i, tags, blocks: [], relations: [],
    pinned: false, createdAt: '2026-0' + (1 + i % 8) + '-10T09:00:00.000Z',
    updatedAt: '2026-0' + (1 + i % 8) + '-10T09:00:00.000Z'
  });
  const list = [];
  for (let i = 0; i < 12; i++) list.push(mk(i, 'experience', ['수업설계', '3학년']));
  for (let i = 12; i < 19; i++) list.push(mk(i, 'knowledge', ['평가']));
  for (let i = 19; i < 22; i++) list.push(mk(i, 'idea', ['연수', '수업설계']));
  list.push(mk(99, 'experience', []));
  localStorage.setItem('trace.entries.v2', JSON.stringify(list));
  localStorage.removeItem('trace.draft.v1');
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);
// 태그가 곧 폴더인 상태로 맞춰 둔다 — 트리가 태그별로 갈라지는지 보려고
await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('trace.settings.v1') || '{}');
  s.folderMode = 'tag';
  localStorage.setItem('trace.settings.v1', JSON.stringify(s));
  return true;
})()`);
await send("Page.navigate", { url: URL_ });
await wait(2500);

const treeOpen = await evaluate(`(() => {
  const b = document.getElementById('btnMap');
  if (!b) return 'NO_BUTTON';
  b.click();
  return document.querySelector('.treebox') ? 'OPEN' : 'NO_BOX';
})()`);
check("«🗂 폴더 구조» 가 열린다", treeOpen === "OPEN", String(treeOpen));

if (treeOpen === "OPEN") {
  await wait(400);
  const tr = JSON.parse(await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('.trow'));
    return JSON.stringify({
      rows: rows.length,
      folders: rows.filter(r => r.classList.contains('tfolder')).map(r => r.querySelector('.tname').textContent),
      indents: rows.map(r => parseFloat(r.style.paddingLeft)),
      firstIsRoot: rows[0] && rows[0].classList.contains('tfolder'),
      hasMd: rows.some(r => /\\.md$/.test(r.querySelector('.tname').textContent))
    });
  })()`));
  check("뿌리 폴더가 맨 위에 온다", tr.firstIsRoot, tr.folders[0] || "");
  check("태그마다 폴더가 갈라진다", tr.folders.some(f => f.startsWith("수업설계")) && tr.folders.some(f => f.startsWith("평가")),
    tr.folders.slice(0, 6).join(" "));
  check("아래로 갈수록 안으로 들어간다", Math.max(...tr.indents) > Math.min(...tr.indents), `들여쓰기 ${Math.min(...tr.indents)}~${Math.max(...tr.indents)}px`);
  check(".md 파일이 폴더 안에 보인다", tr.hasMd);

  // 접었다 폈다
  const toggled = JSON.parse(await evaluate(`(() => {
    const before = document.querySelectorAll('.trow').length;
    const f = Array.from(document.querySelectorAll('.trow.tfolder'))
      .find(r => r.querySelector('.tname').textContent.startsWith('수업설계'));
    if (!f) return JSON.stringify({ err: 'NO_FOLDER' });
    f.click();
    const folded = document.querySelectorAll('.trow').length;
    const f2 = Array.from(document.querySelectorAll('.trow.tfolder'))
      .find(r => r.querySelector('.tname').textContent.startsWith('수업설계'));
    f2.click();
    const back = document.querySelectorAll('.trow').length;
    return JSON.stringify({ before, folded, back });
  })()`));
  check("폴더를 접으면 줄이 줄어든다", toggled.folded < toggled.before, `${toggled.before} → ${toggled.folded}줄`);
  check("다시 펴면 그대로 돌아온다", toggled.back === toggled.before, `${toggled.folded} → ${toggled.back}줄`);

  const allBtns = JSON.parse(await evaluate(`(() => {
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent === '모두 접기').click();
    const collapsed = document.querySelectorAll('.trow').length;
    Array.from(document.querySelectorAll('.mfoot button')).find(b => b.textContent === '모두 펴기').click();
    const expanded = document.querySelectorAll('.trow').length;
    return JSON.stringify({ collapsed, expanded });
  })()`));
  check("«모두 접기» 는 뿌리만 남긴다", allBtns.collapsed < 15, `${allBtns.collapsed}줄`);
  check("«모두 펴기» 는 전부 펼친다", allBtns.expanded > allBtns.collapsed * 3, `${allBtns.expanded}줄`);

  // .md 를 누르면 그 기록이 열린다
  const opened = await evaluate(`(() => {
    const r = Array.from(document.querySelectorAll('.trow'))
      .find(r => /\\.md$/.test(r.querySelector('.tname').textContent));
    if (!r) return 'NO_MD';
    r.click();
    return 'CLICKED';
  })()`);
  await wait(700);
  const viewer = await evaluate(`!!document.querySelector('.viewer')`);
  check(".md 를 누르면 그 기록이 열린다", opened === "CLICKED" && viewer === true, String(opened));
  await evaluate(`(() => { const v = document.querySelector('.viewer'); if (v) v.remove(); document.body.style.overflow=''; return true; })()`);
}

/* ---------- 8-2. 공유 단추 ----------
   실제로 권한을 바꾸는 것은 로그인이 필요해 여기서 못 합니다.
   여기서 보는 것은 «단추가 있고, 눌러도 터지지 않고, 연결 안 됐을 때 제대로 막히는가». */
await evaluate(`(() => { const v = document.querySelector('.viewer'); if (v) v.remove();
  const bg = document.querySelector('.modal-bg'); if (bg) bg.remove();
  document.body.style.overflow = ''; return true; })()`);
const viewerBtns = await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('전체 보기'));
  if (!b) return 'NO_ENTRY';
  b.click();
  const top = document.querySelector('.viewer .vtop');
  if (!top) return 'NO_VIEWER';
  return Array.from(top.querySelectorAll('button, a')).map(e => e.textContent).join(' | ');
})()`);
check("전체 보기에 «링크로 공유» 가 있다", String(viewerBtns).includes("링크로 공유"), String(viewerBtns).slice(0, 70));

const guarded = await evaluate(`(() => {
  const b = Array.from(document.querySelectorAll('.viewer .vtop button')).find(b => b.textContent.includes('공유'));
  if (!b) return 'NO_BUTTON';
  b.click();
  const t = document.getElementById('toast');
  return (t && t.classList.contains('show')) ? t.textContent : (document.querySelector('.mbody') ? 'MODAL' : 'NOTHING');
})()`);
check("연결 전에는 공유가 막히고 이유를 말해 준다", /연결|저장/.test(String(guarded)), String(guarded));
await evaluate(`(() => { const v = document.querySelector('.viewer'); if (v) v.remove();
  document.body.style.overflow = ''; return true; })()`);

/* ---------- 9. 끝난 뒤에도 오류가 없어야 한다 ---------- */
check("끝까지 오류 없음", errors.length === 0 && logs.length === 0, [...errors, ...logs][0] || "");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
edge.kill();
process.exit(failed.length ? 1 : 0);
