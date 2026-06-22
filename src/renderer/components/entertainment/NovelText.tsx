import "streamdown/styles.css";
// NOTE: katex css is intentionally NOT imported — the math plugin is disabled.
import "../ai-chat/caret.css"; // streaming cursor (relies on [data-status="running"])
import "./novel-reader.css"; // scoped novel-reading typography
import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { cjk } from "@streamdown/cjk";
import { useAuiState } from "@assistant-ui/react";

/**
 * Novel-reading text renderer for entertainment mode.
 *
 * Streamdown with ONLY the CJK plugin — no code highlighting, no math, no
 * mermaid. The reading typography (measure, line-height, first-line indent,
 * heading scale) lives in novel-reader.css, scoped to `.ent-novel-reader`.
 *
 * The container is intentionally simple; a sophisticated reader is a separate
 * future ticket.
 */
export const NovelText = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);

  return (
    <StreamdownTextPrimitive
      // CJK-only: code/math auto-detect when omitted, so disable them
      // explicitly; mermaid requires explicit enabling so we just omit it.
      plugins={{ code: false, math: false, mermaid: false, cjk }}
      isAnimating={isRunning}
      containerClassName="ent-novel-reader"
      // Minimal remend for plain prose: keep inline emphasis, drop the
      // link/image/code/katex/setext completion that's irrelevant here.
      remend={{
        bold: true,
        italic: true,
        boldItalic: true,
        strikethrough: true,
        links: false,
        images: false,
        inlineCode: false,
        katex: false,
        setextHeadings: false,
      }}
    />
  );
};
