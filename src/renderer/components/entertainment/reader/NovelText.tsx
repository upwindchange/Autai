import "streamdown/styles.css";
// NOTE: katex css is intentionally NOT imported — the math plugin is disabled.
import "./novel-reader.css"; // scoped novel-reading typography
import { type FC } from "react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";

/**
 * Novel-reading text renderer for entertainment mode.
 *
 * Streamdown with ONLY the CJK plugin — no code highlighting, no math, no
 * mermaid. The reading typography (measure, line-height, first-line indent,
 * heading scale) lives in novel-reader.css, scoped to `.ent-novel-reader`.
 *
 * Content comes from the chapters store (read from disk), so this is a plain
 * props-driven render — no assistant-ui message context, no streaming cursor.
 */
export const NovelText: FC<{ content: string }> = ({ content }) => (
  <Streamdown
    // CJK-only: the raw Streamdown activates a plugin only when passed, so
    // omitting code/math/diagram leaves them off — just CJK here.
    plugins={{ cjk }}
    className="ent-novel-reader"
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
  >
    {content}
  </Streamdown>
);
