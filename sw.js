/* PKEMS 서비스 워커 — «설치되는 앱» 이 되기 위한 최소한만 한다.
 *
 * ⚠️ index.html 을 절대 캐시하지 않는다.
 *    이 앱은 index.html 한 개를 고쳐서 배포하는 구조라, 캐시에 물고 있으면
 *    고쳐도 옛 화면이 계속 뜬다. 그래서 «항상 네트워크» 로만 간다.
 *    오프라인일 때만 안내 문구를 대신 보여 준다.
 */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

var OFFLINE_HTML =
  '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>연결 없음</title><style>' +
  'body{font-family:system-ui,"Malgun Gothic",sans-serif;background:#f5f7fb;color:#1b2130;' +
  'display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}' +
  'div{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 10px}' +
  'p{color:#667085;line-height:1.7;margin:0}</style></head><body><div>' +
  "<h1>인터넷에 연결되어 있지 않습니다</h1>" +
  "<p>이 기록장은 구글 드라이브에 저장하기 때문에 인터넷이 있어야 열립니다.<br>" +
  "연결한 뒤 다시 열어 주세요.</p>" +
  "</div></body></html>";

self.addEventListener("fetch", function (e) {
  if (e.request.mode !== "navigate") return;      // 나머지는 그대로 통과
  e.respondWith(
    fetch(e.request).catch(function () {
      return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    })
  );
});
