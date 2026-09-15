"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Presentation as PresentationIcon } from "lucide-react";
import { useSignInPrompt } from "@/components/auth/SignInPromptProvider";
import { SignInAction } from "@/components/auth/SignInAction";
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
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { createPresentationAction } from "@/lib/data/presentationActions";
import { previewDocumentAction } from "@/lib/data/documentActions";
import { PRESENTATION_SAVE_ERROR } from "@/lib/data/presentationErrors";
import {
  isPresentationInFlight,
  PRESENTATION_PROMPT_MAX_LENGTH,
  type PresentationItem,
} from "@/lib/data/presentationValues";

/** The documents hub's refresh policy while work is in flight (18.x). */
const POLL_MS = 4_000;

const SLIDE_COUNT_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "5", label: "5 slides" },
  { value: "8", label: "8 slides" },
  { value: "10", label: "10 slides" },
  { value: "12", label: "12 slides" },
  { value: "15", label: "15 slides" },
  { value: "20", label: "20 slides" },
];

const FORMAT_OPTIONS = [
  { value: "pptx", label: "PowerPoint (.pptx)" },
  { value: "pdf", label: "PDF (.pdf)" },
];

type PresentationWorkspaceProps = {
  guest: boolean;
  /** `PRESENTON_URL` is set in this environment (GATE 1 posture). */
  configured: boolean;
  /** The most recent request, whatever its state. */
  initialPresentation: PresentationItem | null;
  /** Presenton's built-in templates for the picker (empty → General only). */
  templates: { id: string; name: string }[];
  /** The caller's PDF/DOCX documents that can be used as source material. */
  sourceDocuments: { id: string; name: string }[];
  /** Phase-2 editor link for the latest presentation, when it exists. */
  editHref: string | null;
};

/**
 * The presentation generator's client surface (Task 31.x).
 *
 * Two movements: the request form (create a row + queue the
 * `presentation.generate` job through a Server Action) and the run panel —
 * real progress mirrored from the async task by the worker, then the result
 * card with download + the link into /documents. There is no fake deck: in an
 * environment without a configured Presenton service the page renders the
 * honest blocked state and the form never appears.
 *
 * Async progress uses the documents hub's proven mechanism — while a request
 * is queued/running the server page is re-rendered on a bounded interval
 * (`router.refresh()`), and the refreshed prop replaces what this panel
 * shows. The worker owns the state; the client only reads it.
 *
 * Motion reuses the global system: `PageHeader` owns slot 0 of the entrance
 * ladder, the form arrives at slot 1, the result card arrives through
 * `MotionRevealGroup` + `MotionRevealItem variant="scale"`, inline errors use
 * `MotionNotice`, and the determinate progress fill is the shared rail
 * mechanism (origin-left `scaleX` on Motion's curve).
 */
export function PresentationWorkspace({
  guest,
  configured,
  initialPresentation,
  templates,
  sourceDocuments,
  editHref,
}: PresentationWorkspaceProps) {
  const { requireAuth } = useSignInPrompt();
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;

  const [prompt, setPrompt] = useState("");
  const [template, setTemplate] = useState(templates[0]?.id ?? "general");
  const [nSlides, setNSlides] = useState("auto");
  const [format, setFormat] = useState("pptx");
  const [sourceDocumentId, setSourceDocumentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const presentation = initialPresentation;
  const inFlight = presentation
    ? isPresentationInFlight(presentation.statusValue)
    : false;

  useEffect(() => {
    if (guest || !inFlight) return;
    const timer = window.setInterval(() => router.refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [guest, inFlight, router]);

  const templateOptions = useMemo(
    () =>
      templates.length > 0
        ? templates.map((item) => ({ value: item.id, label: item.name }))
        : [{ value: "general", label: "General" }],
    [templates],
  );

  const sourceOptions = useMemo(
    () => [
      { value: "", label: "None" },
      ...sourceDocuments.map((document) => ({
        value: document.id,
        label: document.name,
      })),
    ],
    [sourceDocuments],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requireAuth("Sign in to generate presentations.")) return;

    setError(null);
    setDownloadError(null);
    setSubmitting(true);

    let result: Awaited<ReturnType<typeof createPresentationAction>>;
    try {
      result = await createPresentationAction({
        prompt,
        template,
        nSlides: nSlides === "auto" ? null : Number(nSlides),
        format,
        sourceDocumentId: sourceDocumentId === "" ? null : sourceDocumentId,
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
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <form
        onSubmit={onSubmit}
        data-enter="scale"
        style={motionIndex(1)}
      >
        <Card className="flex h-full flex-col gap-5 bg-glass p-6 backdrop-blur-md md:p-7">
          <header className="flex flex-col gap-1">
            <h2 className="font-heading text-body-lg font-semibold text-foreground">
              Describe the deck
            </h2>
            <p className="text-label-sm text-muted-foreground">
              A topic and the shape you want. The deck is generated on your
              own service and saved to Documents.
            </p>
          </header>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="presentation-prompt"
              className="text-label-sm font-medium text-foreground"
            >
              Topic or prompt
            </label>
            <Textarea
              id="presentation-prompt"
              name="prompt"
              rows={5}
              required={!guest}
              maxLength={PRESENTATION_PROMPT_MAX_LENGTH}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="e.g. Cellular respiration for a first-year biology seminar — cover glycolysis, the Krebs cycle and the electron transport chain."
              aria-describedby="presentation-prompt-hint"
            />
            <p
              id="presentation-prompt-hint"
              className="text-label-sm text-muted-foreground"
            >
              What the deck is about, and anything it should cover.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="presentation-slides"
                className="text-label-sm font-medium text-foreground"
              >
                Slides
              </label>
              <Select
                id="presentation-slides"
                value={nSlides}
                onChange={setNSlides}
                options={SLIDE_COUNT_OPTIONS}
                aria-label="Number of slides"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="presentation-format"
                className="text-label-sm font-medium text-foreground"
              >
                Format
              </label>
              <Select
                id="presentation-format"
                value={format}
                onChange={setFormat}
                options={FORMAT_OPTIONS}
                aria-label="Export format"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="presentation-template"
              className="text-label-sm font-medium text-foreground"
            >
              Template
            </label>
            <Select
              id="presentation-template"
              value={template}
              onChange={setTemplate}
              options={templateOptions}
              aria-label="Presentation template"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="presentation-source"
              className="text-label-sm font-medium text-foreground"
            >
              Source document <span className="font-normal">(optional)</span>
            </label>
            <Select
              id="presentation-source"
              value={sourceDocumentId}
              onChange={setSourceDocumentId}
              options={sourceOptions}
              aria-label="Source document"
            />
            <p className="text-label-sm text-muted-foreground">
              {sourceDocuments.length > 0 ? (
                "Use one of your PDF or DOCX documents as the material."
              ) : (
                <>
                  Upload a PDF or DOCX in{" "}
                  <Link
                    href="/documents"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Documents
                  </Link>{" "}
                  to use one as source material.
                </>
              )}
            </p>
          </div>

          {error !== null ? (
            <MotionNotice role="alert" className="text-label-sm text-destructive">
              {error}
            </MotionNotice>
          ) : null}

          <div className="mt-auto flex items-center gap-3">
            {guest ? (
              <SignInAction
                aria-label="Sign in to generate presentations"
                reason="Sign in to generate presentations."
                guest
              >
                Sign in to generate
              </SignInAction>
            ) : (
              <Button type="submit" disabled={submitting}>
                {submitting ? "Starting…" : "Generate deck"}
              </Button>
            )}
          </div>
        </Card>
      </form>

      <RunPanel
        guest={guest}
        presentation={presentation}
        editHref={editHref}
        downloadError={downloadError}
        reduced={reduced}
        onDownload={onDownload}
      />
    </div>
  );
}

function RunPanel({
  guest,
  presentation,
  editHref,
  downloadError,
  reduced,
  onDownload,
}: {
  guest: boolean;
  presentation: PresentationItem | null;
  editHref: string | null;
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
