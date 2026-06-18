import { type Toolkit } from "@assistant-ui/react";
import {
  CalculatorIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { httpClient } from "@/lib/httpClient";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Plan } from "@/components/tool-ui/plan";
import { safeParseSerializablePlan } from "@/components/tool-ui/plan/schema";
import { ToolUI } from "@/components/tool-ui/shared";
import {
  Source,
  SourceIcon,
  SourceTitle,
  extractDomain,
} from "@/components/assistant-ui/sources";

export const genericToolkit: Toolkit = {
  // Calculator tool - executes on backend, renders result on frontend
  calculate: {
    type: "backend",
    render: ({ args, status, result }) => {
      return (
        <div
          className={cn(
            "my-2 rounded-lg border bg-card p-3",
            status.type === "running" && "animate-pulse",
          )}
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <CalculatorIcon className="h-4 w-4" />
            <span className="font-medium">Calculator</span>
          </div>
          <div className="space-y-2">
            <div className="font-mono text-sm">{args.expression}</div>
            {result && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">=</span>
                <span className="font-mono font-semibold text-sm">
                  {result.error ?
                    <span className="text-destructive">{result.error}</span>
                  : result.result?.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      );
    },
  },

  // Plan tool - backend renders a structured plan, UI displays it
  plan: {
    type: "backend",
    render: ({ result }) => {
      const parsed = safeParseSerializablePlan(result);
      if (!parsed) return null;

      // Check raw result for approval flag (backend sets this, not in schema)
      const needsApproval =
        (result as Record<string, unknown>)?.requiresApproval === true;

      if (!needsApproval) {
        return <Plan {...parsed} />;
      }

      return (
        <ToolUI id={parsed.id}>
          <ToolUI.Surface>
            <Plan {...parsed} />
          </ToolUI.Surface>
          <ToolUI.Actions>
            <ToolUI.LocalActions
              actions={[
                { id: "approve", label: "Approve Plan" },
                {
                  id: "revise",
                  label: "Request Changes",
                  variant: "secondary",
                },
              ]}
              onAction={(actionId) => {
                const decision =
                  actionId === "approve" ? "approved" : "rejected";
                void httpClient.postCommand("/hitl/respond", {
                  id: parsed.id,
                  response: decision,
                });
              }}
            />
          </ToolUI.Actions>
        </ToolUI>
      );
    },
  },

  // Sources tool - presents reference URLs as clickable badge chips with favicons
  presentSources: {
    type: "backend",
    render: ({ result }) => {
      if (!result) return null;
      const { sources = [] } = result as {
        sources?: Array<{ url: string; title?: string }>;
      };
      return <SourcesWithContextMenu sources={sources} />;
    },
  },
};

function SourcesWithContextMenu({
  sources,
}: {
  sources: Array<{ url: string; title?: string }>;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="flex flex-wrap gap-1.5 my-1">
      {sources.map((s, i) => (
        <ContextMenu key={i}>
          <ContextMenuTrigger asChild>
            <Source href={s.url}>
              <span className="text-muted-foreground text-xs font-medium tabular-nums">
                [{i + 1}]
              </span>
              <SourceIcon url={s.url} />
              <SourceTitle>{s.title || extractDomain(s.url)}</SourceTitle>
            </Source>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onClick={() => {
                void httpClient.postCommand("/shell/open-external", {
                  url: s.url,
                });
              }}
            >
              <GlobeIcon />
              {t("source.openInAutai")}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                void httpClient.postCommand("/shell/open-system-browser", {
                  url: s.url,
                });
              }}
            >
              <ExternalLinkIcon />
              {t("source.openInExternalBrowser")}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                navigator.clipboard.writeText(s.url);
              }}
            >
              <CopyIcon />
              {t("source.copyLink")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
}
