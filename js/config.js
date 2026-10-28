// Settings for the online viewer. The OAuth client ID is not a secret: Google only accepts it from the
// origins listed for it in Google Cloud (this site), and only for the test users you added there.
export const CONFIG = {
  clientId: "",  // "xxxxxxxx.apps.googleusercontent.com", from Google Cloud > Credentials (Web application)
  // drive.file: this site can only see files that the WhatsApp Archiver uploader created, nothing else in your Drive.
  scope: "https://www.googleapis.com/auth/drive.file",
  idleMinutes: 15,  // lock after this long without use (also when the page stays hidden this long)
};
