"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Presentation as PresentationIcon } from "lucide-react";
import { useSignInPrompt } from "@/components/auth/SignInPromptProvider";
import { EASE_OUT } from "@/components/motion/presets";
import { motionIndex } from "@/components/motion/stagger";
import { MotionNotice } from "@/components/motion/MotionNotice";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createPresentationAction,
  updatePresentationModelAction,
} from "@/lib/data/presentationActions";
import { previewDocumentAction } from "@/lib/data/documentActions";
import {
  PRESENTATION_MODEL_UNREACHABLE_ERROR,
  PRESENTATION_SAVE_ERROR,
} from "@/lib/data/presentationErrors";
import {
  isPresentationInFlight,
  PRESENTATION_MAX_SOURCES,
  type PresentationItem,
} from "@/lib/data/presentationValues";
import type { PresentationModels } from "@/lib/integrations/presenton";
import { GenerateHero } from "./GenerateHero";
import {
  GetStartedTemplates,
  type WorkspaceTemplate,
} from "./GetStartedTemplates";

export type { WorkspaceTemplate };

/** The documents hub's refresh policy while work is in flight (18.x). */
const POLL_MS = 4_000;

type PresentationWorkspaceProps = {
  guest: boolean;
  /** `PRESENTON_URL` is set in this environment (GATE 1 posture). */
  configured: boolean;
  /** The most recent request, whatever its state. */
  initialPresentation: PresentationItem | null;
  /** Presenton's built-in templates for the picker (empty → General only). */
  templates: WorkspaceTemplate[];
  /** The template read threw: the split shows its honest unavailable note. */
  templatesFailed: boolean;
  /** The T1 model listing; the T3 control switches it where the engine grants it. */
  models: PresentationModels;
  /** The caller's PDF/DOCX documents that can be used as source material. */
  sourceDocuments: { id: string; name: string }[];
  /** Phase-2 editor link for the latest presentation, when it exists. */
  editHref: string | null;
  /** Native viewer link (B4) for the latest presentation, when it exists. */
  viewerHref: string | null;
};

/**
 * The presentation generator's client surface (Task 31.x; reshaped by the
 * generate redesign T2, spec §5.1).
 *
 * This container owns all of the form's state and handlers, exactly as before:
 * the request draft (`prompt`/`template`/`nSlides`/`format`/`sourceIds` and the
 * advanced options), the submit through `createPresentationAction`, the
 * download through `previewDocumentAction`, the `?template=` preselect, and
 * the bounded `router.refresh()` poll while a request is in flight. It renders
 * three route-private pieces:
 *
 * - `GenerateHero` — the centered hero that replaces `PageHeader` on this
 *   route (one `<h1>`, entrance slot 0) and the prompt card with its real
 *   option controls (slot 1, `data-enter="scale"`), including the model
 *   control (`ModelControl`, T2/T3) whose state/handler this container owns;
 * - the existing `RunPanel` (all four states and copy unchanged), centered
 *   directly after the hero at entrance slot 2;
 * - `GetStartedTemplates` — the Get-started/Templates split, a
 *   `MotionRevealGroup` whose two cards are `MotionRevealItem
 *   variant="scale"` members; its entry points reach the hero's prompt,
 *   Sources panel and Template picker through the handles below.
 *
 * There is no fake deck: in an environment without a configured Presenton
 * service the page renders the honest blocked state and the form never
 * appears. `DecksList` stays the page's final section, outside this component.
 */
export function PresentationWorkspace({
  guest,
  configured,
  initialPresentation,
  templates,
  templatesFailed,
  models,
  sourceDocuments,
  editHref,
  viewerHref,
}: PresentationWorkspaceProps) {
  const { requireAuth } = useSignInPrompt();
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;
  /** The hero's prompt box, for the split's "Describe your deck" entry point. */
  const promptRef = useRef<HTMLTextAreaElement>(null);

  /* E2 — "Use this template" lands on `?template=<id>`. This repo's tool hubs
     read query-driven client state with `useSearchParams()` in the client
     surface (TasksWorkspace, DocumentsHub, CalendarWorkspace), so the same
     pattern is used here rather than threading `searchParams` through the
     server page. The preselect only applies when the id is one of the loaded
     template options — a stale or unknown id falls back to the default picker
     value and says so below instead of rendering a lying control. */
  const searchParams = useSearchParams();
  const requestedTemplate = searchParams.get("template");
  const preselectedTemplate =
    requestedTemplate !== null &&
    templates.some((item) => item.id === requestedTemplate)
      ? requestedTemplate
      : null;
  const templateMissing =
    requestedTemplate !== null && preselectedTemplate === null;

  const [prompt, setPrompt] = useState("");
  const [template, setTemplate] = useState(
    preselectedTemplate ?? templates[0]?.id ?? "general",
  );
  const [nSlides, setNSlides] = useState("auto");
  const [format, setFormat] = useState("pptx");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [language, setLanguage] = useState("Auto");
  const [tone, setTone] = useState("default");
  const [verbosity, setVerbosity] = useState("standard");
  const [instructions, setInstructions] = useState("");
  const [includeTableOfContents, setIncludeTableOfContents] = useState(false);
  const [includeTitleSlide, setIncludeTitleSlide] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  /* T3 — the model switch's own state. The control's value is never local:
     it renders `models.current` from the server props throughout, so an apply
     can only ever move it by re-reading the server (no phantom selection). */
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelApplying, setModelApplying] = useState(false);

  const presentation = initialPresentation;
  const inFlight = presentation
    ? isPresentationInFlight(presentation.statusValue)
    : false;
  /** At the cap, unselected source rows go disabled — checked ones stay live. */
  const atSourceCap = sourceIds.length >= PRESENTATION_MAX_SOURCES;

  useEffect(() => {
    if (guest || !inFlight) return;
    const timer = window.setInterval(() => router.refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [guest, inFlight, router]);

  function toggleSource(id: string) {
    setSourceIds((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      if (current.length >= PRESENTATION_MAX_SOURCES) return current;
      return [...current, id];
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requireAuth("Sign in to generate presentations.")) return;

    setError(null);
    setDownloadError(null);
    setSubmitting(true);

    const trimmedInstructions = instructions.trim();

    let result: Awaited<ReturnType<typeof createPresentationAction>>;
    try {
      result = await createPresentationAction({
        prompt,
        template,
        nSlides: nSlides === "auto" ? null : Number(nSlides),
        format,
        language: language === "Auto" ? null : language,
        instructions: trimmedInstructions === "" ? null : trimmedInstructions,
        tone,
        verbosity,
        includeTableOfContents,
        includeTitleSlide,
        sourceDocumentIds: sourceIds,
      });
    } catch {
      result = { error: PRESENTATION_SAVE_ERROR, presentationId: null };
    }

    setSubmitting(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    // The action's revalidate already re-rendered this page with the new
    // request; the poll above takes over while it is in flight.
  }

  /**
   * T3 — one model selection, through the Server Action. This is deliberately
   * not coupled to `onSubmit`: selecting a model changes the deployment's
   * presentation service immediately (the action's own write), and a later
   * Generate never performs an admin write. The handler keeps no optimistic
   * value — the `Select` reads `models.current` from the refreshed props — so
   * a failure leaves the control on the server value and shows the sanitized
   * line; a success re-reads the page (the action's `revalidatePath` plus this
   * refresh) so the control shows what the engine actually stored.
   */
  async function onModelChange(value: string) {
    if (!requireAuth("Sign in to change the presentation model.")) return;

    setModelError(null);
    setModelApplying(true);

    let result: Awaited<ReturnType<typeof updatePresentationModelAction>>;
    try {
      result = await updatePresentationModelAction(value);
    } catch {
      result = { error: PRESENTATION_MODEL_UNREACHABLE_ERROR, model: null };
    }

    setModelApplying(false);
    if (result.error !== null) {
      setModelError(result.error);
      return;
    }
    router.refresh();
  }

  async function onDownload(documentId: string) {
    setDownloadError(null);
    let result: Awaited<ReturnType<typeof previewDocumentAction>>;
    try {
      result = await previewDocumentAction(documentId);
    } catch {
      result = { error: PRESENTATION_SAVE_ERROR, preview: null };
    }
    if (result.error !== null || result.preview === null) {
      setDownloadError(result.error ?? PRESENTATION_SAVE_ERROR);
      return;
    }
    window.open(result.preview.url, "_blank", "noopener,noreferrer");
  }

  if (!configured) {
    return (
      <div data-enter="scale" style={motionIndex(1)}>
        <Card className="bg-glass p-6 backdrop-blur-md md:p-8">
          <EmptyState
            icon={<PresentationIcon aria-hidden="true" className="size-6" />}
            title="Presentation generation isn't connected yet"
            description="UniPilot generates decks with a self-hosted Presenton service. This environment doesn't have one connected, so no deck is generated here — and none is faked."
          />
        </Card>
      </div>
    );
  }

  return (
    <>
      <GenerateHero
        guest={guest}
        models={models}
        modelError={modelError}
        modelApplying={modelApplying}
        onModelChange={onModelChange}
        templates={templates}
        sourceDocuments={sourceDocuments}
        prompt={prompt}
        onPromptChange={setPrompt}
        promptRef={promptRef}
        template={template}
        onTemplateChange={setTemplate}
        templateMissing={templateMissing}
        nSlides={nSlides}
        onSlidesChange={setNSlides}
        format={format}
        onFormatChange={setFormat}
        sourceIds={sourceIds}
        onToggleSource={toggleSource}
        atSourceCap={atSourceCap}
        sourcesOpen={sourcesOpen}
        onSourcesOpenChange={setSourcesOpen}
        advancedOpen={advancedOpen}
        onAdvancedOpenChange={setAdvancedOpen}
        language={language}
        onLanguageChange={setLanguage}
        tone={tone}
        onToneChange={setTone}
        verbosity={verbosity}
        onVerbosityChange={setVerbosity}
        instructions={instructions}
        onInstructionsChange={setInstructions}
        includeTableOfContents={includeTableOfContents}
        onToggleTableOfContents={() =>
          setIncludeTableOfContents((on) => !on)
        }
        includeTitleSlide={includeTitleSlide}
        onToggleTitleSlide={() => setIncludeTitleSlide((on) => !on)}
        submitting={submitting}
        error={error}
        onSubmit={onSubmit}
      />

      <div
        data-enter="scale"
        style={motionIndex(2)}
        className="mx-auto w-full max-w-3xl"
      >
        <RunPanel
          guest={guest}
          presentation={presentation}
          editHref={editHref}
          viewerHref={viewerHref}
          downloadError={downloadError}
          reduced={reduced}
          onDownload={onDownload}
        />
      </div>

      <GetStartedTemplates
        guest={guest}
        templates={templates}
        templatesFailed={templatesFailed}
        onFocusPrompt={() => promptRef.current?.focus()}
        onOpenSources={() => setSourcesOpen(true)}
        onSelectTemplate={setTemplate}
      />
    </>
  );
}

function RunPanel({
  guest,
  presentation,
  editHref,
  viewerHref,
  downloadError,
  reduced,
  onDownload,
}: {
  guest: boolean;
  presentation: PresentationItem | null;
  editHref: string | null;
  viewerHref: string | null;
  downloadError: string | null;
  reduced: boolean;
  onDownload: (documentId: string) => void;
}) {
  if (guest) {
    return (
      <Card className="bg-glass p-6 backdrop-blur-md md:p-7">
        <EmptyState
          icon={<PresentationIcon aria-hidden="true" className="size-6" />}
          title="Sign in to keep decks"
          description="Generated presentations are saved to your Documents. Sign in to generate and find them there."
        />
      </Card>
    );
  }

  if (presentation === null) {
    return (
      <Card className="bg-glass p-6 backdrop-blur-md md:p-7">
        <EmptyState
          icon={<PresentationIcon aria-hidden="true" className="size-6" />}
          title="No decks yet"
          description="Describe a topic and generate — the deck appears here and in Documents when it's ready."
        />
      </Card>
    );
  }

  if (isPresentationInFlight(presentation.statusValue)) {
    const total = presentation.slidesTotal ?? null;
    const done = presentation.slidesDone ?? 0;
    return (
      <Card className="flex flex-col gap-4 bg-glass p-6 backdrop-blur-md md:p-7">
        <header className="flex flex-col gap-1">
          <p className="font-mono text-label-caps uppercase text-muted-foreground">
            In progress
          </p>
          <h2 className="font-heading text-body-lg font-semibold text-foreground">
            {presentation.statusLabel}
          </h2>
          <p className="text-body-md text-muted-foreground">
            {presentation.prompt}
          </p>
        </header>

        {total !== null && total > 0 ? (
          <div
            role="progressbar"
            aria-label="Presentation generation progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Math.min(done, total)}
            aria-valuetext={`${Math.min(done, total)} of ${total} slides`}
            className="h-1.5 w-full overflow-hidden rounded-pill bg-muted"
          >
            <motion.div
              className="h-full origin-left rounded-pill bg-foreground"
              initial={false}
              animate={{ scaleX: Math.min(done / total, 1) }}
              transition={
                reduced ? { duration: 0 } : { duration: 0.4, ease: EASE_OUT }
              }
            />
          </div>
        ) : (
          <div
            role="progressbar"
            aria-label="Presentation generation progress"
            className="h-1.5 w-full overflow-hidden rounded-pill bg-muted"
          >
            <div className="h-full w-1/3 rounded-pill bg-muted-foreground motion-safe:animate-pulse" />
          </div>
        )}

        <p className="text-label-sm text-muted-foreground">
          {total !== null
            ? `${Math.min(done, total)} of ${total} slides · ${presentation.formatLabel}`
            : `Working · ${presentation.formatLabel}`}
        </p>
        {presentation.errorMessage ? (
          <MotionNotice className="text-label-sm text-muted-foreground">
            {presentation.errorMessage}
          </MotionNotice>
        ) : null}
        <p className="text-label-sm text-muted-foreground">
          You can leave this page — the deck will appear in Documents when it&rsquo;s
          ready.
        </p>
      </Card>
    );
  }

  if (presentation.statusValue === "failed") {
    return (
      <Card className="flex flex-col gap-4 bg-glass p-6 backdrop-blur-md md:p-7">
        <header className="flex flex-col gap-1">
          <p className="font-mono text-label-caps uppercase text-muted-foreground">
            Not saved
          </p>
          <h2 className="font-heading text-body-lg font-semibold text-foreground">
            Generation failed
          </h2>
        </header>
        <MotionNotice role="alert" className="text-body-md text-foreground">
          {presentation.errorMessage ??
            "We couldn't generate this deck. Try again."}
        </MotionNotice>
        <p className="text-label-sm text-muted-foreground">
          Adjust the topic or options and generate again.
        </p>
      </Card>
    );
  }

  const document = presentation.document;
  return (
    <MotionRevealGroup>
      <MotionRevealItem variant="scale">
        <Card className="flex flex-col gap-5 bg-glass p-6 backdrop-blur-md md:p-7">
          <header className="flex flex-col gap-1">
            <p className="font-mono text-label-caps uppercase text-muted-foreground">
              Ready
            </p>
            <h2 className="wrap-anywhere font-heading text-body-lg font-semibold text-foreground">
              {document?.name ?? "Your deck"}
            </h2>
            <p className="text-label-sm text-muted-foreground">
              {[presentation.formatLabel, document?.sizeLabel, presentation.createdLabel]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="text-body-md text-muted-foreground">
              {presentation.prompt}
            </p>
          </header>

          {downloadError !== null ? (
            <MotionNotice role="alert" className="text-label-sm text-destructive">
              {downloadError}
            </MotionNotice>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {document ? (
              <Button onClick={() => onDownload(document.id)}>Download</Button>
            ) : null}
            {viewerHref !== null ? (
              <ButtonLink href={viewerHref}>View deck</ButtonLink>
            ) : null}
            {editHref !== null ? (
              <ButtonLink href={editHref} variant="outline">
                Edit deck
              </ButtonLink>
            ) : null}
            <WorkspaceAction href="/documents">
              Open in Documents
            </WorkspaceAction>
          </div>
        </Card>
      </MotionRevealItem>
    </MotionRevealGroup>
  );
}
