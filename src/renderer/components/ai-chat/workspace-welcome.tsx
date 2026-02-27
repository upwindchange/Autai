import { FC } from "react";
import { Globe, PencilIcon, Search } from "lucide-react";

export const WorkspaceWelcome: FC = () => {
	return (
		<div className="flex flex-col items-center justify-center p-8 text-center space-y-6 fade-in slide-in-from-bottom-2 animate-in duration-300 ease-out">
			<div className="space-y-2">
				<div className="text-4xl font-bold text-foreground">
					Welcome to Autai
				</div>
				<div className="text-lg text-muted-foreground">
					Your AI-Powered Browser Automation Assistant
				</div>
			</div>

			<div className="max-w-2xl space-y-4 text-muted-foreground">
				<p>
					Autai enables you to automate web browsing tasks using AI. Start a
					conversation, and I'll help you navigate websites, fill forms, extract
					data, and more.
				</p>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 w-full max-w-3xl">
				<div className="flex flex-col items-center p-4 rounded-lg bg-background/50 border border-border/50">
					<Globe className="size-8 mb-2 text-blue-500" />
					<div className="font-medium text-foreground">Browse</div>
					<div className="text-sm text-muted-foreground">
						Navigate any website automatically
					</div>
				</div>
				<div className="flex flex-col items-center p-4 rounded-lg bg-background/50 border border-border/50">
					<PencilIcon className="size-8 mb-2 text-green-500" />
					<div className="font-medium text-foreground">Automate</div>
					<div className="text-sm text-muted-foreground">
						Fill forms and interact with elements
					</div>
				</div>
				<div className="flex flex-col items-center p-4 rounded-lg bg-background/50 border border-border/50">
					<Search className="size-8 mb-2 text-purple-500" />
					<div className="font-medium text-foreground">Extract</div>
					<div className="text-sm text-muted-foreground">
						Gather data from web pages
					</div>
				</div>
			</div>

			<div className="text-sm text-muted-foreground pt-4">
				Try asking me to &quot;Search for the weather in San Francisco&quot; or
				&quot;Find the price of iPhone 15 on Amazon&quot;
			</div>
		</div>
	);
};
