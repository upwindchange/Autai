import { type FC, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { httpClient } from "@/lib/httpClient";
import { useEntertainmentThreadsStore } from "@/stores/entertainmentThreadsStore";
import { useChaptersStore } from "@/stores/chaptersStore";
import { toFileTransfer } from "@/lib/fileTransfer";
import type { EntertainmentConfig } from "@shared";
import { INITIAL_DEHYDRATE, isStepValid } from "./wizardSteps";
import { ProgressBar } from "./ProgressBar";
import { StepMode } from "./steps/StepMode";
import { StepNovel } from "./steps/StepNovel";
import { StepOptions } from "./steps/StepOptions";

const STEPS = 3;

/** Entertainment wizard — 3 steps (mode → novel → options), shown on an empty thread. */
export const EntertainmentWizard: FC = () => {
  const { t } = useTranslation("entertainment");
  const activeThreadId = useEntertainmentThreadsStore((s) => s.activeThreadId);
  const setActiveThreadId = useEntertainmentThreadsStore(
    (s) => s.setActiveThreadId,
  );
  const ensureThread = useEntertainmentThreadsStore((s) => s.ensureThread);
  // The step is wizard-local UI state (nothing outside the wizard reads it).
  const [step, setStep] = useState(0);

  const [config, setConfig] = useState<EntertainmentConfig>(INITIAL_DEHYDRATE);
  const [pendingFile, setPendingFile] = useState<File | undefined>(undefined);
  const [submitted, setSubmitted] = useState(false);
  // Legal acknowledgment — UI-only (not sent to the backend or persisted). Gates
  // forward navigation to reduce the author's legal exposure.
  const [agreed, setAgreed] = useState(false);
  // Submission error surfaced inline (Start failure, backend unreachable, …).
  // Set on failure; cleared at the start of the next submit attempt.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  // Re-entry latch: ingesting-state guard is racy pre-render; stops a double commit.
  const committingRef = useRef(false);
  // Bound thread: a real thread switch wipes local state; the null→non-null
  // transition (our own commit) is excluded to preserve the chosen config.
  const boundThreadId = useRef<string | null>(activeThreadId);
  useEffect(() => {
    const prev = boundThreadId.current;
    if (prev === activeThreadId) return;
    boundThreadId.current = activeThreadId;
    if (prev === null) return; // our own ensureThread commit — preserve state
    setConfig(INITIAL_DEHYDRATE);
    setPendingFile(undefined);
    setStep(0);
    setSubmitted(false);
    setAgreed(false);
    setSubmitError(null);
    setIngesting(false);
    setPrepareError(null);
  }, [activeThreadId]);

  const isLast = step === STEPS - 1;
  const isFile = config.novel.type === "file";

  const commitAndAdvance = async () => {
    if (committingRef.current) return;
    committingRef.current = true;
    setPrepareError(null);
    try {
      const id = await ensureThread();
      setStep(STEPS - 1); // advance AFTER the id exists — real thread by stepOptions
      if (config.novel.type !== "file") {
        // Internet "Fetch & Continue": persist config + start fetching source
        // chapters (no rewrite). Async — the wizard advances to options now.
        await useChaptersStore.getState().prefetchInternet(id, config);
        return;
      }
      setIngesting(true);
      try {
        const transfer = await toFileTransfer({
          fsPath: config.novel.fsPath,
          file: pendingFile,
        });
        await useChaptersStore.getState().ingestFile(id, config, transfer);
      } catch {
        // Empty file / decode failure / backend unreachable. The thread is now
        // locked to a bad source — only reset is delete + new thread.
        setPrepareError(t("wizard.error.ingestFailed"));
      } finally {
        setIngesting(false);
      }
    } catch {
      // ensureThread (POST /threads) failed — backend unreachable.
      setPrepareError(t("wizard.error.failed"));
    } finally {
      committingRef.current = false;
    }
  };

  const submit = async () => {
    if (submitted || !activeThreadId) return;
    // Never start if materialization hasn't landed (or failed). Belt-and-
    // suspenders — Start is disabled in the UI while ingesting (file) or on a
    // prepare error (either mode).
    if (prepareError || (isFile && ingesting)) return;
    setSubmitError(null);
    const store = useChaptersStore.getState();
    try {
      // Load novelType (+ whatever chapters exist) so canGoNext + the reader work.
      await store.loadChapters(activeThreadId);
      store.setCurrentChapter(1);
      void store.setPosition(activeThreadId, 1);
      // Internet threads start fetch+rewrite here (file threads already
      // started at /ingest). Use the wizard's own config.novel.type — store.novelType
      // is only populated after loadChapters resolves (race-free here).
      if (config.novel.type === "internet" && activeThreadId) {
        await store.startInternet(activeThreadId, config);
      }
      setSubmitted(true);
    } catch {
      // httpClient throws a status-only Error (no backend message), so a single
      // generic retry prompt is the best we can surface here.
      setSubmitError(t("wizard.error.failed"));
    }
  };

  const advance = () => {
    if (!isStepValid(step, config) || submitted) return;
    if (isLast) {
      void submit();
      return;
    }
    // Step 1 → 2: waits for agreement, then commits (creates thread + ingests file).
    if (step === 1) {
      if (!agreed) return;
      void commitAndAdvance();
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS - 1));
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
      // Title/author inputs: Enter = advance, EXCEPT for inputs marked
      // `data-no-enter-advance` (e.g. the target-language field on the options
      // step), where Enter should be a no-op (or native) instead of starting
      // the job mid-edit.
      if (target instanceof HTMLInputElement) {
        if (target.closest("[data-no-enter-advance]")) return;
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

  // Redo path: reset the wizard + best-effort delete the thread. Clear the
  // active id BEFORE the DELETE so the listChanged SSE doesn't hijack it.
  const startOver = async () => {
    const id = activeThreadId;
    if (id) setActiveThreadId(null);
    setConfig(INITIAL_DEHYDRATE);
    setPendingFile(undefined);
    setStep(0);
    setSubmitted(false);
    setAgreed(false);
    setSubmitError(null);
    setIngesting(false);
    setPrepareError(null);
    if (id) {
      try {
        await httpClient.delete(`/threads/${id}`);
      } catch {
        // Best-effort: the row may linger in the sidebar, but the wizard is
        // reset and usable. The user can delete it manually.
      }
    }
  };

  const valid = isStepValid(step, config);

  // The options page locks the thread to its source (uploaded file OR internet
  // source) — no Back, for EITHER mode. Step 0↔1 still allows Back (nothing is
  // materialized yet there).
  const canGoBack = step > 0 && step < STEPS - 1;

  const isUploadButton = step === 1 && isFile;
  const isFetchButton = step === 1 && !isFile;
  const startBlocked =
    isLast && (prepareError !== null || (isFile && ingesting));
  // Agreement is acknowledged on the novel step (step 1). It blocks the novel
  // step's commit and — as belt-and-suspenders — the final Start; step 0's Next
  // is always free.
  const agreeBlocked = step >= 1 && !agreed;

  return (
    <div className="my-auto mx-auto flex w-full flex-col gap-4 px-4 pb-10 sm:max-w-2xl sm:gap-6 lg:max-w-5xl xl:max-w-7xl 2xl:max-w-[96rem]">
      <div className="flex flex-col gap-1 xl:max-w-5xl">
        <h1 className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-2xl duration-200">
          {t("title")}
        </h1>
        <p className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-sm delay-75 duration-200">
          {t("subtitle")}
        </p>
      </div>

      {/* The stepper spans the full wizard width (it's a graphical track, not
          prose) so it stays consistent with the step body below instead of
          floating as a narrow strip over wide content. */}
      <ProgressBar
        step={step}
        labels={[t("step.0.title"), t("step.1.title"), t("step.2.title")]}
      />

      {step === 0 && <StepMode config={config} setConfig={setConfig} />}
      {step === 1 && (
        <StepNovel
          config={config}
          setConfig={setConfig}
          setPendingFile={setPendingFile}
          agreed={agreed}
          setAgreed={setAgreed}
        />
      )}
      {step === 2 && <StepOptions config={config} setConfig={setConfig} />}

      {prepareError && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-center text-sm text-destructive">{prepareError}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void startOver()}
          >
            {t("wizard.action.startOver")}
          </Button>
        </div>
      )}

      {submitError && !prepareError && (
        <p className="text-center text-sm text-destructive">{submitError}</p>
      )}

      <div className="flex items-center gap-2">
        {canGoBack && (
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
          disabled={!valid || submitted || agreeBlocked || startBlocked}
          className="self-start"
        >
          {isUploadButton && t("nav.uploadAndContinue")}
          {isFetchButton && t("nav.fetchAndContinue")}
          {isLast && (ingesting ? t("nav.preparing") : t("nav.start"))}
          {!isUploadButton && !isFetchButton && !isLast && t("nav.next")}
          {ingesting && <Loader2 className="size-4 animate-spin" />}
          {!isLast && !isUploadButton && !isFetchButton && !ingesting && (
            <ArrowRight className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
};
