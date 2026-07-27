import { Button } from "@/components/ui/button";
import { ThreadListPrimitive } from "@assistant-ui/react";
import { PlusIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "@/stores/uiStore";
import { useChaptersStore } from "@/stores/chaptersStore";
import { useEntertainmentNewConversation } from "@/hooks/useEntertainmentNewConversation";

/**
 * "New Conversation" — mode-branched.
 *
 * CHAT mode: the stock assistant-ui flow. `ThreadListPrimitive.New` eagerly
 * creates a DB row via `adapter.initialize` (POST /threads) and switches to it.
 * Unchanged from the original behavior.
 *
 * ENTERTAINMENT mode: the reader's Stop+new action (`useEntertainmentNewConversation`)
 * — stop the thread's in-flight work, persist it in its stopped state, and switch
 * to a fresh wizard. Disabled while the wizard is showing (mid-setup): abandoning
 * an in-progress wizard is handled by the wizard's own "Start over" affordance,
 * not this button, because the assistant-ui runtime treats the current "new"
 * thread specially and switching away from it mid-wizard is unreliable.
 */
export function NewConversationButton() {
  const { t } = useTranslation("common");
  const appMode = useUiStore((s) => s.appMode);

  if (appMode === "entertainment") {
    return <EntertainmentNewConversationButton />;
  }
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        variant="outline"
        className="aui-thread-list-new h-9 w-full justify-start gap-2 rounded-lg px-3 text-sm hover:bg-muted data-active:bg-muted"
      >
        <PlusIcon className="size-4" />
        {t("sidebar.newConversation")}
      </Button>
    </ThreadListPrimitive.New>
  );
}

/**
 * The entertainment-mode variant. Only active in the reader (a thread with an
 * open chapter); disabled while the wizard is showing. The action is the shared
 * stop+new hook (same one the reader's Stop button uses).
 */
function EntertainmentNewConversationButton() {
  const { t } = useTranslation("common");
  const { abandon, stopping } = useEntertainmentNewConversation();
  // The wizard shows when no chapter is open. Disable the button then —
  // abandoning an in-progress wizard is the wizard's own concern.
  const inWizard = useChaptersStore((s) => s.currentChapterNumber == null);
  return (
    <Button
      variant="outline"
      className="aui-thread-list-new h-9 w-full justify-start gap-2 rounded-lg px-3 text-sm hover:bg-muted data-active:bg-muted disabled:opacity-50"
      onClick={() => void abandon()}
      disabled={stopping || inWizard}
    >
      <PlusIcon className="size-4" />
      {t("sidebar.newConversation")}
    </Button>
  );
}
