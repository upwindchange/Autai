import {
  createHighlighterCore,
  type HighlighterCore,
} from 'shiki/core';
import getWasm from 'shiki/wasm';

let highlighterPromise: Promise<HighlighterCore> | null = null;

/**
 * Creates and caches a Shiki highlighter instance
 */
export async function loadHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import('shiki/themes/github-dark.mjs'),
        import('shiki/themes/github-light.mjs'),
      ],
      langs: [
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/python.mjs'),
        import('shiki/langs/java.mjs'),
        import('shiki/langs/c.mjs'),
        import('shiki/langs/cpp.mjs'),
        import('shiki/langs/csharp.mjs'),
        import('shiki/langs/go.mjs'),
        import('shiki/langs/rust.mjs'),
        import('shiki/langs/php.mjs'),
        import('shiki/langs/ruby.mjs'),
        import('shiki/langs/swift.mjs'),
        import('shiki/langs/kotlin.mjs'),
        import('shiki/langs/sql.mjs'),
        import('shiki/langs/html.mjs'),
        import('shiki/langs/css.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/yaml.mjs'),
        import('shiki/langs/markdown.mjs'),
        import('shiki/langs/bash.mjs'),
        import('shiki/langs/shell.mjs'),
        import('shiki/langs/powershell.mjs'),
        import('shiki/langs/dockerfile.mjs'),
        import('shiki/langs/xml.mjs'),
        import('shiki/langs/jsx.mjs'),
        import('shiki/langs/tsx.mjs'),
      ],
      loadWasm: getWasm,
    });
  }

  return highlighterPromise;
}

/**
 * Get the appropriate theme based on system preference
 */
export function getTheme(): string {
  // Check if dark mode is enabled
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return isDark ? 'github-dark' : 'github-light';
}