/**
 * Command-line connection overrides, scoped to this process only.
 *
 * `--remote` boots the app in Remote Access mode regardless of the persisted
 * connection settings (see settingsService.effectiveServerMode). `--host <addr>`
 * and `--port <n>` override the Remote Access bind address for this run (both
 * `--host 0.0.0.0` and `--host=0.0.0.0` forms parse). When a flag is absent,
 * the saved connection setting applies — whose defaults are 0.0.0.0 and 8787.
 * Nothing is persisted; the saved configuration applies again on the next
 * start without the flags.
 *
 * Screenshot tooling flags (per-run too, never persisted): `--window-size
 * <WxH>` / `--window-size=<WxH>` pins the main window's client size (e.g.
 * `--window-size=1440x900` captures as 2880x1800 on a 2x Retina display),
 * and `--frameless` hides the OS window chrome so captures contain app UI
 * only.
 *
 * Dev runs go through electron-vite, which forwards arguments after `--` to
 * the Electron binary, e.g.:
 *   pnpm dev -- --remote --host 0.0.0.0 --port 9000
 *   pnpm dev -- --window-size=1440x900 --frameless
 */
import log from "electron-log/main";

const logger = log.scope("Cli");

const REMOTE_FLAG = "--remote";
const HOST_FLAG = "--host";
const PORT_FLAG = "--port";
const WINDOW_SIZE_FLAG = "--window-size";
const FRAMELESS_FLAG = "--frameless";

const parsed = (() => {
  let remote = false;
  let host: string | undefined;
  let port: number | undefined;
  let windowSize: { width: number; height: number } | undefined;
  let frameless = false;

  // argv without the override tokens — for app.relaunch(), which otherwise
  // replays the current command line and would keep the overrides active. A
  // stripped flag VALUE must go too: left behind, it would survive relaunch as
  // a stray positional (Electron reads bare positionals as paths to open).
  const stripped: string[] = [];

  const args = process.argv.slice(1);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // A bare `--` may leak through when pnpm forwards the dev-script separator
    // verbatim; it is not one of ours and must not reach relaunch argv.
    if (arg === "--") continue;

    if (arg === REMOTE_FLAG) {
      remote = true;
      continue;
    }

    // --host <addr> / --host=<addr>. In the space form the value is the next
    // token — unless that token looks like another flag, in which case the
    // value is simply missing and must not be eaten.
    if (arg === HOST_FLAG || arg.startsWith(`${HOST_FLAG}=`)) {
      const raw =
        arg === HOST_FLAG ?
          args[i + 1] && !args[i + 1].startsWith("--") ?
            args[i + 1]
          : undefined
        : arg.slice(HOST_FLAG.length + 1);
      if (arg === HOST_FLAG && raw !== undefined) i++;
      if (raw === undefined || raw.trim() === "") {
        logger.warn(`Ignoring ${HOST_FLAG} without a value`);
      } else {
        host = raw.trim();
      }
      continue;
    }

    // --port <n> / --port=<n>, valid only in 1-65535.
    if (arg === PORT_FLAG || arg.startsWith(`${PORT_FLAG}=`)) {
      const raw =
        arg === PORT_FLAG ?
          args[i + 1] && !args[i + 1].startsWith("--") ?
            args[i + 1]
          : undefined
        : arg.slice(PORT_FLAG.length + 1);
      if (arg === PORT_FLAG && raw !== undefined) i++;
      const n = raw === undefined ? NaN : parseInt(raw, 10);
      if (!isNaN(n) && n >= 1 && n <= 65535) {
        port = n;
      } else {
        logger.warn(
          `Ignoring invalid ${PORT_FLAG} value: ${raw ?? "(missing)"}`,
        );
      }
      continue;
    }

    // --frameless: hide OS window chrome (screenshot capture aid).
    if (arg === FRAMELESS_FLAG) {
      frameless = true;
      continue;
    }

    // --window-size <WxH> / --window-size=<WxH>, e.g. 1440x900. Pins the main
    // window's client size so captures match store-required dimensions.
    if (arg === WINDOW_SIZE_FLAG || arg.startsWith(`${WINDOW_SIZE_FLAG}=`)) {
      const raw =
        arg === WINDOW_SIZE_FLAG ?
          args[i + 1] && !args[i + 1].startsWith("--") ?
            args[i + 1]
          : undefined
        : arg.slice(WINDOW_SIZE_FLAG.length + 1);
      if (arg === WINDOW_SIZE_FLAG && raw !== undefined) i++;
      const m = raw === undefined ? null : /^(\d+)[xX](\d+)$/.exec(raw.trim());
      const w = m ? parseInt(m[1], 10) : NaN;
      const h = m ? parseInt(m[2], 10) : NaN;
      if (w >= 1 && h >= 1) {
        windowSize = { width: w, height: h };
      } else {
        logger.warn(
          `Ignoring invalid ${WINDOW_SIZE_FLAG} value: ${raw ?? "(missing)"}`,
        );
      }
      continue;
    }

    stripped.push(arg);
  }

  return { remote, host, port, windowSize, frameless, stripped };
})();

export function hasRemoteOverride(): boolean {
  return parsed.remote;
}

/** `--host` value for this run, if given. */
export function hostOverride(): string | undefined {
  return parsed.host;
}

/** `--port` value for this run, if given and valid (1-65535). */
export function portOverride(): number | undefined {
  return parsed.port;
}

/** argv without the override flags and their values — see the scanner above. */
export function argvWithoutOverrides(): string[] {
  return parsed.stripped;
}

/** `--window-size` client size for this run, if given and valid. */
export function windowSizeOverride(): { width: number; height: number } | undefined {
  return parsed.windowSize;
}

/** Whether `--frameless` hides OS window chrome this run. */
export function isFrameless(): boolean {
  return parsed.frameless;
}
