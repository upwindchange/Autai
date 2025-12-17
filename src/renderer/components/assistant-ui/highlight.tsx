"use client";

import { FC } from "react";
import { Light as ReactSyntaxHighlighter } from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import type { SyntaxHighlighterProps as AUIProps } from "@assistant-ui/react-markdown";
import { cn } from "@/lib/utils";

/**
 * Props for the Highlight component
 */
export type HighlightProps = Pick<
	AUIProps,
	"node" | "components" | "language" | "code"
> & {
	className?: string;
};

/**
 * Highlight component using react-syntax-highlighter with highlight.js
 * Automatically detects language when not specified
 * All highlight.js languages are supported out of the box
 *
 * @example
 * const defaultComponents = memoizeMarkdownComponents({
 *   SyntaxHighlighter: Highlight,
 *   h1: //...
 *   //...other elements...
 * });
 */
export const Highlight: FC<HighlightProps> = ({
	code,
	language,
	className,
	node: _node,
	components: _components,
	...props
}) => {
	const BASE_STYLES =
		"[&_pre]:overflow-x-auto [&_pre]:rounded-b-lg [&_pre]:bg-black [&_pre]:p-4 [&_pre]:text-white";

	// Use provided language if available, otherwise let highlight.js auto-detect
	// If language is provided but unknown, highlight.js will handle it gracefully
	const effectiveLanguage = language || "plaintext";

	return (
		<ReactSyntaxHighlighter
			{...props}
			language={effectiveLanguage}
			style={atomOneDark}
			className={cn(BASE_STYLES, className)}
			PreTag="pre"
			showLineNumbers={false}
			customStyle={{
				margin: 0,
				padding: "1rem",
				background: "black",
				borderRadius: "0 0 0.5rem 0.5rem",
			}}
		>
			{code.trim()}
		</ReactSyntaxHighlighter>
	);
};

Highlight.displayName = "Highlight";

// Export as SyntaxHighlighter for compatibility with markdown-text.tsx
export const SyntaxHighlighter = Highlight;
