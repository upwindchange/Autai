import { app } from "electron";
import { sendSuccess } from "@/utils/messageUtils";
import { i18n } from "@/i18n";

// Update CHECK only — no download, no install.
//
// Apple App Store Review Guideline 2.4.5(vii) and Microsoft Store policy
// 10.2.5 require store-distributed apps to update only through the store.
// Checking a version feed and notifying the user is allowed; downloading or
// installing app code is not. This module never downloads anything.
//
// Direct (non-store) builds previously used electron-updater to auto-install
// from GitHub Releases; users now get the same notification and update from
// their install source (GitHub Releases page).

// Owner/repo of the GitHub Releases feed to check against.
const GITHUB_REPO = "upwindchange/Autai";
// How often to re-check (ms). Also checked once at startup.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Never alert on check failures — an unreachable feed is not actionable.
const CHECK_TIMEOUT_MS = 10_000;

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { accept: "application/vnd.github+json" },
        signal: controller.signal,
      },
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (typeof data === "object" && data !== null && "tag_name" in data) {
      const { tag_name } = data;
      if (typeof tag_name === "string") return tag_name;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  const normalize = (v: string) =>
    v
      .replace(/^v/, "")
      .split("-")[0] // strip prerelease tag
      .split(".")
      .map((n) => Number.parseInt(n, 10));
  const [lMajor, lMinor, lPatch] = normalize(latest);
  const [cMajor, cMinor, cPatch] = normalize(current);
  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return lPatch > cPatch;
}

async function checkForUpdate(): Promise<void> {
  const latest = await fetchLatestVersion();
  if (!latest) return;
  if (!isNewerVersion(latest, app.getVersion())) return;

  sendSuccess(
    i18n.t("update.availableTitle"),
    i18n.t("update.availableBody", { version: latest }),
  );
}

export function update(): void {
  // Unpackaged/dev runs have no meaningful version to compare and would
  // "notify" about every release. This is the only behavioral branch —
  // store and direct builds run identical logic by design, so there is no
  // store-specific code path to maintain.
  if (!app.isPackaged) return;

  checkForUpdate();
  setInterval(checkForUpdate, CHECK_INTERVAL_MS).unref();
}
