import { type Toolkit } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ApprovalCard } from "@/components/tool-ui/approval-card";
import { InputCard } from "@/components/tool-ui/input-card";
import { OptionList } from "@/components/tool-ui/option-list";
import type { OptionListSelection } from "@/components/tool-ui/option-list";
import { QuestionFlow } from "@/components/tool-ui/question-flow/question-flow";

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

  // Option list tool - renders OptionList (with built-in "Other" + inline textarea)
  requestOptionList: {
    type: "backend",
    render: ({ args, result, toolCallId }) => {
      const id = toolCallId ?? "unknown";
      const selectionMode = args.selectionMode ?? "single";
      const minSelections = args.minSelections ?? 1;

      if (result) {
        const raw = result as Record<string, unknown>;
        const cancelled = raw.cancelled === true;
        const selection = raw.selection as OptionListSelection;

        return (
          <OptionList
            id={id}
            options={args.options}
            selectionMode={selectionMode}
            minSelections={minSelections}
            maxSelections={args.maxSelections}
            choice={cancelled ? null : selection}
          />
        );
      }

      return (
        <OptionList
          id={id}
          options={args.options}
          selectionMode={selectionMode}
          minSelections={minSelections}
          maxSelections={args.maxSelections}
          defaultValue={args.defaultValue ?? undefined}
          onAction={(actionId: string, selection: OptionListSelection) => {
            window.ipcRenderer.invoke("hitl:respond", {
              id: toolCallId,
              response: {
                selection,
                cancelled: actionId === "cancel",
              },
            });
          }}
        />
      );
    },
  },

  // Question flow tool - renders QuestionFlow (with built-in "Other" + inline textarea)
  requestQuestionFlow: {
    type: "backend",
    render: ({ args, result, toolCallId }) => {
      const { t } = useTranslation("common");
      const id = toolCallId ?? "unknown";

      if (result) {
        const raw = result as Record<string, unknown>;
        const cancelled = raw.cancelled === true;
        const answers = (raw.answers ?? {}) as Record<string, string[]>;

        if (cancelled) {
          return (
            <QuestionFlow
              id={id}
              choice={{
                title: args.prompt,
                summary: [{ label: t("optionList.cancelled"), value: "—" }],
              }}
            />
          );
        }

        const originalOptionIds = new Map<string, Set<string>>(
          args.steps.map((step) => [
            step.id,
            new Set(step.options.map((o: { id: string }) => o.id)),
          ]),
        );

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

        return (
          <QuestionFlow
            id={id}
            choice={{ title: args.prompt, summary }}
          />
        );
      }

      return (
        <div className="flex flex-col gap-3">
          <QuestionFlow
            id={id}
            steps={args.steps}
            onComplete={(answers) => {
              window.ipcRenderer.invoke("hitl:respond", {
                id: toolCallId,
                response: { answers, cancelled: false },
              });
            }}
          />
          <div className="flex justify-start">
            <Button
              variant="ghost"
              size="default"
              onClick={() =>
                window.ipcRenderer.invoke("hitl:respond", {
                  id: toolCallId,
                  response: { answers: {}, cancelled: true },
                })
              }
              className="gap-1 rounded-full text-muted-foreground"
            >
              {t("optionList.skip")}
            </Button>
          </div>
        </div>
      );
    },
  },
};
