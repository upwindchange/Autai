import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      ".vscode/**",
      "dist/**",
      "dist-electron/**",
      "node_modules/**",
      "*.config.js",
      "*.config.ts",
      "electron/main/scripts/*.js",
      "src/components/ui/**",
      "src/vimium/**",
      "src/vimium-c/**",
      "browser-use/**",
      "test/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  }
);
