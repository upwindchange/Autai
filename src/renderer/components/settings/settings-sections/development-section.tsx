import { useState, useEffect } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Trash2, FolderOpen, ExternalLink } from "lucide-react";
import { useSettings } from "@/components/settings";
import type { SettingsState, LogLevel, LangfuseConfig } from "@shared";
import log from "electron-log/renderer";

const logger = log.scope("DevelopmentSection");

interface DevelopmentSectionProps {
	settings: SettingsState;
}

export function DevelopmentSection({ settings }: DevelopmentSectionProps) {
	const { updateSettings } = useSettings();
	const [logLevel, setLogLevel] = useState<LogLevel>(
		settings?.logLevel || "info",
	);
	const [logPath, setLogPath] = useState<string>("");
	const [langfuseConfig, setLangfuseConfig] = useState<LangfuseConfig>({
		enabled: settings?.langfuse?.enabled || false,
		publicKey: settings?.langfuse?.publicKey || "",
		secretKey: settings?.langfuse?.secretKey || "",
		host: settings?.langfuse?.host || "",
	});

	useEffect(() => {
		if (settings?.logLevel) {
			setLogLevel(settings.logLevel);
		}
		if (settings?.langfuse) {
			setLangfuseConfig(settings.langfuse);
		}
	}, [settings]);

	useEffect(() => {
		// Get log file path
		window.ipcRenderer
			.invoke("settings:getLogPath")
			.then((path: unknown) => {
				setLogPath(String(path));
			})
			.catch((error: unknown) => {
				logger.error("Failed to get log path", error);
			});
	}, []);

	const handleLogLevelChange = async (value: string) => {
		const level = value as LogLevel;
		setLogLevel(level);
		const newSettings: SettingsState = {
			...settings,
			logLevel: level,
		};
		await updateSettings(newSettings);
	};

	const handleClearLogs = async () => {
		try {
			await window.ipcRenderer.invoke("settings:clearLogs");
			logger.info("Logs cleared successfully");
		} catch (error) {
			logger.error("Failed to clear logs", error);
		}
	};

	const handleOpenLogFolder = async () => {
		try {
			await window.ipcRenderer.invoke("settings:openLogFolder");
		} catch (error) {
			logger.error("Failed to open log folder", error);
		}
	};

	const handleLangfuseToggle = async (enabled: boolean) => {
		const newConfig = { ...langfuseConfig, enabled };
		setLangfuseConfig(newConfig);
		const newSettings: SettingsState = {
			...settings,
			langfuse: newConfig,
		};
		await updateSettings(newSettings);
	};

	const handleLangfuseConfigChange = async (
		key: keyof LangfuseConfig,
		value: string,
	) => {
		const newConfig = { ...langfuseConfig, [key]: value };
		setLangfuseConfig(newConfig);
		const newSettings: SettingsState = {
			...settings,
			langfuse: newConfig,
		};
		await updateSettings(newSettings);
	};

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-bold">Development Settings</h2>
				<p className="text-muted-foreground mt-1">
					Configure development tools and debugging options
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Logging</CardTitle>
					<CardDescription>
						Configure application logging behavior
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="space-y-2">
						<Label htmlFor="log-level">Log Level</Label>
						<Select value={logLevel} onValueChange={handleLogLevelChange}>
							<SelectTrigger id="log-level">
								<SelectValue placeholder="Select log level" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="error">Error - Only errors</SelectItem>
								<SelectItem value="warn">
									Warning - Errors and warnings
								</SelectItem>
								<SelectItem value="info">
									Info - General information (default)
								</SelectItem>
								<SelectItem value="verbose">
									Verbose - Detailed information
								</SelectItem>
								<SelectItem value="debug">Debug - Debug messages</SelectItem>
								<SelectItem value="silly">Silly - All messages</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-sm text-muted-foreground">
							Controls the verbosity of logging across the application. Higher
							levels include all lower levels.
						</p>
					</div>

					<Separator />

					<div className="space-y-4">
						<div className="space-y-2">
							<Label>Log File Location</Label>
							<div className="flex items-center gap-2">
								<code className="flex-1 px-3 py-2 bg-muted rounded-md text-xs font-mono truncate">
									{logPath || "Loading..."}
								</code>
								<Button
									variant="outline"
									size="icon"
									onClick={handleOpenLogFolder}
									title="Open log folder"
								>
									<FolderOpen className="h-4 w-4" />
								</Button>
							</div>
						</div>

						<div className="flex gap-2">
							<Button
								variant="outline"
								onClick={handleClearLogs}
								className="gap-2"
							>
								<Trash2 className="h-4 w-4" />
								Clear Logs
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Debug Tools</CardTitle>
					<CardDescription>
						Advanced debugging options for development
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<Label>Developer Tools</Label>
							<p className="text-sm text-muted-foreground">
								Enable Chrome DevTools in renderer process
							</p>
						</div>
						<Button
							variant="outline"
							onClick={() => {
								window.ipcRenderer.invoke("settings:openDevTools");
							}}
						>
							Open DevTools
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Langfuse Observability</CardTitle>
					<CardDescription>
						Configure Langfuse for AI agent tracing and analytics
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<Label htmlFor="langfuse-enabled">Enable Langfuse</Label>
							<p className="text-sm text-muted-foreground">
								Send telemetry data to Langfuse for observability
							</p>
						</div>
						<Switch
							id="langfuse-enabled"
							checked={langfuseConfig.enabled}
							onCheckedChange={handleLangfuseToggle}
						/>
					</div>

					{langfuseConfig.enabled && (
						<>
							<Separator />

							<div className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="langfuse-public-key">Public Key</Label>
									<Input
										id="langfuse-public-key"
										type="text"
										placeholder="pk-lf-..."
										value={langfuseConfig.publicKey || ""}
										onChange={(e) =>
											handleLangfuseConfigChange("publicKey", e.target.value)
										}
									/>
									<p className="text-sm text-muted-foreground">
										Your Langfuse public key from the project settings
									</p>
								</div>

								<div className="space-y-2">
									<Label htmlFor="langfuse-secret-key">Secret Key</Label>
									<Input
										id="langfuse-secret-key"
										type="password"
										placeholder="sk-lf-..."
										value={langfuseConfig.secretKey || ""}
										onChange={(e) =>
											handleLangfuseConfigChange("secretKey", e.target.value)
										}
									/>
									<p className="text-sm text-muted-foreground">
										Your Langfuse secret key from the project settings
									</p>
								</div>

								<div className="space-y-2">
									<Label htmlFor="langfuse-host">Host URL (Optional)</Label>
									<Input
										id="langfuse-host"
										type="url"
										placeholder="https://cloud.langfuse.com (default)"
										value={langfuseConfig.host || ""}
										onChange={(e) =>
											handleLangfuseConfigChange("host", e.target.value)
										}
									/>
									<p className="text-sm text-muted-foreground">
										Leave empty for cloud version or enter your self-hosted URL
									</p>
								</div>

								<div className="pt-2">
									<Button
										variant="outline"
										className="gap-2"
										onClick={() =>
											window.open("https://langfuse.com", "_blank")
										}
									>
										<ExternalLink className="h-4 w-4" />
										Open Langfuse Dashboard
									</Button>
								</div>
							</div>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
