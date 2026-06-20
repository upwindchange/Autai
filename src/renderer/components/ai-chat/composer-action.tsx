import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AuiIf,
  ComposerPrimitive,
} from "@assistant-ui/react";
import {
  ArrowUpIcon,
  Blocks,
  CircleHelpIcon,
  Globe,
  Plus,
  Search,
  SquareIcon,
  ToolCase,
} from "lucide-react";
import { type FC, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "@/stores/uiStore";
import { getApiBase } from "@/lib/api";
import { isNativeRenderer } from "@/lib/env";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ComposerAddAttachment } from "@/components/ai-chat/attachment";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";

export const ComposerAction: FC = () => {
  const {
    useBrowser,
    usePlannedBrowser,
    webSearch,
    deepResearch,
    quickSearch,
    setUseBrowser,
    setUsePlannedBrowser,
    setWebSearch,
    setDeepResearch,
    setQuickSearch,
    enabledMcpServerIds,
    toggleMcpServer,
    setShowSettings,
    setActiveSettingsSection,
  } = useUiStore();
  const { t } = useTranslation("common");

  // --- custom: MCP servers ---
  const [mcpServers, setMcpServers] = useState<
    { id: string; name: string; enabled: boolean }[]
  >([]);

  useEffect(() => {
    fetch(`${getApiBase()}/mcp/servers`)
      .then((res) => res.json())
      .then((data: { id: string; name: string; enabled: string }[]) =>
        setMcpServers(
          data
            .filter((s) => s.enabled === "true")
            .map((s) => ({ id: s.id, name: s.name, enabled: true })),
        ),
      )
      .catch(() => {});
  }, []);

  const hasActiveMcpServers = enabledMcpServerIds.length > 0;

  const toolIconColor =
    useBrowser ?
      usePlannedBrowser ? "text-purple-500"
      : "text-blue-500"
    : hasActiveMcpServers ? "text-orange-500"
    : webSearch ?
      quickSearch ? "text-green-500"
      : deepResearch ? "text-purple-500"
      : "text-blue-500"
    : "";

  // effort: 0 = quick, 1 = standard, 2 = thorough
  const effort =
    quickSearch ? 0
    : deepResearch ? 2
    : 1;

  const handleAddExtensions = () => {
    setActiveSettingsSection("mcpServers");
    setShowSettings(true);
  };

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <div className="flex items-center gap-1">
        <ComposerAddAttachment />
        {/* --- custom: unified tools menu (browser use + extensions + web search) --- */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className={cn(
                "aui-button-icon size-8.5 p-1",
                (useBrowser || hasActiveMcpServers || webSearch) &&
                  "bg-muted hover:bg-muted",
              )}
            >
              <ToolCase className={cn("size-5", toolIconColor)} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            {isNativeRenderer() && (
              <>
                <DropdownMenuGroup>
                  {/* Browser Use Submenu */}
                  <DropdownMenuSub open={useBrowser ? undefined : false}>
                    <DropdownMenuSubTrigger
                      className={cn(
                        useBrowser &&
                          (usePlannedBrowser ?
                            "text-purple-500 data-[state=open]:text-purple-500"
                          : "text-blue-500 data-[state=open]:text-blue-500"),
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        setUseBrowser(!useBrowser);
                      }}
                    >
                      <Field>
                        <FieldLabel>
                          <Globe
                            className={cn(
                              "size-4",
                              useBrowser ?
                                usePlannedBrowser ? "text-purple-500"
                                : "text-blue-500"
                              : "text-muted-foreground",
                            )}
                          />
                          <span className="relative">
                            {t("composer.tools.browserUse")}
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="1em"
                              height="1em"
                              viewBox="0 0 24 24"
                              className={cn(
                                "absolute -top-2 -right-3.5 size-4",
                                useBrowser ?
                                  usePlannedBrowser ? "text-purple-500"
                                  : "text-blue-500"
                                : "text-muted-foreground",
                              )}
                            >
                              <path d="M0 0h24v24H0z" fill="none" />
                              <path
                                fill="currentColor"
                                d="M18.08 17.8c-.46.13-.87.2-1.23.2c-1.2 0-2.01-.88-2.42-2.65h-.05c-.99 1.91-2.38 2.86-4.13 2.86c-1.31 0-2.36-.49-3.15-1.48S5.92 14.5 5.92 13c0-1.75.45-3.15 1.34-4.24s2.1-1.64 3.63-1.64c.82 0 1.56.23 2.2.68c.64.46 1.13 1.1 1.47 1.93h.04l.71-2.4h2.56l-2.14 5.32c.24 1.24.49 2.09.77 2.54c.24.45.58.68 1 .68c.24 0 .43-.04.6-.11zm-4.26-5.24c-.21-1.13-.55-2.01-1.01-2.61c-.45-.61-1-.91-1.63-.91c-.82 0-1.48.37-1.97 1.1c-.49.74-.71 1.65-.71 2.72c0 .98.19 1.79.62 2.45c.42.66.99.98 1.7.98c.6 0 1.15-.29 1.64-.84c.5-.57.91-1.4 1.24-2.49z"
                              />
                            </svg>
                          </span>
                        </FieldLabel>
                        <FieldDescription>
                          {useBrowser ?
                            t("composer.browser.on")
                          : t("composer.browser.off")}
                        </FieldDescription>
                      </Field>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent alignOffset={-100} className="max-w-64">
                      <RadioGroup
                        value={usePlannedBrowser ? "planned" : "simple"}
                        onValueChange={(value) => {
                          setUsePlannedBrowser(value === "planned");
                        }}
                        className="p-2 gap-1"
                      >
                        <Field orientation="horizontal">
                          <RadioGroupItem value="simple" id="browser-mode-simple" />
                          <FieldContent>
                            <FieldLabel htmlFor="browser-mode-simple">
                              {t("composer.browser.mode.simple")}
                            </FieldLabel>
                            <FieldDescription>
                              {t("composer.browser.mode.simple.description")}
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                        <Field orientation="horizontal">
                          <RadioGroupItem
                            value="planned"
                            id="browser-mode-planned"
                          />
                          <FieldContent>
                            <FieldLabel htmlFor="browser-mode-planned">
                              {t("composer.browser.mode.planned")}
                            </FieldLabel>
                            <FieldDescription>
                              {t("composer.browser.mode.planned.description")}
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </RadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuGroup>

                <DropdownMenuSeparator />
              </>
            )}

            {/* Extensions Submenu */}
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Field>
                    <FieldLabel>
                      <Blocks
                        className={cn(
                          "size-4",
                          hasActiveMcpServers ?
                            "text-orange-500"
                          : "text-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          hasActiveMcpServers ?
                            "text-orange-500"
                          : "text-muted-foreground",
                        )}
                      >
                        {t("composer.tools.extensions")}
                      </span>
                    </FieldLabel>
                    <FieldDescription>
                      {hasActiveMcpServers ?
                        t("composer.tools.extensions.on")
                      : t("composer.tools.extensions.description")}
                    </FieldDescription>
                  </Field>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {mcpServers.map((server) => (
                    <DropdownMenuItem
                      key={server.id}
                      className="flex items-center justify-between"
                      onSelect={(e) => {
                        e.preventDefault();
                        toggleMcpServer(server.id);
                      }}
                    >
                      {server.name}
                      <Switch
                        size="sm"
                        checked={enabledMcpServerIds.includes(server.id)}
                      />
                    </DropdownMenuItem>
                  ))}
                  {mcpServers.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem onClick={handleAddExtensions}>
                    <Plus className="size-4" />
                    {t("composer.tools.addExtensions")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            {/* Web Search Submenu */}
            <DropdownMenuGroup>
              <DropdownMenuSub open={webSearch ? undefined : false}>
                <DropdownMenuSubTrigger
                  className={cn(
                    webSearch &&
                      (quickSearch ?
                        "text-green-500 data-[state=open]:text-green-500"
                      : deepResearch ?
                        "text-purple-500 data-[state=open]:text-purple-500"
                      : "text-blue-500 data-[state=open]:text-blue-500"),
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    setWebSearch(!webSearch);
                  }}
                >
                  <Field>
                    <FieldLabel>
                      <Search
                        className={cn(
                          "size-4",
                          webSearch ?
                            quickSearch ? "text-green-500"
                            : deepResearch ? "text-purple-500"
                            : "text-blue-500"
                          : "text-muted-foreground",
                        )}
                      />
                      {t("composer.tools.webSearch")}
                    </FieldLabel>
                    <FieldDescription>
                      {webSearch ?
                        t("composer.webSearch.on")
                      : t("composer.webSearch.off")}
                    </FieldDescription>
                  </Field>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent alignOffset={-100} className="max-w-64">
                  <div className="space-y-2 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">
                        {t("composer.effort.label")}
                      </span>
                      <TooltipProvider delayDuration={0}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <CircleHelpIcon className="size-3.5 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-56 text-xs">
                            {t("composer.effort.description")}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <RadioGroup
                      value={String(effort)}
                      onValueChange={(v) => {
                        if (v === "0") {
                          setQuickSearch(true);
                        } else if (v === "2") {
                          setDeepResearch(true);
                        } else {
                          setDeepResearch(false);
                          setQuickSearch(false);
                        }
                      }}
                      className="gap-1.5"
                    >
                      <Field orientation="horizontal">
                        <RadioGroupItem value="0" id="effort-quick" />
                        <FieldContent>
                          <FieldLabel htmlFor="effort-quick">
                            {t("composer.effort.quick")}
                          </FieldLabel>
                        </FieldContent>
                      </Field>
                      <Field orientation="horizontal">
                        <RadioGroupItem value="1" id="effort-standard" />
                        <FieldContent>
                          <FieldLabel htmlFor="effort-standard">
                            {t("composer.effort.standard")}
                          </FieldLabel>
                        </FieldContent>
                      </Field>
                      <Field orientation="horizontal">
                        <RadioGroupItem value="2" id="effort-thorough" />
                        <FieldContent>
                          <FieldLabel htmlFor="effort-thorough">
                            {t("composer.effort.thorough")}
                          </FieldLabel>
                        </FieldContent>
                      </Field>
                    </RadioGroup>
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip={t("composer.sendMessage")}
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-send size-8 rounded-full"
            aria-label={t("composer.sendMessage")}
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-8 rounded-full"
            aria-label={t("composer.stopGenerating")}
          >
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};
