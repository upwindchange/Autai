import { Button } from "@/components/ui/button";
import { ThreadListPrimitive } from "@assistant-ui/react";
import { PlusIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "@/stores/uiStore";
import { useChaptersStore } from "@/stores/chaptersStore";
import { useStoryThreadsStore } from "@/stores/storyThreadsStore";

/**
 * "New Conversation" — mode-branched.
 *
 * CHAT mode: the stock assistant-ui flow. `ThreadListPrimitive.New` eagerly
 * creates a DB row via `adapter.initialize` (POST /threads) and switches to it.
 *
 * STORY mode: drop the current thread and open a fresh wizard
 * (`abandon` — synchronous, POST-free; the next thread is created only at the
 * wizard's StepNovel commit). Disabled while the wizard is showing: abandoning
 * an in-progress wizard is the wizard's own "Start over" concern.
 */
export function NewConversationButton() {
  const { t } = useTranslation("common");
  const appMode = useUiStore((s) => s.appMode);

  if (appMode === "story") {
    return <StoryNewConversationButton />;
  }
  return (
    <ThreadListPrimitive.New asChild>
      <Button className="aui-thread-list-new h-9 w-full justify-start gap-2 rounded-lg px-3">
        <PlusIcon className="size-4" />
        {t("sidebar.newConversation")}
      </Button>
    </ThreadListPrimitive.New>
  );
}

/**
 * The story-mode variant. Only active in the reader (a thread with an
 * open chapter); disabled while the wizard is showing.
 */
function StoryNewConversationButton() {
  const { t } = useTranslation("common");
  // The wizard shows when no chapter is open. Disable the button then —
  // abandoning an in-progress wizard is the wizard's own concern.
  const inWizard = useChaptersStore((s) => s.currentChapterNumber == null);
  return (
    <Button
      className="aui-thread-list-new h-9 w-full justify-start gap-2 rounded-lg px-3 disabled:opacity-50"
      onClick={() => useStoryThreadsStore.getState().abandon()}
      disabled={inWizard}
    >
      <PlusIcon className="size-4" />
      {t("sidebar.newStory")}
    </Button>
  );
}
