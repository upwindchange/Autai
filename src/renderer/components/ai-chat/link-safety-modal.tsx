"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  XIcon,
} from "lucide-react";
import type { LinkSafetyModalProps } from "streamdown";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function LinkSafetyModal({
  url,
  isOpen,
  onClose,
}: LinkSafetyModalProps) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [url]);

  const openInBrowser = useCallback(() => {
    window.ipcRenderer.invoke("shell:openInSystemBrowser", url);
    onClose();
  }, [url, onClose]);

  const openInAutai = useCallback(() => {
    window.ipcRenderer.invoke("shell:openExternal", url);
    onClose();
  }, [url, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const portalContainer = document.getElementById("chat-panel-portal");
  if (!portalContainer?.parentElement) return null;

  return createPortal(
    <div
      className={cn(
        "absolute inset-0 z-50 flex items-center justify-center",
        "bg-background/50 backdrop-blur-sm",
      )}
      data-streamdown="link-safety-modal"
      onClick={onClose}
      role="button"
      tabIndex={0}
    >
      <div
        className={cn(
          "relative mx-4 flex w-full max-w-md flex-col gap-4",
          "rounded-xl border bg-background p-6 shadow-lg",
        )}
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <button
          className={cn(
            "absolute top-4 right-4 rounded-md p-1",
            "text-muted-foreground transition-all",
            "hover:bg-muted hover:text-foreground",
          )}
          onClick={onClose}
          title={t("linkSafety.close")}
          type="button"
        >
          <XIcon size={16} />
        </button>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 font-semibold text-lg">
            <ExternalLinkIcon size={20} />
            <span>{t("linkSafety.title")}</span>
          </div>
          <p className="text-muted-foreground text-sm">
            {t("linkSafety.warning")}
          </p>
        </div>

        <div
          className={cn(
            "break-all rounded-md bg-muted p-3 font-mono text-sm",
            url.length > 100 && "max-h-32 overflow-y-auto",
          )}
        >
          {url}
        </div>

        <div className="flex gap-2">
          <button
            className={cn(
              "flex flex-1 items-center justify-center gap-2",
              "rounded-md border bg-background px-4 py-2",
              "font-medium text-sm transition-all hover:bg-muted",
            )}
            onClick={copyLink}
            type="button"
          >
            {copied ? (
              <>
                <CheckIcon size={14} />
                <span>{t("linkSafety.copied")}</span>
              </>
            ) : (
              <>
                <CopyIcon size={14} />
                <span>{t("linkSafety.copyLink")}</span>
              </>
            )}
          </button>
          <button
            className={cn(
              "flex flex-1 items-center justify-center gap-2",
              "rounded-md bg-primary px-4 py-2",
              "font-medium text-primary-foreground text-sm",
              "transition-all hover:bg-primary/90",
            )}
            onClick={openInAutai}
            type="button"
          >
            <GlobeIcon size={14} />
            <span>{t("linkSafety.openInAutai")}</span>
          </button>
        </div>
        <button
          className={cn(
            "flex items-center justify-center gap-2",
            "rounded-md border px-4 py-2 w-full",
            "font-medium text-sm transition-all hover:bg-muted",
          )}
          onClick={openInBrowser}
          type="button"
        >
          <ExternalLinkIcon size={14} />
          <span>{t("linkSafety.openInBrowser")}</span>
        </button>
      </div>
    </div>,
    portalContainer.parentElement,
  );
}
