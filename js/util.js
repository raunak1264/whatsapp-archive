// Shared helpers: escaping, dates, avatars, icons. Everything shown from the archive goes through esc().

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
export const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const $ = (id) => document.getElementById(id);
export const narrow = () => window.matchMedia("(max-width: 760px)").matches;

export const ICON = {
  group: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0h-1c1.2.9 2 2 2 3.5V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"/></svg>',
  person: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2.2c-3 0-9 1.5-9 4.5V21h18v-2.3c0-3-6-4.5-9-4.5z"/></svg>',
  archive: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="m20.5 5.2-1.4-1.7A1.5 1.5 0 0 0 18 3H6c-.5 0-.9.2-1.2.5L3.5 5.2C3.2 5.6 3 6 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5c0-.5-.2-.9-.5-1.3zM12 17.5 6.5 12H10v-2h4v2h3.5L12 17.5zM5.1 5l.8-1h12l.9 1H5.1z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  gif: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11.5 9H13v6h-1.5zM9 9H6c-.6 0-1 .5-1 1v4c0 .5.4 1 1 1h3c.6 0 1-.5 1-1v-2H8.5v1.5h-2v-3H10V10c0-.5-.4-1-1-1zm10 1.5V9h-4.5v6H16v-2h2v-1.5h-2v-1z"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
  media: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zm-5.04-6.71-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71z"/></svg>',
};

// Avatar colours and sender colours use the same hash as the offline viewer, so they match.
const PALETTE = ["#d97706", "#059669", "#2563eb", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d", "#c2410c", "#4f46e5"];
const SENDER_COLOURS = ["#e17076", "#7bc862", "#65aadd", "#a695e7", "#ee7aae", "#6ec9cb", "#faa774", "#06a884", "#d4a017", "#c27ba0"];
export function hash(s) {
  let h = 0;
  for (const ch of String(s || "")) h = (h * 31 + ch.codePointAt(0)) % 4294967296;
  return h;
}
export const senderColour = (name) => SENDER_COLOURS[hash(name) % SENDER_COLOURS.length];
export function avatar(name, isGroup, cls) {
  const words = String(name || "").split(/\s+/).map((w) => (w.match(/\p{L}/u) || [""])[0]).filter(Boolean);
  const ini = ((words[0] || "") + (words.length > 1 ? words[words.length - 1] : "")).toUpperCase();
  const inner = ini ? esc(ini) : isGroup ? ICON.group : ICON.person;
  return `<div class="av ${cls || ""}" style="background:${PALETTE[hash(name) % PALETTE.length]}">${inner}</div>`;
}

// Dates. Archive timestamps are local "YYYY-MM-DD HH:MM" strings.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function parseLocal(ts) {
  if (!ts) return null;
  const [d, t = "00:00"] = ts.split(" ");
  const [y, m, dd] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  return new Date(y, m - 1, dd, hh, mm);
}
export function when(ts) {  // like WhatsApp's chat list: 14:05 / Yesterday / Tuesday / 03/09/2024
  const d = parseLocal(ts);
  if (!d) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return ts.slice(11, 16);
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB");
}
export const longDate = (ts) => {
  const d = parseLocal(ts);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + ", " + ts.slice(11, 16) : "";
};
export const shortDate = (ts) => ts ? `${Number(ts.slice(8, 10))} ${MONTHS[Number(ts.slice(5, 7)) - 1].slice(0, 3)} ${ts.slice(0, 4)}` : "";
export const dayLabel = (ts) => `${Number(ts.slice(8, 10))} ${MONTHS[Number(ts.slice(5, 7)) - 1]} ${ts.slice(0, 4)}`;
export const monthLabel = (ts) => `${MONTHS[Number(ts.slice(5, 7)) - 1]} ${ts.slice(0, 4)}`;
export const fmtSize = (b) => !b ? "" : b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " kB";
export const fmtDur = (s) => !s ? "" : Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");
export const n = (x) => Number(x || 0).toLocaleString("en-IN");

export function highlight(text, words, max) {
  text = String(text || "");
  const f = fold(text);
  let i = -1, w = "";
  for (const x of words) { const j = f.indexOf(x); if (j >= 0 && (i < 0 || j < i)) { i = j; w = x; } }
  if (i < 0) return esc(text.slice(0, max));
  const a = Math.max(0, i - 40), b = Math.min(text.length, i + w.length + max);
  return (a ? "…" : "") + esc(text.slice(a, i)) + "<mark>" + esc(text.slice(i, i + w.length)) + "</mark>" +
    esc(text.slice(i + w.length, b)) + (b < text.length ? "…" : "");
}

// Message text with web links made clickable. Only http(s) links; everything else is escaped text.
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
export function linkify(text) {
  const s = String(text || "");
  let out = "", last = 0;
  for (const m of s.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?)\]}*_]+$/, "");
    out += esc(s.slice(last, m.index)) +
      `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
    last = m.index + url.length;
  }
  return out + esc(s.slice(last));
}

export const PREVIEW_ICON = { image: "📷 ", video: "🎥 ", gif: "GIF · ", audio: "🎤 ", document: "📄 ", sticker: "", contact: "👤 ", location: "📍 ", deleted: "🚫 " };
export const DOC_COLOUR = { PDF: "#e5484d", DOC: "#2b6de8", DOCX: "#2b6de8", XLS: "#1f9d55", XLSX: "#1f9d55", PPT: "#e0662a", PPTX: "#e0662a", ZIP: "#8a6d3b" };

let toastTimer;
export function toast(msg, ms = 3500) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
