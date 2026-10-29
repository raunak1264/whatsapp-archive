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
  const out = new Headers({ "Cache-Control": "no-store", "Accept-Ranges": "bytes", "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff" });
  // Drive does not expose Content-Range to scripts (CORS), but <audio> and <video> need it on partial
  // responses. So the range is worked out here from the file size, and the header written by us.
  const want = parseRange(request.headers.get("Range"));
  let part = null;
  if (want) {
    const size = await fileSize(id, t);
    if (size != null) {
      const start = want.suffix ? Math.max(0, size - want.suffix) : want.start;
      const end = Math.min(want.end ?? size - 1, size - 1);
      if (start > end) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Cache-Control": "no-store" } });
      }
      part = { start, end, size };
      headers.Range = `bytes=${start}-${end}`;
    }
  }
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers, cache: "no-store" });
  const type = resp.headers.get("Content-Type");
  if (type) out.set("Content-Type", type);
  if (part && resp.status === 206) {
    out.set("Content-Range", `bytes ${part.start}-${part.end}/${part.size}`);
    out.set("Content-Length", String(part.end - part.start + 1));
  } else {
    const len = resp.headers.get("Content-Length");
    if (len) out.set("Content-Length", len);
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: out });
}

// "bytes=100-", "bytes=100-199" or "bytes=-500" (only one range; anything else means the whole file).
function parseRange(h) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((h || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") return { suffix: Number(m[2]) };
  return { start: Number(m[1]), end: m[2] === "" ? null : Number(m[2]) };
}

// File sizes (just numbers) are remembered while the worker runs, so seeking doesn't ask Drive each time.
const sizes = new Map();
async function fileSize(id, t) {
  if (sizes.has(id)) return sizes.get(id);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=size`, {
    headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
  if (!r.ok) return null;
  const size = Number((await r.json()).size);
  if (!Number.isFinite(size)) return null;
  if (sizes.size > 2000) sizes.clear();
  sizes.set(id, size);
  return size;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH + "m/")) return;
  const id = decodeURIComponent(url.pathname.slice(SCOPE_PATH.length + 2));
  if (!ID_RE.test(id)) return e.respondWith(new Response("Bad request", { status: 400 }));
  e.respondWith(fromDrive(e.request, id));
});
