// electron-builder afterPack hook: stamps the correct better-sqlite3 v13
// prebuilt binary into each packaged arch.
//
// The vite build copies the HOST arch's prebuild to out/main/ (dev + local
// builds). When electron-builder packages multiple arches from one out/
// (e.g. win x64+arm64, linux x64+arm64), the non-host arches would otherwise
// ship the host's binary. better-sqlite3 v13 is Node-API, so the prebuilt for
// the target arch works under any Electron version — we just overwrite the
// unpacked copy with the right one per package.
//
// The runtime (src/main/db/index.ts) loads it via
// `app.asar.unpacked/out/main/better_sqlite3.node` (asarUnpack in
// electron-builder.json keeps it outside the asar archive).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// builder-util's Arch enum (not importable here under pnpm strict hoisting):
// ia32=0, x64=1, armv7l=2, arm64=3, universal=4
const ARCH_NAME = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

const require = createRequire(import.meta.url);

export default async function afterPack(context) {
  const TAG = "[afterPack-sqlite3]";
  // electronPlatformName is "mas" for Mac App Store builds; the prebuilds
  // directory and .app bundle layout use "darwin" for those.
  const rawPlatform = context.electronPlatformName; // "win32" | "linux" | "darwin" | "mas"
  const platform = rawPlatform === "mas" ? "darwin" : rawPlatform;
  const arch = ARCH_NAME[context.arch]; // "x64" | "arm64" | ...

  const appOutDir = context.appOutDir;

  // Where electron-builder unpacked the asar. Layout differs by platform:
  // win/linux: <appOutDir>/resources/app.asar.unpacked
  // darwin:    <appOutDir>/<ProductName>.app/Contents/Resources/app.asar.unpacked
  const productName = context.packager.appInfo.productName;
  const resourcesDir =
    platform === "darwin"
      ? path.join(appOutDir, `${productName}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");
  const unpackedMain = path.join(resourcesDir, "app.asar.unpacked", "out", "main");
  const destPath = path.join(unpackedMain, "better_sqlite3.node");

  const prebuildsDir = path.join(
    path.dirname(require.resolve("better-sqlite3/package.json")),
    "prebuilds",
  );
  const sourcePath = path.join(prebuildsDir, `${platform}-${arch}.node`);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `${TAG} No better-sqlite3 prebuilt for ${platform}-${arch} ` +
        `(looked at ${sourcePath}).`,
    );
  }
  if (!fs.existsSync(destPath)) {
    throw new Error(
      `${TAG} Expected unpacked binding at ${destPath} — is ` +
        `"out/main/better_sqlite3.node" still listed in asarUnpack?`,
    );
  }

  fs.copyFileSync(sourcePath, destPath);
  console.log(`${TAG} Stamped ${platform}-${arch} binding → ${destPath}`);
}
