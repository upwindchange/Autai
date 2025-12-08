import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [
      {
        name: "watch-main-reload",
        closeBundle() {
          if (process.env.NODE_ENV !== "production") {
            process.send?.("rebuild");
          }
        },
      },
    ],
    build: {
      sourcemap: true,
      watch: process.env.NODE_ENV !== "production" ? {} : null,
      externalizeDeps: true,
    },
    resolve: {
      alias: {
        "@": resolve("src/main"),
        "@agents": resolve("src/main/agents"),
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: true,
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src/renderer"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
