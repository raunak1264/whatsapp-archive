# WhatsApp Archive viewer

A private, read-only viewer for WhatsApp archives made with **WhatsApp Archiver** (a Mac tool that backs up
an iPhone and exports its WhatsApp chats). It looks and works like WhatsApp: chat list, filters (People,
Groups, Archived, Photos, Videos, Documents, Links, Audio, GIFs), search across all messages, reactions,
replies, and contact / group info with "Media, links and docs".

**This repository contains only code. No chats, names, numbers or files are stored here.**

## How it works

- The archive lives in the owner's own **Google Drive**, uploaded by WhatsApp Archiver.
- The page shows nothing until you **sign in with Google**. It then reads the archive straight from Drive
  in your browser; there is no server.
- It asks only for the `drive.file` permission, so it can open **only the files its own uploader created**,
  never anything else in your Drive.
- The Google project is kept in "Testing" mode with a single allowed test user, so other Google accounts
  cannot sign in.

## Privacy and security

- The sign-in token is kept in memory only (no cookies, local storage or refresh token). Google expires it
  after about an hour.
- The page **locks after 15 minutes without use**, or after 15 minutes in the background. Locking reloads
  the page, which clears the token and every loaded chat from memory. The lock button signs out and
  revokes the token.
- Nothing from the archive is cached or saved on the device.
- Photos, videos and documents are streamed from Drive by a small service worker (`sw.js`), which adds the
  token to each request and stores nothing.
- A strict Content-Security-Policy allows scripts only from this site and Google's sign-in library. All
  message text is escaped before it is shown.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Page shell, sign-in screen, security policy |
| `js/config.js` | Google OAuth client ID and the idle-lock time |
| `js/auth.js` | Google sign-in, in-memory token, automatic lock |
| `js/source.js` | Reads the archive from Google Drive |
| `js/main.js` | Chat list, filters, search, photo viewer |
| `js/chat.js` | Conversation view and contact / group info panel |
| `sw.js` | Streams media from Drive with the token |
| `css/` | WhatsApp-style look, light and dark, phone and desktop |

## Testing on a computer without Google

Serve this folder next to an archive folder and open
`http://localhost:<port>/<this folder>/index.html?local=../<archive folder>/`. That test mode only works on
`localhost`.
