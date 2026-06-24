import {
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/ai-chat/attachment";
import { MarkdownText } from "@/components/ai-chat/streamdown";
import { RunningIndicator } from "@/components/ai-chat/running-indicator";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { ComposerTriggerPopover } from "@/components/assistant-ui/composer-trigger-popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  unstable_useSlashCommandAdapter,
  type Unstable_SlashCommand,
  useAuiEvent,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  AudioLinesIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  Globe,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  Search,
  StopCircleIcon,
} from "lucide-react";
import { type FC, useMemo } from "react";

// --- custom imports ---
import { useTranslation } from "react-i18next";
import { MessageTiming } from "@/components/assistant-ui/message-timing";
import {
  ComposerQuotePreview,
  QuoteBlock,
  SelectionToolbar,
} from "@/components/assistant-ui/quote";
import { Sources } from "@/components/assistant-ui/sources";
import { ThreadFollowupSuggestions } from "@/components/assistant-ui/follow-up-suggestions";
import { Image } from "@/components/assistant-ui/image";
import { File } from "@/components/ai-chat/file";
import { useUiStore } from "@/stores/uiStore";
import { isNativeRenderer } from "@/lib/env";
import { ComposerAction } from "@/components/ai-chat/composer-action";

// --- custom: session tracking ---
function ThreadIdTracker() {
  const setSessionId = useUiStore((state) => state.setSessionId);
  useAuiEvent("composer.send", (event) => {
    setSessionId(event.threadId);
  });
  return null;
}

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "88rem",
        ["--composer-max-width" as string]: "56rem",
        ["--composer-radius" as string]: "24px",
        ["--composer-padding" as string]: "10px",
      }}
    >
      {/* --- custom: session tracking + selection toolbar --- */}
      <ThreadIdTracker />
      <SelectionToolbar />
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        autoScroll
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto scroll-smooth"
      >
        <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4">
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <ThreadWelcome />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            className="mb-10 flex flex-col gap-y-8 empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>
          {/* --- custom: follow-up suggestions --- */}
          <ThreadFollowupSuggestions />
        </div>
        {/* --- custom: spacer + gradient overlay + centered composer --- */}
        <div className="h-20 shrink-0" />
        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mt-auto flex w-full flex-col items-center gap-0 overflow-visible">
          <div className="pointer-events-none -mt-20 mb-auto h-20 w-full bg-linear-to-t from-background via-background/80 to-transparent" />
          <div className="w-full bg-background pb-4 pt-2 md:pb-6">
            <div className="relative mx-auto w-full max-w-(--composer-max-width) rounded-t-(--composer-radius) px-1 pt-1">
              <ThreadScrollToBottom />
              <Composer />
            </div>
          </div>
        </ThreadPrimitive.ViewportFooter>{" "}
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};

const ThreadScrollToBottom: FC = () => {
  const { t } = useTranslation("common");
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip={t("thread.scrollToBottom")}
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 left-1/2 -translate-x-1/2 z-10 rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  // --- custom: i18n ---
  const { t } = useTranslation("common");
  return (
    <div className="aui-thread-welcome-root my-auto flex grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4">
          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-2xl duration-200">
            {/* --- custom: i18n --- */}
            {t("greeting.title")}
          </h1>
          <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-xl delay-75 duration-200">
            {/* --- custom: i18n --- */}
            {t("greeting.subtitle")}
          </p>
        </div>
      </div>
      <ThreadSuggestions />
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions grid w-full @md:grid-cols-2 gap-2 pb-4">
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 @md:nth-[n+3]:block nth-[n+3]:hidden animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger send asChild>
        <Button
          variant="ghost"
          className="aui-thread-welcome-suggestion h-auto w-full @md:flex-col flex-wrap items-start justify-start gap-1 rounded-3xl border bg-background px-4 py-3 text-start text-sm transition-colors hover:bg-muted"
        >
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 font-medium" />
          <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden" />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const Composer: FC = () => {
  // --- custom: i18n ---
  const { t } = useTranslation("common");
  const { setUseBrowser, setWebSearch } = useUiStore();

  const slash = unstable_useSlashCommandAdapter({
    commands: [
      ...(isNativeRenderer() ?
        [
          {
            id: "browser",
            description: t("composer.slashCommand.browser"),
            icon: "globe",
            execute: () => setUseBrowser(true),
          },
        ]
      : []),
      {
        id: "search",
        description: t("composer.slashCommand.search"),
        icon: "search",
        execute: () => setWebSearch(true),
      },
    ] as readonly Unstable_SlashCommand[],
    removeOnExecute: true,
  });

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        {/* --- custom: quote preview --- */}
        <ComposerQuotePreview />
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div
            data-slot="aui_composer-shell"
            className="flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-background p-(--composer-padding) transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50"
          >
            <ComposerAttachments />
            <ComposerPrimitive.Input
              placeholder={t("composer.placeholder")}
              className="aui-composer-input max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none placeholder:text-muted-foreground/80"
              rows={1}
              autoFocus
              aria-label={t("composer.ariaLabel")}
            />
            <ComposerAction />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
        <ComposerTriggerPopover
          char="/"
          {...slash}
          iconMap={{ globe: Globe, search: Search }}
          emptyCategoriesLabel={t("composer.slashCommand.emptyCategories")}
          emptyItemsLabel={t("composer.slashCommand.emptyItems")}
        />
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  // reserves space for action bar and compensates with `-mb` for consistent msg spacing
  // keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
  // for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;
  const status = useAuiState((s) => s.message.status?.type);
  // Show the running indicator while the message is running and the last
  // content part is not text/reasoning (tool-call-only, between tool calls,
  // or empty pre-text). Disappears once text starts streaming (caret takes over).
  const showIndicator = useAuiState((s) => {
    if ((s.message.status?.type ?? "complete") !== "running") return false;
    const parts = s.message.parts;
    if (parts.length === 0) return true;
    const last = parts[parts.length - 1];
    return last.type !== "text" && last.type !== "reasoning";
  });

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 relative animate-in duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        data-status={status !== "running" ? status : undefined}
        className="wrap-break-word px-2 text-foreground leading-relaxed flex flex-col gap-3"
      >
        <MessagePrimitive.GroupedParts
          groupBy={(part) => {
            if (part.type === "reasoning") return ["group-reasoning"];
            return null;
          }}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-reasoning": {
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot defaultOpen={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "reasoning":
                return <Reasoning {...part} />;
              case "text":
                return <MarkdownText />;
              case "tool-call":
                return part.toolUI ?? <ToolFallback {...part} />;
              // custom: rendering more message types
              case "source":
                return <Sources {...part} />;
              case "image":
                return <Image {...part} />;
              case "file":
                return <File {...part} />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        {showIndicator && <RunningIndicator />}
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  const { t } = useTranslation("common");
  const threadTitle = useAuiState((s) => s.threadListItem.title);
  const exportFilename = useMemo(() => {
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}`;
    const title = threadTitle?.trim() || "message";
    return `${title} ${ts}.md`;
  }, [threadTitle]);
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ms-1 flex gap-1 text-muted-foreground"
    >
      {/* --- custom: speech --- */}
      <AuiIf
        condition={(s) => (s.message as Record<string, unknown>).speech == null}
      >
        <ActionBarPrimitive.Speak asChild>
          <TooltipIconButton tooltip={t("action.readAloud")}>
            <AudioLinesIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.Speak>
      </AuiIf>
      <AuiIf
        condition={(s) => (s.message as Record<string, unknown>).speech != null}
      >
        <ActionBarPrimitive.StopSpeaking asChild>
          <TooltipIconButton tooltip={t("action.stop")}>
            <StopCircleIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.StopSpeaking>
      </AuiIf>
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip={t("action.copy")}>
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip={t("action.refresh")}>
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      {/* --- custom: message timing --- */}
      <MessageTiming />
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip={t("action.more")}
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown filename={exportFilename} asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              {t("action.exportMarkdown")}
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 grid animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        {/* --- custom: quote block --- */}
        <MessagePrimitive.Quote>
          {(quote) => <QuoteBlock {...quote} />}
        </MessagePrimitive.Quote>
        <div className="aui-user-message-content wrap-break-word peer rounded-2xl bg-muted px-4 py-2.5 text-foreground empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  const { t } = useTranslation("common");
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton
          tooltip={t("action.edit")}
          className="aui-user-action-edit p-4"
        >
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  const { t } = useTranslation("common");
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root ms-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">
              {t("common.cancel")}
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">{t("action.update")}</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  const { t } = useTranslation("common");
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root -ms-2 me-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip={t("branch.previous")}>
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip={t("branch.next")}>
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
