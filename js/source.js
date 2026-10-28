// Where the archive comes from.
//   DriveSource: your Google Drive (normal use). Finds archives by the manifest the uploader wrote.
//   LocalSource: a folder served from this computer, for testing only (allowed on localhost only).
import { getToken } from "./auth.js";

const API = "https://www.googleapis.com/drive/v3/files";

async function gunzipJson(resp) {
  if (!resp.ok) throw new Error(`Could not read archive data (HTTP ${resp.status}).`);
  const stream = resp.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

export class DriveSource {
  async api(url, opts = {}) {
    const token = getToken();
    if (!token) throw new Error("Signed out.");
    const resp = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
    if (resp.status === 401) throw new Error("Your Google session ended. Sign in again.");
    return resp;
  }

  // Every archive the uploader created: newest first.
  async listArchives() {
    const q = "appProperties has { key='waArchive' and value='manifest' } and trashed=false";
    const url = `${API}?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=50` +
      "&fields=files(id,name,modifiedTime,appProperties)&spaces=drive";
    const resp = await this.api(url);
    if (!resp.ok) throw new Error(`Google Drive answered ${resp.status}.`);
    return (await resp.json()).files || [];
  }

  async open(manifestId) {
    const resp = await this.api(`${API}/${encodeURIComponent(manifestId)}?alt=media`);
    if (!resp.ok) throw new Error(`Could not open the archive (HTTP ${resp.status}).`);
    this.manifest = await resp.json();
    this.files = this.manifest.files || {};
    return this.manifest;
  }

  json(path) {
    const id = this.files[path];
    if (!id) return Promise.reject(new Error(`Missing from the uploaded archive: ${path}`));
    return this.api(`${API}/${encodeURIComponent(id)}?alt=media`).then(gunzipJson);
  }

  // A same-site address the service worker answers by streaming the file from Drive.
  mediaUrl(path) {
    const id = this.files[path];
    return id ? `m/${encodeURIComponent(id)}` : "";
  }
}

export class LocalSource {
  constructor(base) {
    this.base = base.endsWith("/") ? base : base + "/";
    this.manifest = { name: "Local test copy" };
  }
  json(path) { return fetch(this.base + path).then(gunzipJson); }
  mediaUrl(path) { return path ? this.base + path.split("/").map(encodeURIComponent).join("/") : ""; }
}

export const localTestAllowed = () => ["localhost", "127.0.0.1"].includes(location.hostname);
