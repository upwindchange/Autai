import { useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, EyeIcon, EyeOffIcon, Save, Loader2 } from "lucide-react";
import { useSettings } from "@/components/settings";
import type { SettingsState } from "@shared";
import type { EditingProvider } from "../types";
import { getDefaultProvider } from "@shared";
import log from "electron-log/renderer";

interface ProvidersSectionProps {
	settings: SettingsState;
}

const logger = log.scope("ProvidersSection");

interface ProvidersSectionProps {
	settings: SettingsState;
}

export function ProvidersSection({ settings }: ProvidersSectionProps) {
	const { removeProvider, addProvider, updateProvider } = useSettings();
	const [editingProvider, setEditingProvider] =
		useState<EditingProvider | null>(null);
	const [showApiKey, setShowApiKey] = useState(false);
	const [isLoading, setIsLoading] = useState(false);

	const handleAddProvider = () => {
		const defaultProvider = getDefaultProvider("openai-compatible");
		setEditingProvider({
			...defaultProvider,
			id: `provider-${Date.now()}`,
			name: "New Provider",
			isNew: true,
		});
	};

	const handleSaveProvider = async () => {
		if (!editingProvider) return;

		setIsLoading(true);
		try {
			if (editingProvider.isNew) {
				await addProvider(editingProvider);
			} else {
				await updateProvider(editingProvider.id, editingProvider);
			}
			setEditingProvider(null);
		} catch (error) {
			logger.error("failed to save provider", error);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-bold">AI Providers</h2>
				<p className="text-muted-foreground mt-1">
					Manage your AI provider configurations
				</p>
			</div>

			<Card>
				<CardHeader>
					<div className="flex justify-between items-center">
						<div>
							<CardTitle>Configured Providers</CardTitle>
							<CardDescription>
								Add and manage AI providers for your models
							</CardDescription>
						</div>
						<Button onClick={handleAddProvider} size="sm">
							<Plus className="h-4 w-4 mr-2" />
							Add Provider
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-2">
					{(settings?.providers || []).length === 0 ?
						<div className="text-center py-8 text-muted-foreground">
							No providers configured. Add your first provider to get started.
						</div>
					:	(settings?.providers || []).map((provider) => (
							<div
								key={provider.id}
								className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
							>
								<div>
									<div className="font-medium">{provider.name}</div>
									<div className="text-sm text-muted-foreground">
										{provider.provider} - {provider.apiUrl || "Default URL"}
									</div>
								</div>
								<div className="flex gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											setEditingProvider({ ...provider, isNew: false })
										}
									>
										Edit
									</Button>
									{(settings?.providers?.length || 0) > 1 && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => removeProvider(provider.id)}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									)}
								</div>
							</div>
						))
					}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Provider Configuration Tips</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 text-sm text-muted-foreground">
					<p>
						• OpenAI Compatible: Works with OpenAI, Azure OpenAI, and compatible
						APIs
					</p>
					<p>
						• Anthropic: For Claude models (claude-3-opus, claude-3-sonnet,
						etc.)
					</p>
					<p>• Keep your API keys secure and never share them</p>
					<p>• Test your configuration after adding or modifying providers</p>
				</CardContent>
			</Card>

			{/* Inline Provider Editing Form */}
			{editingProvider && (
				<div className="space-y-6">
					<div className="space-y-2">
						<Label htmlFor="provider-name">Provider Name</Label>
						<Input
							id="provider-name"
							value={editingProvider.name}
							onChange={(e) => {
								setEditingProvider({
									...editingProvider,
									name: e.target.value,
								});
							}}
							placeholder="e.g., OpenAI Production, Anthropic Dev"
						/>
					</div>

					<Card>
						<CardHeader>
							<CardTitle>Provider Selection</CardTitle>
							<CardDescription>Choose your AI provider</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="provider-type">AI Provider</Label>
								<Select
									value={editingProvider.provider}
									onValueChange={(
										value: "openai-compatible" | "anthropic" | "deepinfra",
									) => {
										const defaultProvider = getDefaultProvider(value);
										setEditingProvider({
											...editingProvider,
											provider: value,
											apiKey: editingProvider.apiKey || defaultProvider.apiKey,
											apiUrl: editingProvider.apiUrl || defaultProvider.apiUrl,
										});
									}}
								>
									<SelectTrigger id="provider-type">
										<SelectValue placeholder="Select a provider type" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="openai-compatible">
											OpenAI Compatible
										</SelectItem>
										<SelectItem value="anthropic">Anthropic</SelectItem>
										<SelectItem value="deepinfra">DeepInfra</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>API Configuration</CardTitle>
							<CardDescription>
								{(() => {
									switch (editingProvider.provider) {
										case "openai-compatible":
											return "Configure your OpenAI-compatible API endpoint and authentication";
										case "anthropic":
											return "Configure your Anthropic API authentication";
										case "deepinfra":
											return "Configure your DeepInfra API endpoint and authentication";
										default:
											return "Configure your API authentication";
									}
								})()}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="api-url">API URL</Label>
								<Input
									id="api-url"
									value={editingProvider.apiUrl || ""}
									onChange={(e) => {
										setEditingProvider({
											...editingProvider,
											apiUrl: e.target.value,
										});
									}}
									onBlur={(e) => {
										if (!e.target.value) {
											const defaultProvider = getDefaultProvider(
												editingProvider.provider,
											);
											setEditingProvider({
												...editingProvider,
												apiUrl: defaultProvider.apiUrl,
											});
										}
									}}
									placeholder={`Default: ${getDefaultProvider(editingProvider.provider).apiUrl}`}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="api-key">API Key</Label>
								<div className="relative">
									<Input
										id="api-key"
										type={showApiKey ? "text" : "password"}
										value={editingProvider.apiKey}
										onChange={(e) => {
											setEditingProvider({
												...editingProvider,
												apiKey: e.target.value,
											});
										}}
										placeholder="sk-..."
										className="pr-10"
									/>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="absolute right-0 top-0 h-full px-3"
										onClick={() => setShowApiKey(!showApiKey)}
									>
										{showApiKey ?
											<EyeOffIcon className="h-4 w-4" />
										:	<EyeIcon className="h-4 w-4" />}
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>

					<div className="flex justify-end gap-2">
						<Button onClick={handleSaveProvider} disabled={isLoading}>
							{isLoading ?
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									Saving...
								</>
							:	<>
									<Save className="h-4 w-4 mr-2" />
									Save Changes
								</>
							}
						</Button>
						<Button variant="outline" onClick={() => setEditingProvider(null)}>
							Cancel
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
