"use client";

import * as React from "react";
import { cn, Textarea, Label } from "./_adapter";
import type { InputCardProps, InputCardDecision } from "./schema";
import { ActionButtons } from "../shared/action-buttons";
import { type Action } from "../shared/schema";
import { MessageSquare, Check, X } from "lucide-react";

interface InputCardReceiptProps {
  id: string;
  question: string;
  choice: InputCardDecision;
  answer?: string;
  className?: string;
}

function InputCardReceipt({
  id,
  question,
  choice,
  answer,
  className,
}: InputCardReceiptProps) {
  const isSubmitted = choice === "submitted";
  const displayLabel = isSubmitted ? "Submitted" : "Cancelled";

  return (
    <div
      className={cn(
        "flex w-full min-w-64 max-w-md flex-col",
        "text-foreground",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:blur-in-sm motion-safe:zoom-in-95 motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)] motion-safe:fill-mode-both",
        className,
      )}
      data-slot="input-card"
      data-tool-ui-id={id}
      data-receipt="true"
      role="status"
      aria-label={displayLabel}
    >
      <div
        className={cn(
          "bg-card/60 flex w-full items-center gap-3 rounded-2xl border px-4 py-3 shadow-xs",
        )}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted",
            isSubmitted ? "text-primary" : "text-muted-foreground",
          )}
        >
          {isSubmitted ?
            <Check className="size-4" />
          : <X className="size-4" />}
        </span>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium">{displayLabel}</span>
          <span className="text-muted-foreground text-sm truncate">
            {question}
          </span>
          {isSubmitted && answer && (
            <span className="text-sm mt-0.5 truncate">&ldquo;{answer}&rdquo;</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function InputCard({
  id,
  question,
  context,
  placeholder,
  buttonLabel,
  className,
  choice,
  answer,
  onSubmit,
  onCancel,
}: InputCardProps) {
  const [inputValue, setInputValue] = React.useState("");
  const resolvedButtonLabel = buttonLabel ?? "Submit";

  const handleAction = React.useCallback(
    async (actionId: string) => {
      if (actionId === "confirm") {
        await onSubmit?.(inputValue.trim());
      } else if (actionId === "cancel") {
        await onCancel?.();
      }
    },
    [onSubmit, onCancel, inputValue],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel?.();
      }
    },
    [onCancel],
  );

  const actions: Action[] = [
    {
      id: "cancel",
      label: "Cancel",
      variant: "ghost",
    },
    {
      id: "confirm",
      label: resolvedButtonLabel,
      variant: "default",
      disabled: inputValue.trim().length === 0,
    },
  ];

  const viewKey = choice ? `receipt-${choice}` : "interactive";

  return (
    <div key={viewKey} className="contents">
      {choice ?
        <InputCardReceipt
          id={id}
          question={question}
          choice={choice}
          answer={answer}
          className={className}
        />
      : <article
          className={cn(
            "flex w-full min-w-64 max-w-md flex-col gap-3",
            "text-foreground",
            className,
          )}
          data-slot="input-card"
          data-tool-ui-id={id}
          role="dialog"
          aria-labelledby={`${id}-title`}
          aria-describedby={context ? `${id}-context` : undefined}
          onKeyDown={handleKeyDown}
        >
          <div className="bg-card flex w-full flex-col gap-4 rounded-2xl border p-5 shadow-xs">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MessageSquare className="size-5" />
              </span>
              <div className="flex flex-1 flex-col gap-1">
                <h2
                  id={`${id}-title`}
                  className="text-base font-semibold leading-tight"
                >
                  {question}
                </h2>
                {context && (
                  <p
                    id={`${id}-context`}
                    className="text-muted-foreground text-sm"
                  >
                    {context}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-input`} className="sr-only">
                {question}
              </Label>
              <Textarea
                id={`${id}-input`}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={placeholder ?? "Type your answer..."}
                className="max-h-48"
                autoFocus
              />
            </div>
          </div>
          <div className="@container/actions">
            <ActionButtons actions={actions} onAction={handleAction} />
          </div>
        </article>
      }
    </div>
  );
}
