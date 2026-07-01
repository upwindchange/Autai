"use client";

import "streamdown/styles.css";
import "katex/dist/katex.min.css";
import "./caret.css";
import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid, type MermaidConfig } from "@streamdown/mermaid";
import { cjk } from "@streamdown/cjk";
import { useTheme } from "next-themes";
import { useAuiState } from "@assistant-ui/react";
import { LinkSafetyModal } from "./link-safety-modal";
import { isNativeRenderer } from "@/lib/env";

// Render every diagram type at its natural size. Mermaid defaults `useMaxWidth`
// to true for most types, which squeezes wide diagrams (gantt, sequence,
// mindmap, ...) to the column width and collapses their height; the
// `controls.mermaid` pan/zoom wrapper handles the resulting overflow.
const naturalDiagramSize = {
  flowchart: { useMaxWidth: false },
  swimlane: { useMaxWidth: false },
  sequence: { useMaxWidth: false },
  gantt: { useMaxWidth: false },
  journey: { useMaxWidth: false },
  timeline: { useMaxWidth: false },
  class: { useMaxWidth: false },
  state: { useMaxWidth: false },
  er: { useMaxWidth: false },
  pie: { useMaxWidth: false },
  quadrantChart: { useMaxWidth: false },
  xyChart: { useMaxWidth: false },
  requirement: { useMaxWidth: false },
  architecture: { useMaxWidth: false },
  mindmap: { useMaxWidth: false },
  ishikawa: { useMaxWidth: false },
  kanban: { useMaxWidth: false },
  gitGraph: { useMaxWidth: false },
  c4: { useMaxWidth: false },
  sankey: { useMaxWidth: false },
  packet: { useMaxWidth: false },
  block: { useMaxWidth: false },
  eventmodeling: { useMaxWidth: false },
  treeView: { useMaxWidth: false },
  radar: { useMaxWidth: false },
  venn: { useMaxWidth: false },
  "wardley-beta": { useMaxWidth: false },
  cynefin: { useMaxWidth: false },
  railroad: { useMaxWidth: false },
} satisfies MermaidConfig;

export const MarkdownText = () => {
  const { resolvedTheme } = useTheme();
  const isRunning = useAuiState((s) => s.thread.isRunning);

  return (
    <StreamdownTextPrimitive
      plugins={{ code, math, mermaid, cjk }}
      isAnimating={isRunning}
      shikiTheme={["github-light", "github-dark"]}
      mermaid={{
        config: {
          theme: resolvedTheme === "dark" ? "dark" : "base",
          ...naturalDiagramSize,
        },
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
      linkSafety={{
        enabled: isNativeRenderer(),
        renderModal: (props) => <LinkSafetyModal {...props} />,
      }}
    />
  );
};
