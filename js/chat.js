// One conversation: rendered from web/chats/<id>.json.gz, with the contact / group info panel.
import {
  esc, ICON, avatar, senderColour, linkify, dayLabel, shortDate, monthLabel, fmtSize, fmtDur, n, DOC_COLOUR, toast,
} from "./util.js";

const WINDOW = 300;  // messages rendered at a time; more load as you scroll up

export class ChatView {
  constructor(root, source, { onBack, onLightbox }) {
    this.root = root;
    this.source = source;
    this.onBack = onBack;
    this.onLightbox = onLightbox;
    this.cache = new Map();  // chat id -> data, in memory only (gone when the page locks)
    this.token = 0;
  }

  async open(id, msgId) {
    const token = ++this.token;
    this.root.hidden = false;
    this.root.classList.remove("info-open");
    this.root.innerHTML = '<div class="spinner"></div>';
    let data = this.cache.get(id);
    if (!data) {
      try {
        data = await this.source.json(`web/chats/${id}.json.gz`);
      } catch (e) {
        if (token === this.token) this.root.innerHTML = `<div class="none">${esc(e.message)}</div>`;
        return;
      }
      this.cache.set(id, data);
    }
    if (token !== this.token) return;
    this.data = data;
    this.info = data.info;
    this.msgs = data.msgs;
    this.index = new Map(this.msgs.map((m, i) => [m.i, i]));
    this.start = this.end = 0;  // nothing rendered yet
    this.layout();
    if (msgId && this.index.has(msgId)) this.jump(msgId, false);
    else this.showRange(Math.max(0, this.msgs.length - WINDOW), this.msgs.length, true);
  }

  // ---------- frame: header, scroller, info panel ----------
  layout() {
    const I = this.info;
    const hint = I.group ? "click here for group info" : "click here for contact info";
    this.root.innerHTML =
      `<header class="chat-head"><button class="icon-btn back" data-act="back" aria-label="All chats">${ICON.back}</button>` +
      `<button class="open-info" data-act="info" title="${I.group ? "Group" : "Contact"} info">${avatar(I.name, I.group)}` +
      `<div class="who-box"><h2>${esc(I.name)}</h2><div class="sub">${I.group ? "Group · " : ""}${n(I.count)} messages · ${hint}</div></div></button>` +
      `<button class="icon-btn" data-act="tabs" title="Media, links and docs" aria-label="Media, links and docs">${ICON.media}</button></header>` +
      '<div class="chat-scroll"><div class="chat-body"></div></div>' +
      '<aside class="info" aria-label="Chat info"><div class="info-bar"><button data-act="close"></button><span class="ttl"></span></div>' +
      '<div class="tabs" hidden></div><div class="info-body"></div></aside>';
    this.scroller = this.root.querySelector(".chat-scroll");
    this.body = this.root.querySelector(".chat-body");
    this.panel = this.root.querySelector(".info");
    this.root.onclick = (e) => this.click(e);
    // keep the newest message in view while photos load, until you scroll or tap
    this.pinned = false;
    const unpin = () => { this.pinned = false; };
    for (const ev of ["wheel", "touchstart", "pointerdown", "keydown"]) this.scroller.addEventListener(ev, unpin, { passive: true });
    new ResizeObserver(() => { if (this.pinned) this.scroller.scrollTop = this.scroller.scrollHeight; }).observe(this.body);
    this.body.addEventListener("load", (e) => e.target.classList?.remove("ph"), true);
  }

  // ---------- messages ----------
  showRange(start, end, toBottom) {
    this.start = start;
    this.end = end;
    const parts = [];
    if (start > 0) parts.push(`<div class="loadmore"><button data-act="earlier">Load earlier messages (${n(start)} more)</button></div>`);
    let day = start > 0 ? (this.msgs[start - 1].t || "").slice(0, 10) : null;
    for (let i = start; i < end; i++) {
      const m = this.msgs[i];
      const d = (m.t || "").slice(0, 10);
      if (d !== day) { day = d; parts.push(`<div class="day"><span>${esc(dayLabel(m.t))}</span></div>`); }
      parts.push(this.bubble(m));
    }
    if (end < this.msgs.length) parts.push(`<div class="loadmore"><button data-act="later">Load newer messages</button></div>`);
    this.body.innerHTML = parts.join("");
    if (toBottom) {
      this.pinned = true;
      this.scroller.scrollTop = this.scroller.scrollHeight;
    }
  }

  earlier() {
    const oldHeight = this.scroller.scrollHeight, oldTop = this.scroller.scrollTop;
    this.showRange(Math.max(0, this.start - WINDOW), this.end, false);
    this.scroller.scrollTop = this.scroller.scrollHeight - oldHeight + oldTop;
  }

  bubble(m) {
    if (m.sys !== undefined) return m.sys ? `<div class="sys" id="m${m.i}"><span>${esc(m.sys)}</span></div>` : "";
    const I = this.info, inner = [];
    if (I.group && !m.me) inner.push(`<div class="who" style="color:${senderColour(m.s)}">${esc(m.s)}</div>`);
    if (m.qt || m.r) inner.push(`<div class="q"${m.r ? ` data-jump="${m.r}"` : ""}><b>${esc(m.qs || "")}</b>${esc(m.qt || "")}</div>`);
    if (m.m) inner.push(this.media(m));
    if (m.la !== undefined) {
      inner.push(`<a class="doc" href="https://maps.apple.com/?ll=${m.la},${m.lo}" target="_blank" rel="noopener noreferrer">📍 ${esc(m.x || "Location")} (${m.la.toFixed(5)}, ${m.lo.toFixed(5)})</a>`);
    } else if (m.x && !(m.m && m.m.k === "document" && m.x === m.m.ti)) {
      inner.push(`<span class="t${m.y === "deleted" ? " del" : ""}">${m.y === "deleted" ? esc(m.x) : linkify(m.x)}</span>`);
    }
    if (m.empty) inner.push(`<span class="t del">${esc(m.empty)}</span>`);
    inner.push(`<span class="time">${esc((m.t || "").slice(11, 16))}</span>`);
    if (m.rx) inner.push(reactionPill(m.rx));
    return `<div class="msg${m.me ? " me" : ""}${m.rx ? " has-rx" : ""}" id="m${m.i}"><div class="b">${inner.join("")}</div></div>`;
  }

  media(m) {
    const md = m.m;
    if (md.st !== "present") {
      return md.k === "location" ? "" : `<div class="miss">[${esc(md.k)} not available: ${esc(md.why || "not on the phone")}]</div>`;
    }
    const f = this.source.mediaUrl(md.f);
    if (!f) return `<div class="miss">[${esc(md.k)} not uploaded]</div>`;
    if (md.k === "image") return `<img class="ph" src="${esc(f)}" loading="lazy" alt="photo" data-view="${m.i}">`;
    if (md.k === "sticker") return `<img class="sticker" src="${esc(f)}" loading="lazy" alt="sticker">`;
    if (md.k === "video") return `<video controls preload="metadata" playsinline src="${esc(f)}"></video>`;
    if (md.k === "gif") return `<video autoplay loop muted playsinline preload="metadata" src="${esc(f)}"></video>`;
    if (md.k === "audio") {
      const p = md.p ? this.source.mediaUrl(md.p) : "";
      return `<audio controls preload="none">${p ? `<source src="${esc(p)}" type="audio/mp4">` : ""}<source src="${esc(f)}"></audio>`;
    }
    const ext = (md.f.split(".").pop() || "FILE").toUpperCase().slice(0, 4);
    const title = md.ti || `${ext} document${md.sz ? ` (${fmtSize(md.sz)})` : ""}`;
    return `<a class="doc" href="${esc(f)}" target="_blank" rel="noopener noreferrer"><span class="ext">${esc(ext)}</span>${esc(title)}</a>`;
  }

  jump(msgId, smooth = true) {
    const i = this.index.get(Number(msgId));
    if (i === undefined) return toast("That message is not in this archive.");
    if (i < this.start || i >= this.end) {
      this.showRange(Math.max(0, i - WINDOW / 2), Math.min(this.msgs.length, i + WINDOW / 2), false);
    }
    this.pinned = false;
    const el = this.body.querySelector(`#m${msgId}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    history.replaceState(null, "", `#chat=${this.info.id}&m=${msgId}`);
  }

  click(e) {
    const a = e.target.closest("[data-act]");
    if (a) {
      const act = a.dataset.act;
      if (act === "back") return this.onBack();
      if (act === "info") return this.togglePanel("main");
      if (act === "tabs") return this.togglePanel("tabs", a.dataset.tab);
      if (act === "close") return this.closePanel();
      if (act === "main") return this.showMain();
      if (act === "earlier") return this.earlier();
      if (act === "later") return this.showRange(this.start, Math.min(this.msgs.length, this.end + WINDOW), false);
      if (act === "all-members") {
        const card = a.parentElement;
        card.querySelectorAll(".member").forEach((x) => x.remove());
        a.insertAdjacentHTML("beforebegin", this.info.members.map(memberRow).join(""));
        return a.remove();
      }
    }
    const tab = e.target.closest(".tabs button");
    if (tab) return this.showTabs(tab.dataset.tab);
    const go = e.target.closest("[data-jump]");
    if (go) {
      e.preventDefault();
      if (window.matchMedia("(max-width: 760px)").matches) this.closePanel();
      return this.jump(go.dataset.jump);
    }
    const view = e.target.closest("[data-view]");
    if (view) return this.viewPhoto(Number(view.dataset.view));
    const rx = e.target.closest(".rx");
    if (rx) return toast(rx.dataset.who, 5000);
  }

  // all photos/videos of this chat in the full-screen viewer, starting at this one
  viewPhoto(msgId) {
    const items = this.info.media.slice().reverse().map(([mid, ts, kind, file]) => ({
      mid, cid: this.info.id, ts, kind, file, chat: this.info.name,
    }));
    const start = Math.max(0, items.findIndex((x) => x.mid === msgId));
    this.onLightbox(items, start);
  }

  // ---------- info panel ----------
  togglePanel(view, tab) {
    if (this.panel.classList.contains("open") && view === "main") return this.closePanel();
    if (view === "tabs") this.showTabs(tab || firstTab(this.info)); else this.showMain();
    this.panel.classList.add("open");
    this.root.classList.add("info-open");
  }
  closePanel() { this.panel.classList.remove("open"); this.root.classList.remove("info-open"); }

  setBar(back, title) {
    const btn = this.panel.querySelector(".info-bar button");
    btn.innerHTML = back ? ICON.back : ICON.close;
    btn.dataset.act = back ? "main" : "close";
    btn.title = back ? "Back" : "Close";
    this.panel.querySelector(".ttl").textContent = title;
  }

  showMain() {
    const I = this.info;
    this.setBar(false, I.group ? "Group info" : "Contact info");
    this.panel.querySelector(".tabs").hidden = true;
    const total = I.media.length + I.docs.length + I.links.length + I.audio.length;
    const sub = I.group ? `Group · ${n(I.members.length)} members` : I.phone || "";
    let html = `<div class="card profile">${avatar(I.name, I.group)}<h2>${esc(I.name)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}` +
      `<p class="stats">${n(I.count)} messages · ${esc(shortDate(I.first))} – ${esc(shortDate(I.last))}</p></div>` +
      `<div class="card"><button class="row-link" data-act="tabs" data-tab="${firstTab(I)}">Media, links and docs<span>${n(total)}${ICON.chev}</span></button>` +
      (I.media.length ? `<div class="strip">${I.media.slice(0, 6).map((m) => this.tile(m)).join("")}</div>`
        : `<div class="strip-empty">${total ? "No photos or videos" : "Nothing shared in this chat"}</div>`) + "</div>";
    if (I.group && I.members.length) {
      const first = I.members.slice(0, 12);
      html += `<div class="card members"><h3>${n(I.members.length)} members</h3>${first.map(memberRow).join("")}` +
        (I.members.length > first.length ? `<button class="more-btn" data-act="all-members">View all (${n(I.members.length - first.length)} more)</button>` : "") + "</div>";
    }
    this.setBody(html);
  }

  showTabs(which) {
    const I = this.info;
    const TABS = [["media", "Media", I.media], ["docs", "Docs", I.docs], ["links", "Links", I.links], ["audio", "Audio", I.audio]];
    this.setBar(true, "Media, links and docs");
    const tabs = this.panel.querySelector(".tabs");
    tabs.hidden = false;
    tabs.innerHTML = TABS.filter(([k, , a]) => a.length || k !== "audio").map(([k, label, a]) =>
      `<button role="tab" data-tab="${k}" aria-selected="${k === which}">${label} <small>${a.length ? n(a.length) : ""}</small></button>`).join("");
    const items = TABS.find((t) => t[0] === which)[2];
    let html = "";
    if (!items.length) {
      html = `<div class="none">No ${which === "media" ? "photos or videos" : which === "docs" ? "documents" : which} in this chat</div>`;
    } else if (which === "media") {
      let cur = "";
      for (const m of items) {
        const mo = monthLabel(m[1]);
        if (mo !== cur) { html += (cur ? "</div>" : "") + `<div class="month">${esc(mo)}</div><div class="grid">`; cur = mo; }
        html += this.tile(m);
      }
      html += "</div>";
    } else if (which === "docs") {
      html = items.map(([mid, ts, file, title, size]) => {
        const ext = (file.split(".").pop() || "").toUpperCase().slice(0, 4);
        return `<a class="item" href="${esc(this.source.mediaUrl(file))}" target="_blank" rel="noopener noreferrer">` +
          `<div class="ic" style="background:${DOC_COLOUR[ext] || "#8696a0"}">${esc(ext || "FILE")}</div>` +
          `<div class="tx"><div class="t1">${esc(title || ext + " document")}</div>` +
          `<div class="t2">${[fmtSize(size), shortDate(ts)].filter(Boolean).map(esc).join(" · ")}</div></div>` +
          `<button class="go" data-jump="${mid}">Show in chat</button></a>`;
      }).join("");
    } else if (which === "links") {
      html = items.map(([mid, ts, href, text]) => {
        let host = href;
        try { host = new URL(href).hostname.replace(/^www\./, ""); } catch (e) { /* keep */ }
        return `<a class="item" href="${esc(href)}" target="_blank" rel="noopener noreferrer"><div class="ic lk">${ICON.link}</div>` +
          `<div class="tx"><div class="t1">${esc(host)}</div><div class="t2">${esc(href)}</div>` +
          `<div class="t2">${esc(shortDate(ts))}${text && text !== href ? " · " + esc(text) : ""}</div></div>` +
          `<button class="go" data-jump="${mid}">Show in chat</button></a>`;
      }).join("");
    } else {
      html = items.map(([mid, ts, file, playable, dur, sender]) => {
        const p = playable && playable !== file ? this.source.mediaUrl(playable) : "";
        return `<div class="item" style="cursor:default"><div class="tx"><div class="t1">${esc(sender || "")}</div>` +
          `<div class="t2">${esc(shortDate(ts))}${dur ? " · " + fmtDur(dur) : ""}</div>` +
          `<audio controls preload="none">${p ? `<source src="${esc(p)}" type="audio/mp4">` : ""}<source src="${esc(this.source.mediaUrl(file))}"></audio></div>` +
          `<button class="go" data-jump="${mid}">Show in chat</button></div>`;
      }).join("");
    }
    this.setBody(html);
  }

  tile([mid, ts, kind, file, dur]) {
    const f = esc(this.source.mediaUrl(file));
    const inner = kind === "image" ? `<img src="${f}" loading="lazy" alt="">`
      : `<video src="${f}#t=0.5" muted playsinline preload="metadata"></video>`;
    const badge = kind === "video" ? `<div class="badge">${ICON.play}${fmtDur(dur)}</div>` : kind === "gif" ? `<div class="badge">${ICON.gif}</div>` : "";
    return `<div class="tile" data-jump="${mid}" title="${esc(shortDate(ts))}">${inner}${badge}</div>`;
  }

  setBody(html) {
    const body = this.panel.querySelector(".info-body");
    body.innerHTML = html;
    body.scrollTop = 0;
  }
}

const memberRow = (m) => `<div class="member">${avatar(m[0], false)}<span class="n">${esc(m[0])}</span>${m[1] ? '<span class="badge">Group admin</span>' : ""}</div>`;
const firstTab = (I) => (I.media.length ? "media" : I.docs.length ? "docs" : I.links.length ? "links" : "audio");

function reactionPill(rx) {
  const counts = new Map();
  for (const [e] of rx) counts.set(e, (counts.get(e) || 0) + 1);
  const emojis = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e).join("");
  const who = rx.map(([e, w]) => `${e} ${w}`).join("\n");
  return `<span class="rx" title="${esc(who)}" data-who="${esc(who)}">${esc(emojis)}${rx.length > 1 ? `<span class="rn">${rx.length}</span>` : ""}</span>`;
}
