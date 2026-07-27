import { type FC, useEffect, useRef, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
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
 * Both modes materialize the thread at the novel step's primary button and jump
 * to the options page instantly, kicking background acquisition WITHOUT
 * awaiting it:
 *   - FILE "Upload & Continue" → /ingest: the backend decodes (iconv) + persists
 *     raw text. The sidebar shows the filename-based title the moment the
 *     request lands (applyConfig emits threads:listChanged / metadataUpdated).
 *   - INTERNET "Fetch & Continue" → /prefetch: applyConfig materializes the
 *     thread + the per-chapter fetcher is kicked AHEAD of rewrite (source rows
 *     land as "fetched" while the user configures options).
 * The options page then locks the thread to its source for BOTH modes: no Back
 * button, no re-pick — the only redo is delete-thread + new-thread ("Start
 * over").
 *
 * Start (last step) finalizes the user's StepOptions choices (/start →
 * upsertEntertainmentConfig) and kicks the pipeline (ensureRange). File gates
 * Start on ingest completion ("Preparing…") — the rewriter needs the decoded
 * raw text, a real data dependency. Internet does NOT gate on fetching: the
 * fetcher and rewriter synchronize only through the DB, so Start can fire the
 * moment the user is done configuring (whatever's prefetched rewrites straight
 * away; the rest fetches + rewrites together).
 */
export const EntertainmentWizard: FC = () => {
  const { t } = useTranslation("entertainment");
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);

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
  // Background acquisition state. `ingesting` is file-only: true between the
  // "Upload & Continue" click and the backend committing raw text (a real data
  // dependency — Start waits on it). Internet fetch needs no such flag: it is
  // DB-mediated and non-blocking. `prepareError` surfaces a failed
  // materialization (file ingest OR internet prefetch) on the options page with
  // a "Start over" reset; it blocks Start for both modes.
  const [ingesting, setIngesting] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  // Tracks the thread this wizard instance is bound to. On a genuine thread
  // switch (New Conversation, sidebar click) the whole local state is wiped and
  // the wizard restarts at step 0 with INITIAL_DEHYDRATE — a brand-new wizard
  // for the brand-new thread, with nothing carried over from the prior thread's
  // in-progress selections. The shared abandon hook ensures switchToNewThread
  // always produces a fresh id (materializing the current "new" thread first if
  // needed), so this effect reliably fires on every abandon.
  const boundThreadId = useRef<string | null>(mainThreadId);
  useEffect(() => {
    if (boundThreadId.current === mainThreadId) return;
    boundThreadId.current = mainThreadId;
    setConfig(INITIAL_DEHYDRATE);
    setPendingFile(undefined);
    setStep(0);
    setSubmitted(false);
    setAgreed(false);
    setSubmitError(null);
    setIngesting(false);
    setPrepareError(null);
  }, [mainThreadId]);

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
    setPrepareError(null);
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
      setPrepareError(t("wizard.error.ingestFailed"));
    } finally {
      setIngesting(false);
    }
  };

  // Fire background internet fetch + advance to the options page WITHOUT
  // awaiting completion — the wizard jumps forward instantly, mirroring file
  // ingest. Unlike file there is NO blocking flag: the fetcher is non-blocking
  // w.r.t. Start (it talks to the rewriter only through the DB), so Start never
  // waits on it. On failure (backend unreachable / rejected config) the thread
  // failed to materialize — surface an error + "Start over".
  const prefetchAndAdvance = async () => {
    if (!mainThreadId) return;
    setPrepareError(null);
    // Advance immediately — the options page is usable while the crawl runs.
    setStep(STEPS - 1);
    try {
      await useChaptersStore.getState().prefetchInternet(mainThreadId, config);
    } catch {
      setPrepareError(t("wizard.error.fetchFailed"));
    }
  };

  const submit = async () => {
    if (submitted || !mainThreadId) return;
    // Never start if materialization hasn't landed (or failed). Belt-and-
    // suspenders — Start is disabled in the UI while ingesting (file) or on a
    // prepare error (either mode). Internet fetching never blocks: it is
    // DB-mediated and runs concurrently with rewrite.
    if (prepareError || (isFile && ingesting)) return;
    setSubmitError(null);
    // Keep sessionId aligned with the active thread (mirrors the old start form).
    useUiStore.getState().setSessionId(mainThreadId);
    const store = useChaptersStore.getState();
    try {
      // Finalize the user's StepOptions choices + kick the pipeline in one go.
      // File: raw text was ingested at the novel step → runDehydrate. Internet:
      // source rows were prefetched at the novel step → processChapter skips the
      // fetch and rewrites (whatever isn't prefetched yet fetches + rewrites).
      await store.startRewrite(mainThreadId, config);
      // Load novelType (+ whatever chapters exist) so canGoNext + the reader work.
      await store.loadChapters(mainThreadId);
      store.setCurrentChapter(1);
      void store.setPosition(mainThreadId, 1);
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
    // Step 1 → 2: both modes advance instantly and kick background acquisition
    // before either awaits — file decodes + persists raw text, internet kicks
    // the per-chapter fetcher ahead of rewrite.
    if (step === 1 && isFile) {
      void ingestAndAdvance();
      return;
    }
    if (step === 1 && !isFile) {
      void prefetchAndAdvance();
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

  // The only redo path once a thread's source has been locked in (file "Upload &
  // Continue" or internet "Fetch & Continue"): stop any in-flight work, DELETE
  // the abandoned thread (purge its config + rawText/source rows from the DB and
  // remove it from the sidebar), then reset the wizard to step 0. The current
  // thread is the "new" thread, so there's no thread to switch away from — just
  // wipe local state in place.
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
    setConfig(INITIAL_DEHYDRATE);
    setPendingFile(undefined);
    setStep(0);
    setSubmitted(false);
    setAgreed(false);
    setSubmitError(null);
    setIngesting(false);
    setPrepareError(null);
  };

  const valid = isStepValid(step, config);

  // The options page locks the thread to its source (uploaded file OR prefetched
  // internet source) — no Back, for EITHER mode. Step 0↔1 still allows Back
  // (nothing is materialized yet there).
  const canGoBack = step > 0 && step < STEPS - 1;

  // The primary button: step 1 reads "Upload & Continue" (file) or "Fetch &
  // Continue" (internet) — both kick background acquisition; the last step reads
  // "Start". Start is blocked while file ingest is mid-decode (a real data
  // dependency) or on a prepare error (either mode); internet fetching never
  // blocks it (DB-mediated, non-blocking).
  const isUploadButton = step === 1 && isFile;
  const isFetchButton = step === 1 && !isFile;
  const startBlocked =
    isLast && (prepareError !== null || (isFile && ingesting));

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

      {prepareError && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-center text-sm text-destructive">{prepareError}</p>
          <Button type="button" variant="outline" onClick={() => void startOver()}>
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
          disabled={!valid || submitted || !agreed || startBlocked}
          className="self-start"
        >
          {isUploadButton && t("nav.uploadAndContinue")}
          {isFetchButton && t("nav.fetchAndContinue")}
          {isLast && (ingesting ? t("nav.preparing") : t("nav.start"))}
          {!isUploadButton && !isFetchButton && !isLast && t("nav.next")}
          {ingesting && <Loader2 className="size-4 animate-spin" />}
          {!isLast &&
            !isUploadButton &&
            !isFetchButton &&
            !ingesting && <ArrowRight className="size-4" />}
        </Button>
      </div>
    </div>
  );
};
