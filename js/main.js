// WhatsApp Archive (online): sign-in, archive picker, chat list, filters, search, media browser, lightbox.
import { initAuth, signIn, signOut, lock, startIdleLock, takeLockReason } from "./auth.js";
import { DriveSource, LocalSource, localTestAllowed } from "./source.js";
import { ChatView } from "./chat.js";
import {
  $, esc, fold, ICON, avatar, when, longDate, monthLabel, fmtSize, fmtDur, n, highlight, narrow, PREVIEW_ICON,
  DOC_COLOUR, toast,
} from "./util.js";

const PAGE = 120, MSG_LIMIT = 300;
let WA, source, chatView, chatById, chatName, counts;
let MSGS = null, FOLDED = null, msgsLoading = null;
const state = { filter: "all", query: "", chat: null };

// ======================= start-up =======================
const params = new URLSearchParams(location.search);
const gateNote = (msg, err) => { const g = $("gate-note"); g.textContent = msg || ""; g.classList.toggle("err", !!err); };

async function boot() {
  const reason = takeLockReason();
  if (reason) gateNote(reason);

  // Test mode on this computer only: ?local=<folder served next to this page>
  if (localTestAllowed() && params.get("local")) {
    source = new LocalSource(params.get("local"));
    return startArchive();
  }

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js", { scope: "./" }); } catch (e) { /* media will not load */ }
  }
  try {
    await initAuth();
  } catch (e) {
    return gateNote(e.message, true);
  }
  const btn = $("signin");
  btn.disabled = false;
  btn.onclick = async () => {
    btn.disabled = true;
    gateNote("Signing in…");
    try {
      await signIn();
      await waitForWorker();
      source = new DriveSource();
      gateNote("Looking for your archive in Google Drive…");
      const archives = await source.listArchives();
      if (!archives.length) {
        btn.disabled = false;
        return gateNote("No archive found in this Google account. Upload one with WhatsApp Archiver on your Mac first.", true);
      }
      fillPicker(archives);
      await source.open(archives[0].id);
      startIdleLock();
      await startArchive();
    } catch (e) {
      btn.disabled = false;
      gateNote(e.message, true);
    }
  };
}

// The service worker must control this page before photos and videos can load through it.
function waitForWorker() {
  if (!("serviceWorker" in navigator) || navigator.serviceWorker.controller) return Promise.resolve();
  return new Promise((resolve) => {
    navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
    setTimeout(resolve, 4000);
  });
}

function fillPicker(archives) {
  const pick = $("archive-pick");
  if (archives.length < 2) return;
  pick.innerHTML = archives.map((a) => `<option value="${esc(a.id)}">${esc(a.appProperties?.waName || a.name)}</option>`).join("");
  pick.hidden = false;
  pick.onchange = async () => {
    try {
      await source.open(pick.value);
      MSGS = FOLDED = msgsLoading = null;
      await startArchive();
    } catch (e) { toast(e.message); }
  };
}

async function startArchive() {
  $("gate").hidden = true;
  $("app").hidden = false;
  $("list").innerHTML = '<div class="spinner"></div>';
  try {
    WA = await source.json("web/index.json.gz");
  } catch (e) {
    $("list").innerHTML = `<div class="empty"><b>Could not load the archive</b>${esc(e.message)}</div>`;
    return;
  }
  chatById = new Map(WA.chats.map((c) => [c.id, c]));
  chatName = (id) => (chatById.get(id) || {}).n || "";
  counts = {
    all: WA.chats.filter((c) => !c.a).length, people: WA.chats.filter((c) => !c.g).length,
    groups: WA.chats.filter((c) => c.g).length, archived: WA.chats.filter((c) => c.a).length,
    photos: WA.media.filter((m) => m[3] === "image").length, videos: WA.media.filter((m) => m[3] === "video").length,
    gifs: WA.media.filter((m) => m[3] === "gif").length, docs: WA.media.filter((m) => m[3] === "document").length,
    links: WA.links.length, audio: WA.media.filter((m) => m[3] === "audio").length,
  };
  const s = WA.summary;
  $("stats").textContent = `${n(WA.chats.length)} chats · ${n(s.messages)} messages`;
  $("welcome-text").textContent = `${n(s.messages)} messages in ${n(WA.chats.length)} chats, from ` +
    `${longDate(s.first).split(",")[0]} to ${longDate(s.last).split(",")[0]}.`;
  chatView = new ChatView($("chat"), source, { onBack: closeChat, onLightbox: openLightbox });
  $("chat").hidden = true;
  $("welcome").hidden = false;
  state.chat = null;
  drawChips();
  render();
  fromHash();
}

// ======================= chips / filters =======================
const FILTERS = [["all", "All"], ["people", "People"], ["groups", "Groups"], ["archived", "Archived"], null,
  ["photos", "Photos"], ["videos", "Videos"], ["docs", "Documents"], ["links", "Links"], ["audio", "Audio"], ["gifs", "GIFs"]];
const MEDIA_KIND = { photos: "image", videos: "video", gifs: "gif", docs: "document", audio: "audio" };

function drawChips() {
  $("chips").innerHTML = FILTERS.map((f) => {
    if (!f) return '<span class="chip-sep" aria-hidden="true"></span>';
    const [key, label] = f;
    if (!counts[key] && key !== "all") return "";
    return `<button class="chip" data-f="${key}" aria-pressed="${state.filter === key}">${label}` +
      (key === "all" ? "" : ` <span class="n">${n(counts[key])}</span>`) + "</button>";
  }).join("");
}
$("chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  state.filter = state.filter === b.dataset.f && b.dataset.f !== "all" ? "all" : b.dataset.f;
  drawChips();
  render();
  $("list").scrollTop = 0;
});

// ======================= list rendering =======================
let io = null;
function renderBatches(html, items, rowFn, batch) {
  const list = $("list");
  if (io) io.disconnect();
  list.innerHTML = html;
  let i = 0;
  const sentinel = document.createElement("div");
  sentinel.style.height = "1px";
  const more = () => {
    const chunk = items.slice(i, i + batch);
    i += chunk.length;
    sentinel.insertAdjacentHTML("beforebegin", chunk.map(rowFn).join(""));
    if (i >= items.length) { io.disconnect(); sentinel.remove(); }
    list.querySelectorAll("video[data-src]:not([data-seen])").forEach((v) => { v.dataset.seen = 1; vio.observe(v); });
  };
  list.appendChild(sentinel);
  io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) more(); }, { root: list, rootMargin: "600px" });
  io.observe(sentinel);
  more();
}
const vio = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) { e.target.src = e.target.dataset.src; vio.unobserve(e.target); }
}, { root: $("list"), rootMargin: "300px" });

function chatRow(c) {
  const prefix = c.ps ? `<span>${esc(c.ps)}: </span>` : "";
  return `<a class="row${state.chat === c.id ? " on" : ""}" role="listitem" data-chat="${c.id}" href="#chat=${c.id}">` +
    avatar(c.n, c.g) + `<div class="body"><div class="top"><span class="name">${esc(c.n)}</span><span class="when">${when(c.t)}</span></div>` +
    `<div class="bot"><span class="prev">${prefix}${esc(PREVIEW_ICON[c.pk] || "")}${esc(c.p)}</span>` +
    (c.a && state.filter !== "archived" ? '<span class="tag">Archived</span>' : "") + "</div></div></a>";
}
function msgRow(m, words) {
  const c = chatById.get(m[1]) || { n: "", id: m[1] };
  return `<a class="row" role="listitem" data-chat="${m[1]}" data-msg="${m[0]}" href="#chat=${m[1]}&m=${m[0]}">` +
    avatar(c.n, c.g, "sm") + `<div class="body"><div class="top"><span class="name" style="font-size:15px">${esc(c.n)}</span>` +
    `<span class="when">${when(m[2])}</span></div><div class="bot"><span class="prev multi">` +
    (c.g || m[3] === "You" ? `<span>${esc(m[3])}: </span>` : "") + highlight(m[4], words, 140) + "</span></div></div></a>";
}
function docRow(m) {
  const [mid, cid, ts, , file, , title, size] = m;
  const ext = (file.split(".").pop() || "").toUpperCase().slice(0, 4);
  return `<a class="row" role="listitem" href="${esc(source.mediaUrl(file))}" target="_blank" rel="noopener noreferrer">` +
    `<div class="av doc" style="background:${DOC_COLOUR[ext] || "#667781"}">${esc(ext || "FILE")}</div>` +
    `<div class="body"><div class="top"><span class="name" style="font-size:15px">${esc(title || ext + " document")}</span>` +
    `<span class="when">${when(ts)}</span></div><div class="bot"><span class="prev">${esc(chatName(cid))}` +
    (size ? " · " + fmtSize(size) : "") + `</span><button class="act" data-goto="${cid}:${mid}">Show in chat</button></div></div></a>`;
}
function linkRow(l) {
  const [mid, cid, ts, href, text] = l;
  let host = href;
  try { host = new URL(href).hostname.replace(/^www\./, ""); } catch (e) { /* keep */ }
  const rest = text.replace(href, "").trim();
  return `<a class="row" role="listitem" href="${esc(href)}" target="_blank" rel="noopener noreferrer">` +
    `<div class="av link">${ICON.link}</div><div class="body"><div class="top"><span class="name" style="font-size:15px">${esc(host)}</span>` +
    `<span class="when">${when(ts)}</span></div><div class="bot"><span class="prev">${esc(chatName(cid))} · ${esc(rest || href)}` +
    `</span><button class="act" data-goto="${cid}:${mid}">Show in chat</button></div></div></a>`;
}
function audioRow(m) {
  const [mid, cid, ts, , file, playable, , , dur, , sender] = m;
  const c = chatById.get(cid) || { n: "" };
  const p = playable && playable !== file ? `<source src="${esc(source.mediaUrl(playable))}" type="audio/mp4">` : "";
  return `<div class="row" role="listitem" style="cursor:default">` + avatar(c.n, c.g, "sm") +
    `<div class="body" style="padding:10px 0"><div class="top" style="padding-right:15px"><span class="name" style="font-size:15px">${esc(c.n)}</span>` +
    `<span class="when">${when(ts)}</span></div><div class="bot" style="padding-right:15px"><span class="prev">${esc(sender || "")}` +
    (dur ? " · " + fmtDur(dur) : "") + `</span><button class="act" data-goto="${cid}:${mid}">Show in chat</button></div>` +
    `<div class="player"><audio controls preload="none">${p}<source src="${esc(source.mediaUrl(file))}"></audio></div></div></div>`;
}
let current = [];
function tile(m, idx) {
  const [, , , kind, file, , , , dur] = m;
  const f = esc(source.mediaUrl(file));
  const media = kind === "image" ? `<img src="${f}" loading="lazy" alt="">`
    : `<video data-src="${f}#t=0.5" muted playsinline preload="metadata"></video>`;
  const badge = kind === "video" ? `<div class="badge">${ICON.play}${fmtDur(dur)}</div>` : kind === "gif" ? `<div class="badge">${ICON.gif}</div>` : "";
  return `<div class="tile" role="listitem" data-idx="${idx}" title="${esc(chatName(m[1]))} · ${esc(longDate(m[2]))}">${media}${badge}</div>`;
}

function loadMessages() {
  if (!msgsLoading) {
    msgsLoading = source.json("web/search.json.gz").then((d) => {
      MSGS = d.msgs;
      FOLDED = MSGS.map((m) => fold(m[4]));
    });
  }
  return msgsLoading;
}

let renderToken = 0;
function render() {
  const token = ++renderToken;
  const list = $("list");
  const words = fold(state.query).split(/\s+/).filter(Boolean);
  const f = state.filter;
  const matches = (s) => words.every((w) => s.includes(w));

  if (MEDIA_KIND[f] || f === "links") {
    let items = f === "links" ? WA.links : WA.media.filter((m) => m[3] === MEDIA_KIND[f]);
    if (words.length) {
      items = items.filter((m) => matches(fold(f === "links" ? m[3] + " " + m[4] + " " + chatName(m[1])
        : (m[6] || "") + " " + (m[9] || "") + " " + (m[10] || "") + " " + chatName(m[1]))));
    }
    const label = { photos: "Photos", videos: "Videos", gifs: "GIFs", docs: "Documents", links: "Links", audio: "Voice notes & audio" }[f];
    const head = `<div class="section">${label}<span>${n(items.length)}${words.length ? " matching" : ""}</span></div>`;
    if (!items.length) { list.innerHTML = head + emptyMsg(); return; }
    if (f === "photos" || f === "videos" || f === "gifs") {
      current = items.map((m) => ({ mid: m[0], cid: m[1], ts: m[2], kind: m[3], file: m[4], caption: m[9], sender: m[10] }));
      const months = [];
      for (let i = 0; i < items.length; i++) {
        const lbl = monthLabel(items[i][2]);
        if (!months.length || months[months.length - 1].label !== lbl) months.push({ label: lbl, items: [] });
        months[months.length - 1].items.push(i);
      }
      renderBatches(head, months, (mo) => `<div class="section">${esc(mo.label)}</div><div class="grid" role="list">` +
        mo.items.map((i) => tile(items[i], i)).join("") + "</div>", 3);
    } else {
      renderBatches(head, items, f === "docs" ? docRow : f === "links" ? linkRow : audioRow, PAGE);
    }
    return;
  }

  let chats = WA.chats.filter((c) => (f === "people" ? !c.g : f === "groups" ? c.g : f === "archived" ? c.a : !c.a));
  if (!words.length) {
    let head = "";
    if (f === "all" && counts.archived) {
      head = `<a class="row archived-row" role="listitem" href="#"><div class="ico">${ICON.archive}</div>` +
        `<div class="body"><div class="top"><span class="name">Archived</span><span class="count">${counts.archived}</span></div></div></a>`;
    }
    if (!chats.length) { list.innerHTML = head + emptyMsg(); return; }
    renderBatches(head, chats, chatRow, PAGE);
    return;
  }
  if (f === "all") chats = WA.chats;
  const named = chats.filter((c) => matches(fold(c.n)));
  const allowed = new Set(chats.map((c) => c.id));
  const html = named.length ? `<div class="section">Chats<span>${named.length}</span></div>` + named.slice(0, 50).map(chatRow).join("") : "";
  list.innerHTML = html + '<div class="section">Messages<span>searching…</span></div>';
  loadMessages().then(() => {
    if (token !== renderToken) return;
    const hits = [];
    for (let i = 0; i < MSGS.length; i++) if (allowed.has(MSGS[i][1]) && words.every((w) => FOLDED[i].includes(w))) hits.push(MSGS[i]);
    if (!hits.length && !named.length) { list.innerHTML = emptyMsg(); return; }
    const head = hits.length ? `<div class="section">Messages<span>${n(hits.length)}</span></div>` : "";
    renderBatches(html + head, hits, (m) => msgRow(m, words), MSG_LIMIT);
  }, (e) => { list.innerHTML = html + `<div class="empty"><b>Message search unavailable</b>${esc(e.message)}</div>`; });
}
const emptyMsg = () => (state.query
  ? `<div class="empty"><b>No results for “${esc(state.query)}”</b>Try fewer or different words.</div>`
  : '<div class="empty"><b>Nothing here</b></div>');

// ======================= opening chats =======================
function openChat(id, msg) {
  if (!chatById.has(id)) return toast("That chat is not in this archive.");
  state.chat = id;
  $("welcome").hidden = true;
  $("app").classList.add("show-chat");
  chatView.open(id, msg);
  history.replaceState(null, "", `#chat=${id}${msg ? "&m=" + msg : ""}`);
  lastHash = location.hash;
  $("list").querySelectorAll(".row.on").forEach((r) => r.classList.remove("on"));
  $("list").querySelectorAll(`.row[data-chat="${id}"]:not([data-msg])`).forEach((r) => r.classList.add("on"));
  document.title = `${chatById.get(id).n} · WhatsApp Archive`;
}
function closeChat() {
  $("app").classList.remove("show-chat");
  $("chat").hidden = true;
  $("welcome").hidden = false;
  state.chat = null;
  history.replaceState(null, "", location.pathname + location.search);
  lastHash = "";
  document.title = "WhatsApp Archive";
}
let lastHash = "";
function fromHash() {
  if (location.hash === lastHash || !chatById) return;
  const h = new URLSearchParams(location.hash.slice(1));
  const id = Number(h.get("chat"));
  if (chatById.has(id)) openChat(id, h.get("m") ? Number(h.get("m")) : null);
  lastHash = location.hash;
}
window.addEventListener("hashchange", fromHash);

$("list").addEventListener("click", (e) => {
  const go = e.target.closest("[data-goto]");
  if (go) {
    e.preventDefault(); e.stopPropagation();
    const [cid, mid] = go.dataset.goto.split(":").map(Number);
    return openChat(cid, mid);
  }
  if (e.target.closest(".archived-row")) {
    e.preventDefault();
    state.filter = "archived"; drawChips(); render(); $("list").scrollTop = 0;
    return;
  }
  const t = e.target.closest(".tile");
  if (t) return openLightbox(current, Number(t.dataset.idx));
  const row = e.target.closest(".row[data-chat]");
  if (row && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    openChat(Number(row.dataset.chat), row.dataset.msg ? Number(row.dataset.msg) : null);
  }
});

// ======================= search box =======================
let timer;
$("q").addEventListener("input", () => {
  $("clear").hidden = !$("q").value;
  clearTimeout(timer);
  timer = setTimeout(() => { state.query = $("q").value.trim(); render(); $("list").scrollTop = 0; }, 180);
});
$("q").addEventListener("focus", () => { if (WA) loadMessages().catch(() => {}); });
$("clear").addEventListener("click", () => { $("q").value = ""; $("clear").hidden = true; state.query = ""; render(); $("q").focus(); });
$("lock").addEventListener("click", () => (source instanceof DriveSource ? signOut() : lock("Locked.")));

// ======================= lightbox =======================
let lbItems = [], lbIdx = -1;
function openLightbox(items, i) {
  if (!items.length || i < 0 || i >= items.length) return;
  lbItems = items; lbIdx = i;
  const it = items[i];
  const f = esc(source.mediaUrl(it.file));
  $("lb-stage").innerHTML = it.kind === "image" ? `<img src="${f}" alt="">`
    : `<video src="${f}" controls autoplay playsinline${it.kind === "gif" ? " loop muted" : ""}></video>`;
  const c = chatById.get(it.cid) || { n: "" };
  $("lb-meta").innerHTML = avatar(c.n, c.g, "sm") +
    `<div class="t"><b>${esc(it.sender || c.n)}</b><small>${esc(c.n)} · ${esc(longDate(it.ts))}</small></div>`;
  $("lb-caption").textContent = it.caption || "";
  $("lb-open").href = source.mediaUrl(it.file);
  $("lb-goto").onclick = () => { closeLightbox(); openChat(it.cid, it.mid); };
  $("lb-prev").disabled = i === 0;
  $("lb-next").disabled = i === items.length - 1;
  $("lightbox").hidden = false;
}
function closeLightbox() { $("lightbox").hidden = true; $("lb-stage").innerHTML = ""; }
$("lb-close").onclick = closeLightbox;
$("lb-prev").onclick = () => openLightbox(lbItems, lbIdx - 1);
$("lb-next").onclick = () => openLightbox(lbItems, lbIdx + 1);
$("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox" || e.target.id === "lb-stage") closeLightbox(); });
document.addEventListener("keydown", (e) => {
  if (!$("lightbox").hidden) {
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") openLightbox(lbItems, lbIdx - 1);
    else if (e.key === "ArrowRight") openLightbox(lbItems, lbIdx + 1);
    return;
  }
  if (e.key === "/" && document.activeElement !== $("q") && WA) { e.preventDefault(); $("q").focus(); }
  if (e.key === "Escape" && document.activeElement === $("q") && $("q").value) $("clear").click();
});

boot();
