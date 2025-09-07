/**
 * Environment detection utilities for the main process
 */

export type AppMode = 'vscode-debug' | 'dev-server' | 'production';

/**
 * Detects the current application mode
 * @returns The current app mode
 */
export function getAppMode(): AppMode {
  const isVSCodeDebug = !!process.env.VSCODE_DEBUG;
  const isDevServer = !!process.env.ELECTRON_RENDERER_URL;
  
  if (isVSCodeDebug) {
    return 'vscode-debug';
  } else if (isDevServer) {
    return 'dev-server';  // pnpm dev
  } else {
    return 'production';  // pnpm build
  }
}

/**
 * Simple boolean check for development mode (either dev-server or vscode-debug)
 * @returns true if running in any development mode
 */
export function isDevMode(): boolean {
  return !!process.env.ELECTRON_RENDERER_URL || !!process.env.VSCODE_DEBUG;
}