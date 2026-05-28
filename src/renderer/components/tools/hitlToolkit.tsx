import { useState, useCallback, useMemo } from "react";
import { type Toolkit } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { PencilLine } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ApprovalCard } from "@/components/tool-ui/approval-card";
import { InputCard } from "@/components/tool-ui/input-card";
import { OptionList } from "@/components/tool-ui/option-list";
import type { OptionListSelection } from "@/components/tool-ui/option-list";
import { QuestionFlow } from "@/components/tool-ui/question-flow/question-flow";
import type { QuestionFlowChoice } from "@/components/tool-ui/question-flow/schema";

const CUSTOM_OPTION_ID = "__custom__";

function OptionListWithCustom({
  args,
  toolCallId,
  result,
}: {
  args: {
    options: Array<{
      id: string;
      label: string;
      description?: string;
      disabled?: boolean;
    }>;
    selectionMode?: "single" | "multi";
    minSelections?: number;
    maxSelections?: number;
    defaultValue?: string | string[];
  };
  toolCallId?: string;
  result: unknown;
}) {
  const { t } = useTranslation("common");

  const originalOptions = args.options.map((opt) => ({
    id: opt.id,
    label: opt.label,
    description: opt.description,
    disabled: opt.disabled,
  }));

  const originalOptionIds = new Set(originalOptions.map((o) => o.id));

  const allOptions = [
    ...originalOptions,
    {
      id: CUSTOM_OPTION_ID,
      label: t("optionList.other"),
      icon: <PencilLine className="size-4" />,
    },
  ];

  const selectionMode = args.selectionMode ?? "single";
  const minSelections = args.minSelections ?? 1;
  const defaultValue = args.defaultValue ?? undefined;

  const [currentSelection, setCurrentSelection] =
    useState<OptionListSelection>(defaultValue ?? null);
  const [customText, setCustomText] = useState("");

  const isCustomSelected =
    currentSelection === CUSTOM_OPTION_ID ||
    (Array.isArray(currentSelection) &&
      currentSelection.includes(CUSTOM_OPTION_ID));

  const optionsWithDisabled = allOptions.map((opt) => ({
    ...opt,
    disabled:
      opt.id !== CUSTOM_OPTION_ID && isCustomSelected ?
        true
      : ("disabled" in opt ? opt.disabled : false),
  }));

  const sendResponse = useCallback(
    (selection: OptionListSelection, cancelled: boolean) => {
      window.ipcRenderer.invoke("hitl:respond", {
        id: toolCallId,
        response: { selection, cancelled },
      });
    },
    [toolCallId],
  );

  // Receipt view
  if (result) {
    const raw = result as Record<string, unknown>;
    const cancelled = raw.cancelled === true;
    const selection = raw.selection as OptionListSelection;

    if (cancelled) {
      return (
        <OptionList
          id={toolCallId ?? "unknown"}
          options={allOptions}
          selectionMode={selectionMode}
          choice={null}
        />
      );
    }

    // Check if selection is a custom free-text value
    const isFreeText =
      typeof selection === "string" && !originalOptionIds.has(selection);

    if (isFreeText) {
      return (
        <OptionList
          id={toolCallId ?? "unknown"}
          options={[
            ...originalOptions,
            { id: CUSTOM_OPTION_ID, label: String(selection) },
          ]}
          selectionMode="single"
          choice={CUSTOM_OPTION_ID}
        />
      );
    }

    return (
      <OptionList
        id={toolCallId ?? "unknown"}
        options={allOptions}
        selectionMode={selectionMode}
        minSelections={minSelections}
        maxSelections={args.maxSelections}
        choice={selection}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <OptionList
        id={toolCallId ?? "unknown"}
        options={optionsWithDisabled}
        selectionMode={selectionMode}
        minSelections={minSelections}
        maxSelections={args.maxSelections}
        defaultValue={defaultValue}
        onChange={setCurrentSelection}
        onAction={(actionId: string, selection: OptionListSelection) => {
          if (actionId === "confirm") {
            if (
              selection === CUSTOM_OPTION_ID ||
              (Array.isArray(selection) &&
                selection.includes(CUSTOM_OPTION_ID))
            ) {
              sendResponse(customText.trim(), false);
            } else {
              sendResponse(selection, false);
            }
          } else if (actionId === "cancel") {
            sendResponse(null, true);
          }
        }}
      />
      {isCustomSelected && (
        <div
          className="bg-card w-full max-w-md min-w-80 rounded-2xl border px-4 py-3 shadow-xs"
          data-slot="option-list-custom-input"
        >
          <Textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder={t("optionList.otherPlaceholder")}
            className="max-h-48 min-h-[60px] resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

function QuestionFlowWrapper({
  args,
  toolCallId,
  result,
}: {
  args: {
    prompt: string;
    steps: Array<{
      id: string;
      title: string;
      description?: string;
      options: Array<{
        id: string;
        label: string;
        description?: string;
        disabled?: boolean;
      }>;
      selectionMode?: "single" | "multi";
    }>;
  };
  toolCallId?: string;
  result: unknown;
}) {
  const { t } = useTranslation("common");

  const sendResponse = useCallback(
    (answers: Record<string, string[]>, cancelled: boolean) => {
      window.ipcRenderer.invoke("hitl:respond", {
        id: toolCallId,
        response: { answers, cancelled },
      });
    },
    [toolCallId],
  );

  const [phase, setPhase] = useState<"flow" | "custom-input">("flow");
  const [flowAnswers, setFlowAnswers] = useState<Record<string, string[]>>({});
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});

  // Build per-step sets of original option IDs for free-text detection
  const originalOptionIds = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const step of args.steps) {
      map.set(step.id, new Set(step.options.map((o) => o.id)));
    }
    return map;
  }, [args.steps]);

  // Receipt view
  if (result) {
    const raw = result as Record<string, unknown>;
    const cancelled = raw.cancelled === true;
    const answers = (raw.answers ?? {}) as Record<string, string[]>;

    if (cancelled) {
      const choice: QuestionFlowChoice = {
        title: args.prompt,
        summary: [{ label: t("optionList.cancelled"), value: "—" }],
      };
      return (
        <QuestionFlow id={toolCallId ?? "unknown"} choice={choice} />
      );
    }

    const summary = args.steps.map((step) => {
      const selectedIds = answers[step.id] ?? [];
      const knownIds = originalOptionIds.get(step.id) ?? new Set();

      const optionLabels = step.options
        .filter((opt) => selectedIds.includes(opt.id))
        .map((opt) => opt.label);

      const freeText = selectedIds.filter(
        (id) => !knownIds.has(id) && id.length > 0,
      );

      const allLabels = [...optionLabels, ...freeText];
      return {
        label: step.title,
        value: allLabels.length > 0 ? allLabels.join(", ") : "—",
      };
    });

    const choice: QuestionFlowChoice = {
      title: args.prompt,
      summary,
    };

    return (
      <QuestionFlow id={toolCallId ?? "unknown"} choice={choice} />
    );
  }

  // Phase 1: QuestionFlow with "Other..." appended to each step
  if (phase === "flow") {
    const stepsWithCustom = args.steps.map((step) => ({
      ...step,
      options: [
        ...step.options,
        { id: CUSTOM_OPTION_ID, label: t("optionList.other") },
      ],
    }));

    return (
      <div className="flex flex-col gap-3">
        <QuestionFlow
          id={toolCallId ?? "unknown"}
          steps={stepsWithCustom}
          onComplete={(answers) => {
            const customStepIds = Object.entries(answers)
              .filter(([, ids]) => ids.includes(CUSTOM_OPTION_ID))
              .map(([stepId]) => stepId);

            if (customStepIds.length === 0) {
              sendResponse(answers, false);
            } else {
              setFlowAnswers(answers);
              setPhase("custom-input");
            }
          }}
        />
        <div className="flex justify-start">
          <Button
            variant="ghost"
            size="default"
            onClick={() => sendResponse({}, true)}
            className="gap-1 rounded-full text-muted-foreground"
          >
            {t("optionList.skip")}
          </Button>
        </div>
      </div>
    );
  }

  // Phase 2: Free-text input for steps where "Other..." was selected
  const customSteps = args.steps.filter((step) =>
    (flowAnswers[step.id] ?? []).includes(CUSTOM_OPTION_ID),
  );

  return (
    <div className="flex flex-col gap-3">
      {customSteps.map((step) => (
        <div
          key={step.id}
          className="bg-card w-full max-w-md min-w-80 rounded-2xl border px-4 py-3 shadow-xs"
        >
          <span className="mb-2 block text-sm font-medium">{step.title}</span>
          <Textarea
            value={customTexts[step.id] ?? ""}
            onChange={(e) =>
              setCustomTexts((prev) => ({
                ...prev,
                [step.id]: e.target.value,
              }))
            }
            placeholder={t("optionList.otherPlaceholder")}
            className="max-h-48 min-h-[60px] resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            autoFocus
          />
        </div>
      ))}
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          size="default"
          onClick={() => sendResponse({}, true)}
          className="gap-1 rounded-full text-muted-foreground"
        >
          {t("optionList.skip")}
        </Button>
        <Button
          variant="default"
          size="default"
          onClick={() => {
            const finalAnswers: Record<string, string[]> = {};
            for (const [stepId, ids] of Object.entries(flowAnswers)) {
              finalAnswers[stepId] = ids.map((id) =>
                id === CUSTOM_OPTION_ID ?
                  (customTexts[stepId]?.trim() || CUSTOM_OPTION_ID)
                : id,
              );
            }
            sendResponse(finalAnswers, false);
          }}
          className="rounded-full"
        >
          {t("optionList.submit")}
        </Button>
      </div>
    </div>
  );
}

export const hitlToolkit: Toolkit = {
  // User input tool - renders InputCard with textarea for text feedback
  requestUserInput: {
    type: "backend",
    render: ({ args, result, toolCallId }) => {
      const cardProps = {
        id: toolCallId ?? "unknown",
        question: args.question,
        context: args.context,
        placeholder: args.placeholder,
        buttonLabel: args.buttonLabel ?? "Submit",
      };

      if (result) {
        const raw = result as Record<string, unknown>;
        const answer = typeof raw.answer === "string" ? raw.answer : "";
        const choice =
          answer.length > 0 ? ("submitted" as const) : ("cancelled" as const);
        return (
          <InputCard
            {...cardProps}
            choice={choice}
            answer={answer || undefined}
          />
        );
      }

      return (
        <InputCard
          {...cardProps}
          onSubmit={(answer) => {
            window.ipcRenderer.invoke("hitl:respond", {
              id: toolCallId,
              response: { answer },
            });
          }}
          onCancel={() => {
            window.ipcRenderer.invoke("hitl:respond", {
              id: toolCallId,
              response: { answer: "" },
            });
          }}
        />
      );
    },
  },

  // Human intervention tool - renders ApprovalCard asking user to act in browser
  requestHumanIntervention: {
    type: "backend",
    render: ({ args, result, toolCallId }) => {
      const cardProps = {
        id: toolCallId ?? "unknown",
        title: args.reason,
        description: args.instructions,
        icon: "HandMetal",
        confirmLabel: args.buttonLabel ?? "Done",
        cancelLabel: "Skip",
      };

      if (result) {
        const choice =
          (result as Record<string, unknown>)?.completed === true ?
            ("approved" as const)
          : ("denied" as const);
        return <ApprovalCard {...cardProps} choice={choice} />;
      }

      return (
        <ApprovalCard
          {...cardProps}
          onConfirm={() => {
            window.ipcRenderer.invoke("hitl:respond", {
              id: toolCallId,
              response: {
                completed: true,
                message: "User completed the intervention",
              },
            });
          }}
          onCancel={() => {
            window.ipcRenderer.invoke("hitl:respond", {
              id: toolCallId,
              response: {
                completed: false,
                message: "User skipped the intervention",
              },
            });
          }}
        />
      );
    },
  },

  // Option list tool - renders OptionList for user to select from choices
  requestOptionList: {
    type: "backend",
    render: ({ args, result, toolCallId }) => (
      <OptionListWithCustom
        args={args}
        toolCallId={toolCallId}
        result={result}
      />
    ),
  },

  // Question flow tool - renders multi-step QuestionFlow
  requestQuestionFlow: {
    type: "backend",
    render: ({ args, result, toolCallId }) => (
      <QuestionFlowWrapper
        args={args}
        toolCallId={toolCallId}
        result={result}
      />
    ),
  },
};
