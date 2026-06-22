import type { FC } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useTagStore } from "@/stores/tagStore";

/**
 * Placeholder entertainment thread view.
 *
 * The real entertainment UI is built later; this stub exists so the mode swap is
 * end-to-end testable now. It renders inside the existing AssistantRuntimeProvider,
 * so a future chat-like entertainment view can consume useAuiState/useAui here
 * without any architectural change — or stay plain React and ignore assistant-ui.
 */
export const EntertainmentThread: FC = () => {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const title = useTagStore((s) =>
    mainThreadId
      ? (s.threads.find((th) => th.remoteId === mainThreadId)?.title ?? null)
      : null,
  );

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold">Entertainment</h1>
      <p className="text-muted-foreground text-sm">
        {title ? `Active: ${title}` : "Select or create an entertainment thread."}
      </p>
      <p className="text-muted-foreground/70 text-xs">
        (Placeholder — the entertainment UI is built later.)
      </p>
    </div>
  );
};
