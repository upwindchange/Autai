# Electron + React + Vite Desktop Application

This project combines Electron (for desktop capabilities), React (for UI components), and Vite (for tooling). Below is a detailed explanation of how it works:

## 📂 Directory structure

Familiar React application structure, just with `electron` folder on the top :wink:  
*Files in this folder will be separated from your React application and built into `dist-electron`*  

```tree
├── electron                                 Electron-related code
│   ├── main                                 Main-process source code
│   └── preload                              Preload-scripts source code
│
├── release                                  Generated after production build, contains executables
│   └── {version}
│       ├── {os}-{os_arch}                   Contains unpacked application executable
│       └── {app_name}_{version}.{ext}       Installer for the application
│
├── public                                   Static assets
└── src                                      Renderer source code, your React application
```

## 🧩 Core Technologies

### 1. Electron

- Creates cross-platform desktop apps using web technologies
- **Main Process**: Node.js environment that manages app lifecycle ([`electron/main/index.ts`](electron/main/index.ts))
- **Renderer Process**: Chromium-based window displaying your web app (`src/`)
- **Preload Scripts**: Bridge between main/renderer processes ([`electron/preload/index.ts`](electron/preload/index.ts))

### 2. React

- Component-based UI library similar to Svelte
- Components live in `src/` directory:
  - [`App.tsx`](src/App.tsx) - Root component
  - [`main.tsx`](src/main.tsx) - Entry point that mounts React to DOM

### 3. Vite

- Modern frontend build tool with fast HMR (Hot Module Replacement)
- Configurations:
  - [`vite.config.ts`](vite.config.ts) - Build configuration
  - [`tsconfig.json`](tsconfig.json) - TypeScript settings

## ⚙️ How It Works

### Startup Sequence

1. **Main Process** starts ([`electron/main/index.ts`](electron/main/index.ts))

   ```typescript
   app.whenReady().then(() => {
     createWindow() // Creates browser window
   })
   ```
  
2. **Preload Script** executes ([`electron/preload/index.ts`](electron/preload/index.ts))
   - Exposes Node.js APIs safely to renderer:

   ```typescript
   contextBridge.exposeInMainWorld('ipcRenderer', ipcRenderer)
   ```

3. **Renderer Process** loads (`dist/index.html` → [`src/main.tsx`](src/main.tsx))

   ```tsx
   ReactDOM.createRoot(document.getElementById('root')).render(<App />)
   ```

### Component Architecture (React)

- Similar to Svelte's component model:
  - `App.tsx` contains main UI
  - Components in `src/components/`
  - State management via `useState` hook

### Build Process

1. `npm run dev` triggers:
   - Vite dev server for renderer (HMR enabled)
   - Electron main process in watch mode
2. Production build (`npm run build`):
   - Outputs to `dist/` (renderer) and `dist-electron/` (main/preload)

## 🔗 IPC Communication

Example from [`src/demos/ipc.ts`](src/demos/ipc.ts):

```ts
// Renderer → Main
window.ipcRenderer.send('message', 'Hello from React!')

// Main → Renderer
ipcMain.on('message', (event, msg) => {
  event.reply('reply', 'Message received!')
})
```

## 🖼️ Static Assets

- Place in `public/` directory (e.g., `public/node.svg`)
- Reference directly in JSX:

  ```tsx
  <img src="./node.svg" />
  ```

## 🚀 Running the Project

```bash
npm install    # Install dependencies
npm run dev    # Start dev environment
npm run build  # Create production build
```

## 🔍 Key Files

- [`electron/main/index.ts`](electron/main/index.ts) - Main process
- [`electron/preload/index.ts`](electron/preload/index.ts) - Preload script
- [`src/App.tsx`](src/App.tsx) - Root component
- [`src/main.tsx`](src/main.tsx) - Renderer entry point
- [`vite.config.ts`](vite.config.ts) - Build configuration
