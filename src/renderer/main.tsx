import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { AppMessage } from "@shared";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import log from "electron-log/renderer";
import { SidebarLeft } from "@/components/side-bar/sidebar-left";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AssistantChatContainer } from "@/components/ai-chat";
import { SettingsProvider, SettingsView } from "@/components/settings";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { useUiStore } from "@/stores/uiStore";
import { CalculatorTool, AnswerTool } from "@/components/tools";
import {
	AssistantRuntimeProvider,
	CompositeAttachmentAdapter,
	SimpleImageAttachmentAdapter,
	SimpleTextAttachmentAdapter,
	WebSpeechSynthesisAdapter,
} from "@assistant-ui/react";
import {
	useChatRuntime,
	AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { AppHeader } from "@/components/app-header";
import { useState } from "react";
import { useSessionLifecycle } from "@/hooks";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";

import "./index.css";
import "./demos/ipc";

const logger = log.scope("Main");

// Main process message handler
const handleAppMessage = (_event: unknown, message: AppMessage) => {
	logger.debug("app message received", {
		type: message.type,
		title: message.title,
	});
	switch (message.type) {
		case "alert":
			// Persistent alert with dismiss button
			toast.custom(
				(t) => (
					<div className="w-full">
						<Alert variant="destructive" className="relative">
							<AlertCircle className="h-4 w-4" />
							<AlertTitle>{message.title}</AlertTitle>
							<AlertDescription>{message.description}</AlertDescription>
							<button
								onClick={() => toast.dismiss(t)}
								className="absolute right-3 top-3 text-destructive-foreground/70 hover:text-destructive-foreground"
							>
								<X className="h-4 w-4" />
							</button>
						</Alert>
					</div>
				),
				{
					duration: Infinity, // Never auto-dismiss
				},
			);
			break;
		case "info":
			toast.custom(() => (
				<div className="w-full">
					<Alert className="relative">
						<Info className="h-4 w-4" />
						<AlertTitle>{message.title}</AlertTitle>
						<AlertDescription>{message.description}</AlertDescription>
					</Alert>
				</div>
			));
			break;
		case "success":
			toast.custom(() => (
				<div className="w-full">
					<Alert className="relative">
						<CheckCircle2 className="h-4 w-4" />
						<AlertTitle>{message.title}</AlertTitle>
						<AlertDescription>{message.description}</AlertDescription>
					</Alert>
				</div>
			));
			break;
	}
};

/**
 * Inner app component that uses thread lifecycle hook.
 * This component must be inside AssistantRuntimeProvider to access the runtime.
 */
function AppContent() {
	const { showSettings, setShowSettings } = useUiStore();
	const [showSplitView, setShowSplitView] = useState(false);

	// Initialize thread lifecycle management
	useSessionLifecycle();

	return (
		<SettingsProvider>
			<div className="w-dvw flex flex-row h-dvh">
				<SidebarProvider>
					{showSettings ?
						<SettingsSidebar />
					:	<SidebarLeft />}
					<SidebarInset className="relative flex-1">
						<AppHeader
							title={showSettings ? "Settings" : "AI Assistant"}
							showSplitView={showSplitView}
							onToggleSplitView={() => setShowSplitView(!showSplitView)}
						/>
						<div className="relative flex flex-1 flex-col overflow-hidden h-full">
							{showSettings ?
								<SettingsView onClose={() => setShowSettings(false)} />
							:	<AssistantChatContainer showSplitView={showSplitView} />}
						</div>
					</SidebarInset>
				</SidebarProvider>
			</div>
		</SettingsProvider>
	);
}

/**
 * Main application component that provides the overall layout structure.
 * Manages the sidebar, main content area, and AI chat interface.
 */
function App() {
	// Create runtime for the entire app using AI SDK v5 with useChatRuntime
	const runtime = useChatRuntime({
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
		transport: new AssistantChatTransport({
			api: "http://localhost:3001/chat",
			headers: async () => {
				const { useBrowser, webSearch, sessionId } = useUiStore.getState();
				return {
					"X-Use-Browser": String(useBrowser),
					"X-Web-Search": String(webSearch),
					"X-Session-Id": sessionId || "",
				};
			},
		}),
		adapters: {
			speech: new WebSpeechSynthesisAdapter(),
			attachments: new CompositeAttachmentAdapter([
				new SimpleImageAttachmentAdapter(),
				new SimpleTextAttachmentAdapter(),
			]),
		},
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<CalculatorTool />
			<AnswerTool />
			{/* <ApprovalTool /> */}
			<AppContent />
		</AssistantRuntimeProvider>
	);
}

// Register the message listener once at application startup
window.ipcRenderer.on("app:message", handleAppMessage);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
		<Toaster />
	</React.StrictMode>,
);

postMessage({ payload: "removeLoading" }, "*");
