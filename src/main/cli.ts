/**
 * Command-line overrides, scoped to this process only.
 *
 * `--remote` boots the app in Remote Access mode regardless of the persisted
 * connection settings (see settingsService.effectiveServerMode). The saved
 * configuration is not modified and applies again on the next start without
 * the flag.
 *
 * Dev runs go through electron-vite, which forwards CLI args to the Electron
 * binary from ELECTRON_CLI_ARGS, e.g.:
 *   ELECTRON_CLI_ARGS='["--remote"]' pnpm dev
 */
const REMOTE_FLAG = "--remote";

export function hasRemoteOverride(): boolean {
  return process.argv.includes(REMOTE_FLAG);
}

/**
 * argv without the override flags — for app.relaunch(), which otherwise
 * replays the current command line and would keep the override active.
 */
export function argvWithoutOverrides(): string[] {
  return process.argv.slice(1).filter((arg) => arg !== REMOTE_FLAG);
}
