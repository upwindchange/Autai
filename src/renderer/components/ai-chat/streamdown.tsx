"use client";

import "streamdown/styles.css";
import "katex/dist/katex.min.css";
import "./caret.css";
import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { cjk } from "@streamdown/cjk";
import { useTheme } from "next-themes";
import { useAuiState } from "@assistant-ui/react";

export const MarkdownText = () => {
  const { resolvedTheme } = useTheme();
  const isRunning = useAuiState((s) => s.thread.isRunning);

  return (
    <StreamdownTextPrimitive
      plugins={{ code, math, mermaid, cjk }}
      isAnimating={isRunning}
      shikiTheme={["github-light", "github-dark"]}
      mermaid={{
        config: { theme: resolvedTheme === "dark" ? "dark" : "base" },
        errorComponent: ({ retry }) => (
          <div className="flex items-center justify-center p-4 text-muted-foreground">
            <button onClick={retry} className="text-sm underline">
              Retry diagram
            </button>
          </div>
        ),
      }}
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
        mermaid: true,
        table: true,
      }}
    />
  );
};
