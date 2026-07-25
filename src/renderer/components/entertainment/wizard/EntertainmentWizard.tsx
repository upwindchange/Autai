import { type FC, useEffect, useRef, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { httpClient } from "@/lib/httpClient";
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
 * empty thread. Three steps (mode → novel → options), advanced by the Next/
 * Upload button or Enter (in text inputs / the source textarea).
 *
 * FILE novels are ingested at the novel step's "Upload & Continue": the backend
 * decodes (iconv) + persists raw text in the background while the wizard jumps
 * to the options page instantly. The sidebar shows the filename-based title the
 * moment the request lands (applyConfig emits `threads:metadataUpdated`). The
 * Start button stays disabled ("Preparing…") until that ingest promise
 * resolves — guaranteeing raw text is in the DB before Start kicks the dehydrate
 * loop (via ensureWorker → ensureRange). Once uploaded the thread is locked to
 * that file: no Back button on the options page, no re-pick — the only redo is
 * delete-thread + new-thread ("Start over").
 *
 * INTERNET novels keep the old path: config is saved at Start (`setupInternet`),
 * acquisition starts when the reader opens chapter 1.
 */
export const EntertainmentWizard: FC = () => {
  const { t } = useTranslation("entertainment");
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const aui = useAui();

  const [config, setConfig] = useState<EntertainmentConfig>(INITIAL_DEHYDRATE);
  const [pendingFile, setPendingFile] = useState<File | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  // Legal acknowledgment — UI-only (not sent to the backend or persisted). Gates
  // forward navigation to reduce the author's legal exposure.
  const [agreed, setAgreed] = useState(false);
  // Submission error surfaced inline (Start failure, backend unreachable, …).
  // Set on failure; cleared at the start of the next submit attempt.
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Background file ingest state. `ingesting` is true between the "Upload &
  // Continue" click and the backend committing raw text; Start is disabled
  // while this is true. `ingestError` surfaces a failed/empty-file ingest on
  // the options page with a "Start over" reset.
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const isLast = step === STEPS - 1;
  const isFile = config.novel.type === "file";

  // Fire background file ingestion and advance to the options page WITHOUT
  // awaiting — the wizard jumps forward instantly. The Start button gates on
  // `ingesting` so the dehydrate loop can't be kicked before raw text exists.
  // On failure, surfaces an error + "Start over" on the options page.
  const ingestAndAdvance = async () => {
    if (!mainThreadId || ingesting) return;
    // Only ever called when isFile (guarded in advance()), but TS can't carry
    // the union narrowing into this closure — narrow explicitly.
    if (config.novel.type !== "file") return;
    setIngestError(null);
    setIngesting(true);
    // Advance immediately — the options page is usable while decode runs.
    setStep(STEPS - 1);
    try {
      const transfer = await toFileTransfer({
        fsPath: config.novel.fsPath,
        file: pendingFile,
      });
      await useChaptersStore.getState().ingestFile(
        mainThreadId,
        config,
        transfer,
      );
    } catch {
      // Empty file / decode failure / backend unreachable. The thread is now
      // locked to a bad source — only reset is delete + new thread.
      setIngestError(t("wizard.error.ingestFailed"));
    } finally {
      setIngesting(false);
    }
  };

  const submit = async () => {
    if (submitted || !mainThreadId) return;
    // File: never start if ingestion hasn't finished (or failed). The guard is
    // belt-and-suspenders — Start is disabled in the UI during ingest too.
    if (isFile && (ingesting || ingestError)) return;
    setSubmitError(null);
    // Keep sessionId aligned with the active thread (mirrors the old start form).
    useUiStore.getState().setSessionId(mainThreadId);
    const store = useChaptersStore.getState();
    try {
      // File raw text is already in the DB (ingested at the novel step). For
      // internet, save config now; acquisition starts when the reader polls ch1.
      if (!isFile) {
        await store.setupInternet(mainThreadId, config);
      }
      // Load novelType (+ all chapters for file) so canGoNext + the reader work.
      await store.loadChapters(mainThreadId);
      store.setCurrentChapter(1);
      void store.setPosition(mainThreadId, 1);
      // ensureWorker → ensureRange kicks runDehydrate for file threads (raw text
      // is guaranteed present since Start was gated on ingest completion).
      void store.ensureWorker(mainThreadId, 1);
      setSubmitted(true);
    } catch {
      // httpClient throws a status-only Error (no backend message), so a single
      // generic retry prompt is the best we can surface here.
      setSubmitError(t("wizard.error.failed"));
    }
  };

  const advance = () => {
    if (!isStepValid(step, config) || submitted || !agreed) return;
    if (isLast) {
      void submit();
      return;
    }
    // Step 1 → 2: file novels trigger background ingest + advance instantly;
    // internet novels advance plainly (their work happens at Start).
    if (step === 1 && isFile) {
      void ingestAndAdvance();
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

  // Delete the current (bad/abandoned) thread + switch to a fresh one so the
  // wizard shows again. Mirrors the reader's Stop button flow. The only redo
  // path for a file thread once "Upload & Continue" has been clicked.
  const startOver = async () => {
    if (!mainThreadId) return;
    try {
      await httpClient.postJSON(`/entertainment/threads/${mainThreadId}/stop`);
    } catch {
      // Best-effort stop; proceed to delete regardless.
    }
    try {
      await httpClient.delete(`/threads/${mainThreadId}`);
    } catch {
      // If delete fails the user is stuck — surface a generic error.
      setSubmitError(t("wizard.error.failed"));
      return;
    }
    // Reset local wizard state for the fresh thread.
    setConfig(INITIAL_DEHYDRATE);
    setPendingFile(undefined);
    setStep(0);
    setSubmitted(false);
    setAgreed(false);
    setSubmitError(null);
    setIngesting(false);
    setIngestError(null);
    await aui.threads().switchToNewThread();
  };

  const valid = isStepValid(step, config);

  // File thread on the options page is locked to its uploaded source — no Back.
  // Internet + step 0/1 keep Back as before.
  const canGoBack = step > 0 && !(step === STEPS - 1 && isFile);

  // The primary button: on step 1 file mode it's "Upload & Continue" (triggers
  // ingest); on the last step it's "Start" (gated on ingest for file); else Next.
  const isUploadButton = step === 1 && isFile;
  const startBlocked = isLast && isFile && ingesting;

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

      {step === 0 && (
        <StepMode
          config={config}
          setConfig={setConfig}
          agreed={agreed}
          setAgreed={setAgreed}
        />
      )}
      {step === 1 && (
        <StepNovel
          config={config}
          setConfig={setConfig}
          setPendingFile={setPendingFile}
        />
      )}
      {step === 2 && <StepOptions config={config} setConfig={setConfig} />}

      {ingestError && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-center text-sm text-destructive">{ingestError}</p>
          <Button type="button" variant="outline" onClick={() => void startOver()}>
            {t("wizard.action.startOver")}
          </Button>
        </div>
      )}

      {submitError && !ingestError && (
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
          disabled={!valid || submitted || !agreed || startBlocked}
          className="self-start"
        >
          {isUploadButton && t("nav.uploadAndContinue")}
          {isLast && (ingesting ? t("nav.preparing") : t("nav.start"))}
          {!isUploadButton && !isLast && t("nav.next")}
          {ingesting && <Loader2 className="size-4 animate-spin" />}
          {!isLast && !isUploadButton && !ingesting && (
            <ArrowRight className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
};
