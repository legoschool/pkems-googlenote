/* TRACE 서비스 워커 — «설치되는 앱» 이 되기 위한 최소한만 한다.
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

/* ---- 다른 앱에서 «공유» 로 보낸 것 받기 ----
 * 안드로이드 공유 시트에서 이 앱을 고르면 여기로 POST 가 들어온다.
 * 서비스 워커 안에서는 화면을 그릴 수 없으니, 받은 것을 캐시에 잠깐 넣어 두고
 * 앱 주소로 돌려보낸다. 화면 쪽에서 그것을 꺼내 블록으로 만든다.
 * 왜 캐시냐 — 파일(사진)을 통째로 담아 옮길 수 있는 가장 단순한 그릇이다.
 */
var SHARE_CACHE = "trace-share-inbox";

function takeShare(request) {
  return request.formData().then(function (form) {
    var files = form.getAll("files").filter(function (f) { return f && f.size; });
    var meta = {
      title: form.get("title") || "",
      text: form.get("text") || "",
      url: form.get("url") || "",
      at: Date.now(),
      files: files.map(function (f, i) {
        return { key: "file" + i, name: f.name || ("공유파일" + (i + 1)), type: f.type || "application/octet-stream", size: f.size };
      })
    };
    return caches.open(SHARE_CACHE).then(function (cache) {
      var jobs = [cache.put("/__share__/meta", new Response(JSON.stringify(meta), {
        headers: { "Content-Type": "application/json" }
      }))];
      files.forEach(function (f, i) {
        jobs.push(cache.put("/__share__/file" + i, new Response(f, {
          headers: { "Content-Type": f.type || "application/octet-stream" }
        })));
      });
      return Promise.all(jobs);
    });
  }).then(function () {
    return Response.redirect(new URL("./?share=1", self.registration.scope).href, 303);
  }).catch(function () {
    return Response.redirect(new URL("./", self.registration.scope).href, 303);
  });
}

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method === "POST" && /\/share$/.test(url.pathname)) {
    e.respondWith(takeShare(e.request));
    return;
  }
  if (e.request.mode !== "navigate") return;      // 나머지는 그대로 통과
  e.respondWith(
    fetch(e.request).catch(function () {
      return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    })
  );
});
