"use client";

import { useMemo, type FormEvent, type RefObject } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { SignInAction } from "@/components/auth/SignInAction";
import { Collapsible } from "@/components/motion/Collapsible";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { motionIndex } from "@/components/motion/stagger";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { PresentationModels } from "@/lib/integrations/presenton";
import {
  PRESENTATION_INSTRUCTIONS_MAX_LENGTH,
  PRESENTATION_LANGUAGE_OPTIONS,
  PRESENTATION_MAX_SOURCES,
  PRESENTATION_PROMPT_MAX_LENGTH,
  PRESENTATION_TONES,
  PRESENTATION_VERBOSITIES,
} from "@/lib/data/presentationValues";
import type { WorkspaceTemplate } from "./GetStartedTemplates";
import { ModelControl, ModelControlNote } from "./ModelControl";

const SLIDE_COUNT_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "5", label: "5 slides" },
  { value: "8", label: "8 slides" },
  { value: "10", label: "10 slides" },
  { value: "12", label: "12 slides" },
  { value: "15", label: "15 slides" },
  { value: "20", label: "20 slides" },
];

/* Advanced options are built from the A2 vocabulary, so the control can never
   offer a value the parser rejects. Language keeps "Auto" as its UI word; the
   submit maps it to null, which is the draft's "detect from the prompt". */
const LANGUAGE_OPTIONS = PRESENTATION_LANGUAGE_OPTIONS.map((value) => ({
  value,
  label: value,
}));

const TONE_LABELS: Record<(typeof PRESENTATION_TONES)[number], string> = {
  default: "Default",
  casual: "Casual",
  professional: "Professional",
  funny: "Funny",
  educational: "Educational",
  sales_pitch: "Sales pitch",
};

const TONE_OPTIONS = PRESENTATION_TONES.map((value) => ({
  value,
  label: TONE_LABELS[value],
}));

const VERBOSITY_LABELS: Record<
  (typeof PRESENTATION_VERBOSITIES)[number],
  string
> = {
  concise: "Concise",
  standard: "Standard",
  "text-heavy": "Text-heavy",
};

const VERBOSITY_OPTIONS = PRESENTATION_VERBOSITIES.map((value) => ({
  value,
  label: VERBOSITY_LABELS[value],
}));

/** The two export formats as the reference's `aria-pressed` chips. */
const FORMAT_OPTIONS = [
  { value: "pptx", label: "PowerPoint" },
  { value: "pdf", label: "PDF" },
] as const;

/** The repo's `aria-pressed` pill (documents filters, calendar views). */
function togglePillClasses(pressed: boolean): string {
  return `min-w-0 rounded-pill border px-3 py-2 font-heading text-label-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
    pressed
      ? "border-transparent bg-card font-semibold text-foreground shadow-subtle"
      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
  }`;
}

type GenerateHeroProps = {
  guest: boolean;
  models: PresentationModels;
  /** The model switch's sanitized failure line, or null (T3). */
  modelError: string | null;
  /** True while the model apply is in flight; the `Select` is disabled then. */
  modelApplying: boolean;
  /** The chosen model value; the workspace calls the Server Action (T3). */
  onModelChange: (value: string) => void;
  templates: WorkspaceTemplate[];
  sourceDocuments: { id: string; name: string }[];
  prompt: string;
  onPromptChange: (value: string) => void;
  /** The hero's prompt box, so "Describe your deck" can focus it (T2). */
  promptRef: RefObject<HTMLTextAreaElement | null>;
  template: string;
  onTemplateChange: (value: string) => void;
  /** The `?template=` id was not in the service's list (honest miss note). */
  templateMissing: boolean;
  nSlides: string;
  onSlidesChange: (value: string) => void;
  format: string;
  onFormatChange: (value: string) => void;
  sourceIds: string[];
  onToggleSource: (id: string) => void;
  /** At the cap, unselected source rows go disabled — checked ones stay live. */
  atSourceCap: boolean;
  sourcesOpen: boolean;
  onSourcesOpenChange: (open: boolean) => void;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  tone: string;
  onToneChange: (value: string) => void;
  verbosity: string;
  onVerbosityChange: (value: string) => void;
  instructions: string;
  onInstructionsChange: (value: string) => void;
  includeTableOfContents: boolean;
  onToggleTableOfContents: () => void;
  includeTitleSlide: boolean;
  onToggleTitleSlide: () => void;
  submitting: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

/**
 * The generate page's centered hero + prompt form (T2, spec §5.1).
 *
 * This replaces `PageHeader` on the route: the hero *is* the page title, so
 * it owns the page's single `<h1>` and entrance slot 0 (eyebrow, heading,
 * supporting line); the form is slot 1 (`data-enter="scale"`). The card is
 * the page's one glass surface: the prompt, the model control (the live
 * `Select` where the engine grants the switch, the read-only chip otherwise —
 * T3) and submit in the trailing row, then the real option controls (format
 * chips, Slides/Template `Select`s, the Sources and Advanced disclosures) and
 * their unchanged panels. The prompt's hint line and any inline error sit
 * below the card so the card itself stays a control surface.
 *
 * All state stays in `PresentationWorkspace`; this component renders it and
 * forwards input through the existing handlers unchanged.
 */
export function GenerateHero({
  guest,
  models,
  modelError,
  modelApplying,
  onModelChange,
  templates,
  sourceDocuments,
  prompt,
  onPromptChange,
  promptRef,
  template,
  onTemplateChange,
  templateMissing,
  nSlides,
  onSlidesChange,
  format,
  onFormatChange,
  sourceIds,
  onToggleSource,
  atSourceCap,
  sourcesOpen,
  onSourcesOpenChange,
  advancedOpen,
  onAdvancedOpenChange,
  language,
  onLanguageChange,
  tone,
  onToneChange,
  verbosity,
  onVerbosityChange,
  instructions,
  onInstructionsChange,
  includeTableOfContents,
  onToggleTableOfContents,
  includeTitleSlide,
  onToggleTitleSlide,
  submitting,
  error,
  onSubmit,
}: GenerateHeroProps) {
  const templateOptions = useMemo(
    () =>
      templates.length > 0
        ? templates.map((item) => ({ value: item.id, label: item.name }))
        : [{ value: "general", label: "General" }],
    [templates],
  );

  return (
    <section data-generate-hero="" className="flex flex-col items-center gap-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 text-center">
        <p
          data-enter=""
          style={motionIndex(0)}
          className="font-mono text-label-caps uppercase text-muted-foreground"
        >
          Presentation generator
        </p>
        <h1
          data-enter=""
          style={motionIndex(0)}
          className="font-heading text-headline-lg-mobile font-bold text-foreground md:text-headline-lg"
        >
          What do you want to present?
        </h1>
        <p
          data-enter=""
          style={motionIndex(0)}
          className="text-body-md text-muted-foreground md:text-body-lg"
        >
          Describe a deck and generate it — the result is saved to your
          Documents.
        </p>
      </div>

      <form
        data-generate-form=""
        data-enter="scale"
        style={motionIndex(1)}
        onSubmit={onSubmit}
        className="w-full max-w-3xl"
      >
        <Card className="bg-glass p-4 shadow-floating backdrop-blur-md md:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="presentation-prompt" className="sr-only">
                Topic or prompt
              </label>
              <Textarea
                ref={promptRef}
                id="presentation-prompt"
                name="prompt"
                rows={4}
                required={!guest}
                maxLength={PRESENTATION_PROMPT_MAX_LENGTH}
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                placeholder="e.g. Cellular respiration for a first-year biology seminar — cover glycolysis, the Krebs cycle and the electron transport chain."
                aria-describedby="presentation-prompt-hint"
                className="min-h-[8rem] resize-none"
              />
              <ModelControlNote models={models} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <ModelControl
                models={models}
                error={modelError}
                applying={modelApplying}
                onApply={onModelChange}
              />
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

            <div className="border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <div
                  role="group"
                  aria-label="Export format"
                  className="flex min-w-0 items-center gap-1.5"
                >
                  {FORMAT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={format === option.value}
                      onClick={() => onFormatChange(option.value)}
                      className={togglePillClasses(format === option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="min-w-0 max-w-36">
                  <label htmlFor="presentation-slides" className="sr-only">
                    Slides
                  </label>
                  <Select
                    id="presentation-slides"
                    size="sm"
                    value={nSlides}
                    onChange={onSlidesChange}
                    options={SLIDE_COUNT_OPTIONS}
                    aria-label="Number of slides"
                  />
                </div>

                <div className="min-w-0 max-w-44">
                  <label htmlFor="presentation-template" className="sr-only">
                    Template
                  </label>
                  <Select
                    id="presentation-template"
                    size="sm"
                    value={template}
                    onChange={onTemplateChange}
                    options={templateOptions}
                    aria-label="Presentation template"
                  />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={sourcesOpen}
                  aria-controls="presentation-sources-panel"
                  onClick={() => onSourcesOpenChange(!sourcesOpen)}
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 truncate">
                      Sources{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-label-caps text-muted-foreground">
                        {sourceIds.length}/{PRESENTATION_MAX_SOURCES}
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className={`icon-turn size-4${sourcesOpen ? " rotate-180" : ""}`}
                      />
                    </span>
                  </span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={advancedOpen}
                  aria-controls="presentation-advanced-panel"
                  onClick={() => onAdvancedOpenChange(!advancedOpen)}
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span>Advanced settings</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`icon-turn size-4${advancedOpen ? " rotate-180" : ""}`}
                    />
                  </span>
                </Button>
              </div>

              {templateMissing ? (
                <p
                  data-template-preselect-miss=""
                  className="text-label-sm text-muted-foreground"
                >
                  The requested template isn&rsquo;t in the service&rsquo;s list
                  — showing{" "}
                  {templateOptions.find(
                    (option) => option.value === template,
                  )?.label ?? "the default"}
                  .
                </p>
              ) : null}
              {/* Sources: the caller's PDF/DOCX documents, multi-select. Every
                  document is listed; the cap lives on selection only — at 8
                  selected the unchecked rows disable rather than disappear, so
                  the list never reflows under the pointer and a ticked source
                  can always be unticked. The options row's button owns the
                  disclosure. */}
              <Collapsible
                open={sourcesOpen}
                variant="scale"
                id="presentation-sources-panel"
              >
                <div className="mt-3 flex flex-col gap-1 rounded-nested border border-border bg-glass-subtle p-2">
                  {sourceDocuments.length === 0 ? (
                    <p className="px-2 py-1.5 text-label-sm text-muted-foreground">
                      Upload a PDF or DOCX in{" "}
                      <Link
                        href="/documents"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        Documents
                      </Link>{" "}
                      to use one as source material.
                    </p>
                  ) : (
                    <fieldset className="flex min-w-0 flex-col border-0 p-0">
                      <legend className="sr-only">Source documents</legend>
                      {sourceDocuments.map((document) => {
                        const checked = sourceIds.includes(document.id);
                        const disabled = !checked && atSourceCap;
                        return (
                          <label
                            key={document.id}
                            className={`flex min-w-0 items-center gap-2.5 rounded-base px-2 py-2 text-label-sm transition-colors ${
                              disabled
                                ? "cursor-not-allowed text-muted-foreground/50"
                                : "cursor-pointer text-foreground hover:bg-muted/50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => onToggleSource(document.id)}
                              className="size-4 shrink-0 rounded-xs border-border accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <span className="min-w-0 truncate">
                              {document.name}
                            </span>
                          </label>
                        );
                      })}
                      {atSourceCap ? (
                        <p className="px-2 pt-1.5 text-label-sm text-muted-foreground">
                          Up to {PRESENTATION_MAX_SOURCES} documents per deck.
                        </p>
                      ) : null}
                    </fieldset>
                  )}
                </div>
              </Collapsible>

              {/* Advanced settings. Every control maps 1:1 into the draft: the
                  vocabularies come from A2, Auto becomes null (the parser's "no
                  explicit language"), instructions are trimmed-or-null, and the
                  two extras are the repo's aria-pressed toggles — title slide
                  on by default, matching the column default and today's decks.
                  The options row's button owns the disclosure. */}
              <Collapsible
                open={advancedOpen}
                variant="scale"
                id="presentation-advanced-panel"
              >
                <div className="mt-3 flex flex-col gap-4 rounded-nested border border-border bg-glass-subtle p-4">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="presentation-language"
                      className="text-label-sm font-medium text-foreground"
                    >
                      Language
                    </label>
                    <Select
                      id="presentation-language"
                      value={language}
                      onChange={onLanguageChange}
                      options={LANGUAGE_OPTIONS}
                      aria-label="Presentation language"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="presentation-tone"
                        className="text-label-sm font-medium text-foreground"
                      >
                        Tone
                      </label>
                      <Select
                        id="presentation-tone"
                        value={tone}
                        onChange={onToneChange}
                        options={TONE_OPTIONS}
                        aria-label="Presentation tone"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="presentation-verbosity"
                        className="text-label-sm font-medium text-foreground"
                      >
                        Verbosity
                      </label>
                      <Select
                        id="presentation-verbosity"
                        value={verbosity}
                        onChange={onVerbosityChange}
                        options={VERBOSITY_OPTIONS}
                        aria-label="Presentation verbosity"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="presentation-instructions"
                      className="text-label-sm font-medium text-foreground"
                    >
                      Instructions{" "}
                      <span className="font-normal">(optional)</span>
                    </label>
                    <Textarea
                      id="presentation-instructions"
                      name="instructions"
                      rows={3}
                      maxLength={PRESENTATION_INSTRUCTIONS_MAX_LENGTH}
                      value={instructions}
                      onChange={(event) =>
                        onInstructionsChange(event.target.value)
                      }
                      placeholder="e.g. Keep the language practical, emphasise the exam-relevant parts, and close with a recap."
                    />
                    <p className="text-label-sm text-muted-foreground">
                      Extra direction for the whole deck.
                    </p>
                  </div>

                  <div
                    role="group"
                    aria-label="Deck extras"
                    className="flex min-w-0 flex-wrap items-center gap-1.5"
                  >
                    <button
                      type="button"
                      aria-pressed={includeTableOfContents}
                      onClick={onToggleTableOfContents}
                      className={togglePillClasses(includeTableOfContents)}
                    >
                      Include table of contents
                    </button>
                    <button
                      type="button"
                      aria-pressed={includeTitleSlide}
                      onClick={onToggleTitleSlide}
                      className={togglePillClasses(includeTitleSlide)}
                    >
                      Include title slide
                    </button>
                  </div>
                </div>
              </Collapsible>
            </div>
          </div>
        </Card>

        {error !== null ? (
          <MotionNotice role="alert" className="text-label-sm text-destructive">
            {error}
          </MotionNotice>
        ) : null}

        <p
          id="presentation-prompt-hint"
          className="text-label-sm text-muted-foreground"
        >
          What the deck is about, and anything it should cover.
        </p>
      </form>
    </section>
  );
}
