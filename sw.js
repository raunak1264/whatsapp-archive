// Service worker: lets <img>, <video>, <audio> and "open in new tab" show files from your Google Drive.
// Requests for "m/<driveFileId>" are fetched from the Drive API with your sign-in token added, and
// streamed back (Range requests pass through, so videos can seek). The token is kept in memory only,
// handed over by the open page; nothing is cached or stored.
let token = null;
let exp = 0;
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (e) => {
  if (e.data?.type === "token" && typeof e.data.token === "string") { token = e.data.token; exp = Number(e.data.exp) || 0; }
  else if (e.data?.type === "clear") { token = null; exp = 0; }
});

function askPage(client) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(e.data);
    client.postMessage({ type: "need-token" }, [ch.port2]);
    setTimeout(() => resolve(null), 2000);
  });
}

async function currentToken() {
  if (token && Date.now() < exp - 30000) return token;
  token = null;
  // The worker may have been restarted: ask an open page of this site for the token.
  for (const client of await self.clients.matchAll({ type: "window" })) {
    const info = await askPage(client);
    if (info?.token) { token = info.token; exp = Number(info.exp) || 0; return token; }
  }
  return null;
}

async function fromDrive(request, id) {
  const t = await currentToken();
  if (!t) {
    return new Response("Signed out. Open the archive and sign in again.", {
      status: 401, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const headers = { Authorization: `Bearer ${t}` };
  const range = request.headers.get("Range");
  if (range) headers.Range = range;
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers, cache: "no-store" });
  const out = new Headers({ "Cache-Control": "no-store", "Accept-Ranges": "bytes", "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff" });
  for (const h of ["Content-Type", "Content-Length", "Content-Range"]) {
    const v = resp.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: out });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH + "m/")) return;
  const id = decodeURIComponent(url.pathname.slice(SCOPE_PATH.length + 2));
  if (!ID_RE.test(id)) return e.respondWith(new Response("Bad request", { status: 400 }));
  e.respondWith(fromDrive(e.request, id));
});
