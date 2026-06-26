import { type FC, useEffect, useRef, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/uiStore";
import { useChaptersStore } from "@/stores/chaptersStore";
import type { EntertainmentConfig } from "@shared";
import { INITIAL_DEHYDRATE, isStepValid } from "./wizardSteps";
import { ProgressBar } from "./ProgressBar";
import { StepMode } from "./steps/StepMode";
import { StepNovel } from "./steps/StepNovel";
import { StepOptions } from "./steps/StepOptions";

const STEPS = 3;

/**
 * Entertainment wizard — the only "composer" surface in this mode, shown on an
 * empty thread. Three steps (mode → novel → options), advanced by the Next
 * button or Enter (in text inputs / the source textarea). On the final step the
 * action becomes Start, which POSTs the full `EntertainmentConfig` to the
 * dehydrate chapter endpoint (POST /entertainment/threads/:id/chapters) via the
 * chapters store. The stub worker then writes chapter 1 to the DB and fires
 * `entertainment:chapterReady`; the store picks it up and the reader renders it
 * from disk.
 */
export const EntertainmentWizard: FC = () => {
  const { t } = useTranslation("entertainment");
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);

  const [config, setConfig] = useState<EntertainmentConfig>(INITIAL_DEHYDRATE);
  const [pendingFile, setPendingFile] = useState<File | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const isLast = step === STEPS - 1;

  const submit = async () => {
    if (submitted || !mainThreadId) return;
    // Keep sessionId aligned with the active thread (mirrors the old start form).
    useUiStore.getState().setSessionId(mainThreadId);
    // For a file novel, read its text (UTF-8) and send it inline so the worker
    // can parse chapters and ingest them. (GBK/charset detection is a follow-up.)
    const novelText =
      config.novel.type === "file" && pendingFile ?
        await pendingFile.text()
      : undefined;
    await useChaptersStore
      .getState()
      .startDehydrate(mainThreadId, config, novelText);
    setSubmitted(true);
  };

  const advance = () => {
    if (!isStepValid(step, config) || submitted) return;
    if (isLast) {
      void submit();
    } else {
      setStep((s) => Math.min(s + 1, STEPS - 1));
    }
  };

  // Keep the latest advance() in a ref so the keydown listener (bound once)
  // always calls the current closure.
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      // Source textarea: Shift+Enter = newline; plain Enter = advance.
      if (target instanceof HTMLTextAreaElement) {
        if (e.shiftKey) return;
        e.preventDefault();
        void advanceRef.current();
        return;
      }
      // Title/author inputs: Enter = advance.
      if (target instanceof HTMLInputElement) {
        e.preventDefault();
        void advanceRef.current();
        return;
      }
      // Buttons (radios / checkboxes / nav) keep native behavior — the Next
      // button advances via its own onClick, so we don't double-trigger here.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const valid = isStepValid(step, config);

  return (
    <div className="my-auto mx-auto flex w-full max-w-(--reading-max-width) flex-col gap-6 px-4 pb-10">
      <div className="flex flex-col gap-1">
        <h1 className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-2xl duration-200">
          {t("title")}
        </h1>
        <p className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-sm delay-75 duration-200">
          {t("subtitle")}
        </p>
      </div>

      <ProgressBar
        step={step}
        labels={[
          t("step.0.title"),
          t("step.1.title"),
          t("step.2.title"),
        ]}
      />

      <div className="flex flex-col gap-4">
        {step === 0 && (
          <StepMode config={config} setConfig={setConfig} />
        )}
        {step === 1 && (
          <StepNovel
            config={config}
            setConfig={setConfig}
            pendingFile={pendingFile}
            setPendingFile={setPendingFile}
          />
        )}
        {step === 2 && <StepOptions config={config} setConfig={setConfig} />}
      </div>

      <div className="flex items-center gap-2">
        {step > 0 && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={submitted}
          >
            <ChevronLeft className="size-4" />
            {t("nav.back")}
          </Button>
        )}
        <Button
          type="button"
          onClick={advance}
          disabled={!valid || submitted}
          className="self-start"
        >
          {isLast ?
            t("nav.start")
          : t("nav.next")}
          {!isLast && <ArrowRight className="size-4" />}
        </Button>
      </div>
    </div>
  );
};
