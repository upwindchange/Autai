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

// `--host` / `--port` CLI values for this run (main passes ?overrideHost= /
// ?overridePort= to the Electron window; remote browsers never see them).
// Undefined when the flag was absent — then the saved connection setting
// applies. They are inert unless Remote Access is actually running.
export function hostOverride(): string | undefined {
  const v = new URLSearchParams(window.location.search).get("overrideHost");
  return v !== null && v.trim() !== "" ? v : undefined;
}

export function portOverride(): number | undefined {
  const v = new URLSearchParams(window.location.search).get("overridePort");
  const n = v === null ? NaN : parseInt(v, 10);
  return !isNaN(n) && n >= 1 && n <= 65535 ? n : undefined;
}
