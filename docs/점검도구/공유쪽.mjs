/* 「🌐 웹 쪽으로 공유」로 만든 링크가 실제로 펴지는지 본다 (view.html).

   왜 따로 있나:
     · 드라이브는 2016년부터 .html 을 «웹페이지» 로 안 열어 준다
     · 구글 문서(/pub)는 사진은 실어도 «영상·녹음» 은 못 싣는다
   그래서 읽는 쪽을 이 저장소에 두고, 글은 주소 뒤(#)에 눌러 담아 보낸다.

   ⚠️ 이 점검은 «펴지는가» 까지만 본다.
      사진·영상이 실제로 보이려면 그 파일이 드라이브에서 «링크가 있는 사람» 에게
      열려 있어야 한다. 그것은 실제 계정으로만 확인할 수 있다.

   실행:  node docs/점검도구/공유쪽.mjs [url]  (기본 http://localhost:8000/) */
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.argv[2] || "http://localhost:8000/").replace(/\/?$/, "/");
const PORT = 9401;
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find(existsSync);
if (!EDGE) { console.error("엣지도 크롬도 찾지 못했습니다."); process.exit(2); }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "trace-view-"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--no-default-browser-check", "--disable-sync",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=900,1500",
  BASE], { stdio: "ignore" });

let ws, msgId = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error(method + " 무응답")); }, 30000);
    pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
  });
};
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "실패");
  return r.result?.value;
};
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? "  — " + detail : ""}`);
};

let u;
for (let i = 0; i < 80 && !u; i++) {
  try {
    const l = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
    u = l.find(t => t.type === "page" && t.webSocketDebuggerUrl && /localhost/.test(t.url || ""))?.webSocketDebuggerUrl;
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
await wait(2400);

/* 보내는 쪽 꾸러미. index.html 의 buildSharePacket() 이 만드는 것과 같은 모양이다.
   ⚠️ 모양을 바꾸면 여기와 view.html 셋을 함께 고쳐야 한다. */
const PACKET = {
  v: 1, t: "bookie 8.21. 협의회", d: Date.parse("2026-08-21"),
  g: ["부기", "협의회"], th: "brick",
  b: [
    { k: "text", x: "오늘 협의회에서 나온 이야기를 그대로 옮겨 둔다." },
    { k: "heading", x: "사진" },
    { k: "image", f: "FAKEIMAGEID", c: "칠판 정리", n: "협의회_01.png" },
    { k: "heading", x: "녹음" },
    { k: "audio", f: "FAKEAUDIOID", c: "", n: "협의회 녹음.webm", s: 254000 },
    { k: "heading", x: "영상" },
    { k: "video", f: "FAKEVIDEOID", c: "시연 장면", n: "시연.mp4", s: 12000000 },
    { k: "quote", x: "규칙을 먼저 정하지 말고, 규칙이 필요해지는 순간을 같이 겪으라고 했다." },
    { k: "divider" },
    { k: "file", f: "FAKEHWPID", c: "", n: "협의회 자료.hwp", s: 34000 },
    { k: "link", u: "https://example.com/", l: "보기 링크" }
  ]
};
// index.html 의 encodePacket 은 앱 안쪽(IIFE)이라 밖에서 못 부른다.
// 여기서 같은 계산을 하고, «푸는 쪽» 은 view.html 의 진짜 코드가 맡는다.
const ENC = `(async () => {
  const b64 = (bytes) => { let bin=""; const CH=0x8000;
    for (let i=0;i<bytes.length;i+=CH) bin += String.fromCharCode.apply(null, bytes.subarray(i,i+CH));
    return btoa(bin).split(String.fromCharCode(43)).join("-").split("/").join("_").split("=").join(""); };
  const bytes = new TextEncoder().encode(JSON.stringify(${JSON.stringify(PACKET)}));
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter(); w.write(bytes); w.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return "1" + b64(new Uint8Array(buf));
})()`;
const link = await ev(ENC);
const full = BASE + "view.html#d=" + link;
check("주소 하나로 담긴다 (카톡에 넣을 만한 길이)", full.length < 4000,
  `${full.length}자 (원본 ${JSON.stringify(PACKET).length}자)`);

await send("Page.navigate", { url: full });
await wait(2600);

const got = JSON.parse(await ev(`JSON.stringify({
  h1: (document.querySelector('h1')||{}).textContent || '',
  theme: document.documentElement.getAttribute('data-theme'),
  video: document.querySelectorAll('iframe.player.video').length,
  audio: document.querySelectorAll('iframe.player.audio').length,
  media: Array.from(document.querySelectorAll('iframe.player')).map(f => f.src),
  files: document.querySelectorAll('a.fileline').length,
  links: document.querySelectorAll('a.linkcard').length,
  quotes: document.querySelectorAll('blockquote').length,
  hrs: document.querySelectorAll('hr').length,
  heads: Array.from(document.querySelectorAll('h2')).map(e=>e.textContent),
  tags: Array.from(document.querySelectorAll('.tag')).map(e=>e.textContent),
  audioH: (() => { const a = document.querySelector('iframe.player.audio');
                   return a ? Math.round(a.getBoundingClientRect().height) : 0; })(),
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
})`));

check("보낸 글이 그대로 펴진다", got.h1 === "bookie 8.21. 협의회", got.h1);
check("보낸 사람이 고른 «모양» 까지 따라간다", got.theme === "brick", String(got.theme));
check("제목·태그가 살아 있다", got.tags.join(",") === "#부기,#협의회" && got.heads.length === 3,
  `${got.tags.join(" ")} · 소제목 ${got.heads.length}개`);
check("인용·구분선이 살아 있다", got.quotes === 1 && got.hrs === 1);
check("영상이 재생기로 들어간다", got.video === 1);
check("녹음이 재생기로 들어간다", got.audio === 1);
check("재생기가 잘리지 않는다 (드라이브 재생기가 들어갈 만큼)", got.audioH >= 120, `${got.audioH}px`);
check("재생기가 드라이브를 가리킨다",
  got.media.length === 2 && got.media.every(s => /drive\.google\.com\/file\/d\/.+\/preview$/.test(s)),
  got.media[0] || "");
check("첨부·링크가 살아 있다", got.files >= 1 && got.links === 1, `첨부 ${got.files} · 링크 ${got.links}`);
/* 사진은 가짜 ID 라 드라이브가 안 준다 — 그때 «드라이브에서 열어 보기» 로 내려가야 한다.
   이 대비책이 없으면 받는 사람 화면에 깨진 그림만 남는다. */
check("사진이 안 열리면 «열어 보기» 로 내려간다",
  got.files >= 2, `첨부 줄 ${got.files}개 (자료 1 + 사진 대신 1)`);
check("가로로 안 넘친다", got.overflow === 0, `${got.overflow}px`);

/* 폰 너비 */
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(800);
const mob = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check("폰에서도 가로로 안 넘친다", Number(mob) === 0, `${mob}px`);
await send("Emulation.clearDeviceMetricsOverride");

/* 주소가 잘렸을 때 — 카톡·문자에서 흔히 일어난다. 조용히 빈 쪽이 되면 안 된다. */
await send("Page.navigate", { url: BASE + "view.html#d=" + link.slice(0, Math.floor(link.length / 2)) });
await wait(1600);
const broken = await ev(`(document.querySelector('.oops b')||{}).textContent || ''`);
check("주소가 잘리면 이유를 말해 준다", /펴지 못했습니다/.test(String(broken)), String(broken));

await send("Page.navigate", { url: BASE + "view.html" });
await wait(1200);
const empty = await ev(`(document.querySelector('.oops b')||{}).textContent || ''`);
check("빈 주소로 와도 안내가 뜬다", /없습니다/.test(String(empty)), String(empty));

const realErrors = errors.filter(e => !/favicon|ERR_|net::|drive\.google|googleusercontent/i.test(String(e)));
check("펴는 내내 오류 없음", realErrors.length === 0, realErrors[0] || "");

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
edge.kill();
process.exit(failed.length ? 1 : 0);
