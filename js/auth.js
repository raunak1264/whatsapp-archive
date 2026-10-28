// Google sign-in (Google Identity Services, token model) and the automatic lock.
//
// Safety rules:
//  - the access token lives only in this module's memory (never localStorage, cookies or IndexedDB);
//  - there is no refresh token: Google's token lasts about an hour, then you sign in again;
//  - after CONFIG.idleMinutes without use, or that long hidden, the page reloads, which wipes the token
//    and every loaded chat from memory. "Lock" does the same at once; "sign out" also revokes the token.
import { CONFIG } from "./config.js";

let token = null;
let expiresAt = 0;
let tokenClient = null;
let lastActive = Date.now();
let hiddenSince = null;

export const getToken = () => (token && Date.now() < expiresAt - 30000 ? token : null);
export const tokenInfo = () => (getToken() ? { token, exp: expiresAt } : null);

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Google sign-in. Check the internet connection."));
    document.head.appendChild(s);
  });
}

export async function initAuth() {
  if (!CONFIG.clientId) throw new Error("This site is not connected to Google yet (no client ID in js/config.js).");
  await loadGis();
}

// Must be called from a click (browsers only allow the Google popup after a user gesture).
export function signIn() {
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.clientId,
      scope: CONFIG.scope,
      prompt: "",
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, CONFIG.scope)) {
          return reject(new Error("Google Drive access was not allowed, so the archive can't be read."));
        }
        token = resp.access_token;
        expiresAt = Date.now() + Number(resp.expires_in || 3599) * 1000;
        lastActive = Date.now();
        sendTokenToWorker();
        resolve(token);
      },
      error_callback: (err) => reject(new Error(err?.type === "popup_closed" ? "Sign-in was closed." : "Sign-in failed.")),
    });
    tokenClient.requestAccessToken();
  });
}

// ---------- service worker (streams photos, videos and files from Drive with the token) ----------
function sendTokenToWorker() {
  const info = tokenInfo();
  if (info && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "token", ...info });
  }
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "need-token" && e.ports[0]) e.ports[0].postMessage(tokenInfo());
  });
  navigator.serviceWorker.addEventListener("controllerchange", sendTokenToWorker);
}

// ---------- locking ----------
export function lock(reason) {
  token = null;
  expiresAt = 0;
  try { navigator.serviceWorker?.controller?.postMessage({ type: "clear" }); } catch (e) { /* ignore */ }
  try { sessionStorage.setItem("wa-lock-reason", reason || ""); } catch (e) { /* ignore */ }
  // A fresh page load is the surest way to drop every chat and image from memory.
  location.replace(location.pathname + location.search);
}

export function signOut() {
  const t = token;
  if (t && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(t, () => lock("You signed out."));
  } else {
    lock("You signed out.");
  }
}

export function startIdleLock() {
  const limit = CONFIG.idleMinutes * 60000;
  const touch = () => { lastActive = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) {
    window.addEventListener(ev, touch, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenSince = Date.now();
    else {
      if (hiddenSince && Date.now() - hiddenSince > limit) return lock(`Locked after ${CONFIG.idleMinutes} minutes away.`);
      hiddenSince = null;
    }
  });
  setInterval(() => {
    if (!getToken()) return lock("Your Google session ended. Sign in again to continue.");
    if (Date.now() - lastActive > limit) lock(`Locked after ${CONFIG.idleMinutes} minutes without use.`);
  }, 15000);
}

export function takeLockReason() {
  try {
    const r = sessionStorage.getItem("wa-lock-reason");
    sessionStorage.removeItem("wa-lock-reason");
    return r;
  } catch (e) { return null; }
}
