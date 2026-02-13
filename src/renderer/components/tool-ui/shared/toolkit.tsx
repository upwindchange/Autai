import type { ReactNode } from "react";

export type ToolUiToolkitRenderContext = {
	args?: unknown;
	result?: unknown;
	toolCallId?: string;
	addResult?: (result: unknown) => Promise<void> | void;
	[key: string]: unknown;
};

type ParseWithIdOptions = {
	idPrefix?: string;
	toolCallId?: string;
};

function ensureIdOnObject(
	payload: unknown,
	{ idPrefix = "tool-ui", toolCallId }: ParseWithIdOptions,
): unknown {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return payload;
	}

	const currentId = (payload as { id?: unknown }).id;
	if (typeof currentId === "string" && currentId.length > 0) {
		return payload;
	}

	const fallbackId = `${idPrefix}-${toolCallId ?? "call"}`;
	return { ...(payload as Record<string, unknown>), id: fallbackId };
}

export function parseToolUiArgs<T>(
	safeParse: (input: unknown) => T | null,
	args: unknown,
	options?: ParseWithIdOptions,
): T | null {
	const withId = ensureIdOnObject(args, options ?? {});
	return safeParse(withId);
}

export function createResultToolRenderer<T>(options: {
	safeParse: (input: unknown) => T | null;
	render: (parsed: T, ctx: ToolUiToolkitRenderContext) => ReactNode;
}) {
	return (ctx: ToolUiToolkitRenderContext) => {
		const parsed = options.safeParse(ctx.result);
		if (!parsed) return null;
		return options.render(parsed, ctx);
	};
}

export function createArgsToolRenderer<T>(options: {
	safeParse: (input: unknown) => T | null;
	idPrefix: string;
	render: (parsedArgs: T, ctx: ToolUiToolkitRenderContext) => ReactNode;
}) {
	return (ctx: ToolUiToolkitRenderContext) => {
		const parsedArgs = parseToolUiArgs(options.safeParse, ctx.args, {
			idPrefix: options.idPrefix,
			toolCallId:
				typeof ctx.toolCallId === "string" ? ctx.toolCallId : undefined,
		});

		if (!parsedArgs) return null;
		return options.render(parsedArgs, ctx);
	};
}
