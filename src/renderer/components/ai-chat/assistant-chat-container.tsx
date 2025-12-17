import { Thread } from "@/components/ai-chat";
import type { FC } from "react";

interface AssistantChatContainerProps {
	showSplitView?: boolean;
}

export const AssistantChatContainer: FC<AssistantChatContainerProps> = ({
	showSplitView = false,
}) => {
	return <Thread showSplitView={showSplitView} />;
};
