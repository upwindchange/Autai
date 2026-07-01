import { type FC, useEffect, useRef, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/uiStore";
import { useChaptersStore } from "@/stores/chaptersStore";
import { toFileTransfer } from "@/lib/fileTransfer";
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
 * action becomes Start, which uploads the file (the backend detects encoding +
 * ingests chapters) or saves the internet config via the chapters store, then
 * opens chapter 1. The dehydrate scheduler rewrites chapters (current + 10) in
 * the background; the reader polls each chapter until it's ready.
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
    const store = useChaptersStore.getState();
    // File: send fsPath (or base64) so the BACKEND detects encoding + ingests.
    // Internet: just save config; acquisition starts when the reader polls ch1.
    if (config.novel.type === "file") {
      if (!pendingFile) return;
      const transfer = await toFileTransfer({
        fsPath: config.novel.fsPath,
        file: pendingFile,
      });
      await store.uploadFile(mainThreadId, config, transfer);
    } else {
      await store.setupInternet(mainThreadId, config);
    }
    // Load novelType (+ all chapters for file) so canGoNext + the reader work.
    await store.loadChapters(mainThreadId);
    store.setCurrentChapter(1);
    void store.setPosition(mainThreadId, 1);
    void store.ensureWorker(mainThreadId, 1);
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
      // Textareas: Shift+Enter = newline everywhere. Plain Enter = advance,
      // EXCEPT for boxes marked `data-no-enter-advance` (e.g. the free-form
      // custom-instruction box on the final step), where plain Enter should
      // insert a newline rather than start the job mid-thought.
      if (target instanceof HTMLTextAreaElement) {
        if (e.shiftKey) return;
        if (target.closest("[data-no-enter-advance]")) return;
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
    <div className="my-auto mx-auto flex w-full flex-col gap-4 px-4 pb-10 sm:max-w-2xl sm:gap-6">
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
        labels={[t("step.0.title"), t("step.1.title"), t("step.2.title")]}
      />

      {step === 0 && <StepMode config={config} setConfig={setConfig} />}
      {step === 1 && (
        <StepNovel
          config={config}
          setConfig={setConfig}
          pendingFile={pendingFile}
          setPendingFile={setPendingFile}
        />
      )}
      {step === 2 && <StepOptions config={config} setConfig={setConfig} />}

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
          {isLast ? t("nav.start") : t("nav.next")}
          {!isLast && <ArrowRight className="size-4" />}
        </Button>
      </div>
    </div>
  );
};
