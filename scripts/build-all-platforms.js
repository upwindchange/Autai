import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const isHost = (platform) => platform === process.platform

// One build per platform. electron-builder handles arch variants per its config.
// x64 .node binary works on arm64 via emulation (Windows) or Rosetta 2 (macOS).
const targets = [
  { platform: 'linux', flag: '--linux', native: null },
  { platform: 'win32', flag: '--win', native: 'win32-x64' },
  // macOS config doesn't specify arch, so build each arch separately
  { platform: 'darwin', flag: '--mac --x64', native: 'darwin-x64' },
  { platform: 'darwin', flag: '--mac --arm64', native: 'darwin-arm64' },
]

function run(cmd, env = {}) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
}

// 1. Build JS bundle once (copies host Linux binary to out/main/)
console.log('=== Building with electron-vite ===')
run('electron-vite build')

// 2. Build each platform
for (const { platform, flag, native } of targets) {
  console.log(`\n=== Building ${platform} ===`)

  if (!isHost(platform)) {
    try {
      run('electron-vite build', { NATIVE_BINDING_TARGET: native })
    } catch {
      console.error(`Skipping ${platform}: binary download failed`)
      continue
    }
  }

  run(`electron-builder ${flag} --config.npmRebuild false`)
}
