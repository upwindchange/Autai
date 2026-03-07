import type {
	ClickResult,
	FillResult,
	SelectOptionResult,
	HoverResult,
	DragResult,
	ScrollResult,
	GetAttributeResult,
	EvaluateResult,
	GetBasicInfoResult,
} from "@shared/dom/interaction";

/**
 * Enhanced tool results with DOM change tracking
 */
export interface ToolResultBase {
	tabId: string;
	newNodesCount?: number;
	totalNodesCountChange?: number;
	timestamp?: number;
}

export interface ClickToolResult extends ToolResultBase, ClickResult {}
export interface FillToolResult extends ToolResultBase, FillResult {}
export interface SelectToolResult extends ToolResultBase, SelectOptionResult {}
export interface HoverToolResult extends ToolResultBase, HoverResult {}
export interface DragToolResult extends ToolResultBase, DragResult {}
export interface ScrollToolResult extends ToolResultBase, ScrollResult {}

export type GetAttributeToolResult = GetAttributeResult;
export type EvaluateToolResult = EvaluateResult;
export type GetBasicInfoToolResult = GetBasicInfoResult;

/**
 * DOM tool results
 */
export interface DOMTreeResult {
	tabId: string;
	newNodesCount: number;
	totalNodesCountChange: number;
	error?: string;
}

export interface FlattenDOMResult {
	tabId: string;
	representation: string;
	error?: string;
}

/**
 * Session tool results
 */
export interface SessionDetail {
	sessionId: string;
	tabCount: number;
	activeTabId: string | null;
}

export interface ListSessionsResult {
	totalSessions: number;
	sessions: SessionDetail[];
}

export interface TabDetail {
	tabId: string;
	url: string | null;
	isActive: boolean;
	backendVisibility: boolean;
}

export interface GetSessionTabsResult {
	sessionId: string;
	totalTabs: number;
	activeTabId: string | null;
	tabs: TabDetail[];
}

export interface GetTabInfoResult {
	tabId: string;
	sessionId: string;
	url: string | null;
	isActiveTab: boolean;
	backendVisibility: boolean;
	tabExists: boolean;
}

export interface CreateTabResult {
	success: boolean;
	tabId?: string;
	sessionId?: string;
	url: string;
	message?: string;
	error?: string;
}

export interface GetCurrentSessionContextResult {
	success: boolean;
	sessionId: string;
	activeTabId: string | null;
	totalTabs: number;
	tabs: TabDetail[];
	error?: string;
}

/**
 * Navigation tool results
 */
export type NavigateResult = string;
export type RefreshResult = string;
export type GoBackResult = string;
export type GoForwardResult = string;
