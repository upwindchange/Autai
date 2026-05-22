"use client";

import "streamdown/styles.css";
import "katex/dist/katex.min.css";
import "./caret.css";
import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { cjk } from "@streamdown/cjk";

export const MarkdownText = () => (
  <StreamdownTextPrimitive
    plugins={{
      code,
      math: createMathPlugin({ singleDollarTextMath: true }),
      mermaid,
      cjk,
    }}
    shikiTheme={["github-light", "github-dark"]}
    remend={{
      links: true,
      images: true,
      linkMode: "protocol",
      bold: true,
      italic: true,
      boldItalic: true,
      inlineCode: true,
      strikethrough: true,
      katex: true,
      setextHeadings: true,
    }}
    controls={{
      code: true,
      mermaid: {
        download: true,
        copy: true,
        fullscreen: true,
        panZoom: true,
      },
      table: true,
    }}
  />
);
