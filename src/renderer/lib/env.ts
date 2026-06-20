// Whether the renderer runs inside the native Electron shell. The main process
// appends ?apiPort=<port> to the load URL only in native mode; when the UI is
// served by the backend to a remote browser, no param is present.
export function isNativeRenderer(): boolean {
  return new URLSearchParams(window.location.search).has("apiPort");
}
