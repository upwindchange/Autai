import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { PanelRightIcon } from "lucide-react";
import type { FC } from "react";

interface AppHeaderProps {
	title: string;
	showSplitView: boolean;
	onToggleSplitView: () => void;
}

export const AppHeader: FC<AppHeaderProps> = ({
	title,
	showSplitView,
	onToggleSplitView,
}) => {
	return (
		<header className="bg-background sticky top-0 flex h-14 shrink-0 items-center gap-2">
			<div className="flex flex-1 items-center gap-2 px-3">
				<SidebarTrigger />
				<Separator
					orientation="vertical"
					className="mr-2 data-[orientation=vertical]:h-4"
				/>
				<div className="flex-1">{title}</div>
				<TooltipIconButton
					variant="ghost"
					size="icon"
					tooltip={showSplitView ? "Hide split view" : "Show split view"}
					onClick={onToggleSplitView}
				>
					<PanelRightIcon className="size-4" />
				</TooltipIconButton>
			</div>
		</header>
	);
};
