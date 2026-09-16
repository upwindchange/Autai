// Whether the renderer runs inside the native Electron shell. The main process
// appends ?apiPort=<port> to the load URL only in native mode; when the UI is
// served by the backend to a remote browser, no param is present.
export function isNativeRenderer(): boolean {
  return new URLSearchParams(window.location.search).has("apiPort");
}

// Whether this session was forced into Remote Access by the --remote CLI flag
// (main passes ?remoteOverride=1 to the Electron window; remote browsers are
// served by the backend and never see the param). Settings stay editable —
// changes apply on the next start without the flag.
export function hasRemoteOverride(): boolean {
  return new URLSearchParams(window.location.search).get("remoteOverride") === "1";
}
