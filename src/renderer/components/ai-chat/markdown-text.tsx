"use client";

import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { cjk } from "@streamdown/cjk";

export const MarkdownText = () => (
  <StreamdownTextPrimitive
    plugins={{ code, math, mermaid, cjk }}
    shikiTheme={["github-light", "github-dark"]}
    caret="block"
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
    allowedTags={{
      div: ["class", "id"],
      span: ["class", "style"],
    }}
  />
);
