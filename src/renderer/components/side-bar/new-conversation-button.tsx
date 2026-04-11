import { Button } from "@/components/ui/button";
import { ThreadListPrimitive } from "@assistant-ui/react";
import { PlusIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export function NewConversationButton() {
  const { t } = useTranslation("common");

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
