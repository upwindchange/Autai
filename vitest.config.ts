import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["test/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    testTimeout: 1000 * 29,
  },
  resolve: {
    alias: {
      "@shared": resolve(import.meta.dirname, "src/shared"),
    },
  },
});
