import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { WallPromptPayload } from "@shared/events";
import { ApprovalCard } from "@/components/tool-ui/approval-card";
import { Button } from "@/components/ui/button";
import { httpClient } from "@/lib/httpClient";

/**
 * Wall prompt — the chaptered internet fetch hit a wall (login / paywall /
 * captcha / age gate) and parked. `ask` shows the step-in ApprovalCard;
 * `stepping` shows a slim "finish in the browser view" banner while the user
 * works in the split view. Answers go to POST /hitl/respond with the
 * prompt's id; the backend then either continues on the same site (probe
 * clean) or re-asks / skips, and the card disappears on the next
 * `story:wallPrompt` event (cleared).
 */
export const WallPromptCard: FC<{ prompt: WallPromptPayload }> = ({ prompt }) => {
  const { t } = useTranslation("reader");
  // Answer sent, waiting for the backend's next SSE payload — disables the
  // buttons and shows the matching receipt so nothing double-fires.
  const [pendingAction, setPendingAction] = useState<
    "stepIn" | "reject" | "done" | "giveUp" | null
  >(null);
  const respond = (action: "stepIn" | "reject" | "done" | "giveUp") => {
    setPendingAction(action);
    void httpClient
      .postCommand("/hitl/respond", { id: prompt.id, response: { action } })
      .catch(() => setPendingAction(null));
  };
  if (prompt.state === "stepping") {
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3">
        <span className="flex items-center gap-2 text-sm">
          {pendingAction != null && <Loader2 className="size-4 animate-spin" />}
          {t("reader.wall.stepping")}
        </span>
        <span className="flex gap-2">
          <Button
            size="sm"
            disabled={pendingAction != null}
            onClick={() => respond("done")}
          >
            {t("reader.wall.done")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pendingAction != null}
            onClick={() => respond("giveUp")}
          >
            {t("reader.wall.giveUp")}
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <ApprovalCard
        id={prompt.id}
        title={t("reader.wall.title")}
        description={t("reader.wall.body", {
          host: prompt.host,
          n: prompt.chapterNumber,
        })}
        icon="shield-alert"
        metadata={[
          { key: t("reader.wall.reason.chapter"), value: String(prompt.chapterNumber) },
          { key: t("reader.wall.reason.site"), value: prompt.host },
          { key: t("reader.wall.reason.reason"), value: reasonLabel(t, prompt.reason) },
        ]}
        confirmLabel={t("reader.wall.stepIn")}
        cancelLabel={t("reader.wall.reject")}
        choice={
          pendingAction === "stepIn" ? "approved"
          : pendingAction === "reject" ? "denied"
          : undefined
        }
      />
    </div>
  );
};

/**
 * Map a wall reason string (probe marker or agent verdict) to a short label.
 * Reasons are free-form (`wall:<marker>` / agent strings), so match on
 * substrings; unknown reasons fall back to a generic label.
 */
function reasonLabel(
  t: (key: string) => string,
  reason: string,
): string {
  const r = reason.toLowerCase();
  if (/login|登录|登陆/.test(r)) return t("reader.wall.reason.login");
  if (/pay|vip|付费|订阅|member/.test(r)) return t("reader.wall.reason.paywall");
  if (/captcha|人机|verify/.test(r)) return t("reader.wall.reason.captcha");
  if (/age|年龄/.test(r)) return t("reader.wall.reason.age");
  return t("reader.wall.reason.unknown");
}
