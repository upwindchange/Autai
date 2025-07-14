import { rmSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import { spawn } from 'node:child_process'
import pkg from './package.json'

// https://vitejs.dev/config/
// Custom plugin to build and copy hintDetector.js file
const buildHintDetectorPlugin = () => ({
  name: 'build-hint-detector',
  async buildStart() {
    // Build hintDetector.ts before the main build starts
    console.log('Building hintDetector.ts...')
    
    const buildScriptPath = path.join(__dirname, 'electron/main/scripts/buildHintDetector.js')
    
    // Check if we need to build (source is newer than output)
    const sourcePath = path.join(__dirname, 'electron/main/scripts/hintDetector.ts')
    const outputPath = path.join(__dirname, 'electron/main/scripts/hintDetector.js')
    
    const shouldBuild = !existsSync(outputPath) || 
      (existsSync(sourcePath) && existsSync(outputPath) && 
       require('fs').statSync(sourcePath).mtime > require('fs').statSync(outputPath).mtime)
    
    if (shouldBuild) {
      return new Promise((resolve, reject) => {
        const child = spawn('node', [buildScriptPath], {
          stdio: 'inherit',
          shell: true
        })
        
        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`buildHintDetector.js exited with code ${code}`))
          } else {
            resolve()
          }
        })
        
        child.on('error', (err) => {
          reject(err)
        })
      })
    } else {
      console.log('hintDetector.js is up to date, skipping build')
    }
  },
  closeBundle() {
    // Create the scripts directory if it doesn't exist
    const scriptsDir = path.join(__dirname, 'dist-electron/main/scripts')
    mkdirSync(scriptsDir, { recursive: true })
    
    // Copy the hintDetector.js file
    const sourcePath = path.join(__dirname, 'electron/main/scripts/hintDetector.js')
    const destPath = path.join(scriptsDir, 'hintDetector.js')
    
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, destPath)
      console.log('Copied hintDetector.js to dist-electron/main/scripts/')
    } else {
      console.error('Warning: hintDetector.js not found at', sourcePath)
    }
  }
})

export default defineConfig(({ command }) => {
  rmSync('dist-electron', { recursive: true, force: true })

  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG

  return {
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src')
      },
    },
    plugins: [
      react(),
      electron({
        main: {
          // Shortcut of `build.lib.entry`
          entry: 'electron/main/index.ts',
          onstart(args) {
            if (process.env.VSCODE_DEBUG) {
              console.log(/* For `.vscode/.debug.script.mjs` */'[startup] Electron App')
            } else {
              args.startup()
            }
          },
          vite: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: Object.keys('dependencies' in pkg ? pkg.dependencies : {}),
                plugins: [buildHintDetectorPlugin()],
              },
            },
          },
        },
        preload: {
          // Shortcut of `build.rollupOptions.input`.
          // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
          input: 'electron/preload/index.ts',
          vite: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined, // #332
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rollupOptions: {
                external: Object.keys('dependencies' in pkg ? pkg.dependencies : {}),
              },
            },
          },
        },
        // Ployfill the Electron and Node.js API for Renderer process.
        // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        renderer: {},
      }),
      tailwindcss(),
    ],
    server: process.env.VSCODE_DEBUG && (() => {
      const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL)
      return {
        host: url.hostname,
        port: +url.port,
      }
    })(),
    clearScreen: false,
  }
})
