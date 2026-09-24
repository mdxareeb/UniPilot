"use client";

import Link from "next/link";
import { FileText, LayoutTemplate, PenLine } from "lucide-react";
import { SignInAction } from "@/components/auth/SignInAction";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { TemplateThumb } from "./TemplateThumb";

/**
 * The template slice the generator's split needs — the same engine items the
 * templates browser renders (`id`/`name`/`description`/`layoutCount`/
 * `thumbnail`) plus `isDefault`, which orders the split built-ins first.
 */
export type WorkspaceTemplate = {
  id: string;
  name: string;
  description: string | null;
  layoutCount: number;
  thumbnail: string | null;
  isDefault: boolean;
};

type GetStartedTemplatesProps = {
  guest: boolean;
  templates: WorkspaceTemplate[];
  /** The template read threw: the service did not answer for the list. */
  templatesFailed: boolean;
  /** Focuses the hero's prompt box. */
  onFocusPrompt: () => void;
  /** Opens the hero's Sources disclosure. */
  onOpenSources: () => void;
  /** Sets the Template picker's value — no navigation, no URL change. */
  onSelectTemplate: (id: string) => void;
};

/** One row's shape for both the buttons and the browser link. */
const rowClasses =
  "group flex min-w-0 items-start gap-3 rounded-base border border-transparent p-2.5 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const iconWrapClasses =
  "flex size-9 shrink-0 items-center justify-center rounded-base border border-border bg-card text-muted-foreground";

/**
 * The Get-started/Templates split (T2, generate redesign spec §4/§5.1).
 *
 * Two cards, both real:
 * - "Get started" is three entry points onto existing controls — focus the
 *   prompt, open the Sources panel, open the templates browser. No invented
 *   flow, no sample-prompt card.
 * - "Templates" shows up to four real engine templates (built-ins first) and
 *   sets the picker when one is clicked. Guests get the honest note instead
 *   of art (the template-asset route is session-gated), a failed read gets
 *   "Templates couldn't be loaded" plus a retry into the browser, and an
 *   empty service says so — a card is never invented.
 *
 * Motion is the shared system: one `MotionRevealGroup` observes the section
 * and its two `MotionRevealItem variant="scale"` members play in order.
 */
export function GetStartedTemplates({
  guest,
  templates,
  templatesFailed,
  onFocusPrompt,
  onOpenSources,
  onSelectTemplate,
}: GetStartedTemplatesProps) {
  /* Built-ins first; within each kind the engine's own order is kept. */
  const teasers = [...templates]
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    .slice(0, 4);

  return (
    <MotionRevealGroup
      data-generate-split=""
      className="grid min-w-0 gap-4 lg:grid-cols-2"
    >
      <MotionRevealItem variant="scale" className="min-w-0">
        <Card
          data-get-started=""
          className="flex h-full min-w-0 flex-col gap-4 bg-glass p-5 backdrop-blur-md md:p-6"
        >
          <header className="flex flex-col gap-1">
            <h2 className="font-heading text-body-lg font-semibold text-foreground">
              Get started
            </h2>
            <p className="text-label-sm text-muted-foreground">
              Start from a topic, a document, or a template.
            </p>
          </header>

          <div className="flex min-w-0 flex-col gap-1">
            <button type="button" onClick={onFocusPrompt} className={rowClasses}>
              <span className={iconWrapClasses}>
                <PenLine aria-hidden="true" className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-heading text-body-md font-semibold text-foreground">
                  Describe your deck
                </span>
                <span className="text-label-sm text-muted-foreground">
                  Write the topic in the prompt above and generate.
                </span>
              </span>
            </button>

            <button type="button" onClick={onOpenSources} className={rowClasses}>
              <span className={iconWrapClasses}>
                <FileText aria-hidden="true" className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-heading text-body-md font-semibold text-foreground">
                  Add a source document (optional)
                </span>
                <span className="text-label-sm text-muted-foreground">
                  Use one of your PDF or DOCX documents as source material.
                </span>
              </span>
            </button>

            <Link href="/tools/presentation/templates" className={rowClasses}>
              <span className={iconWrapClasses}>
                <LayoutTemplate aria-hidden="true" className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-heading text-body-md font-semibold text-foreground">
                  Reuse a template
                </span>
                <span className="text-label-sm text-muted-foreground">
                  Browse the service&rsquo;s templates and pick one.
                </span>
              </span>
            </Link>
          </div>
        </Card>
      </MotionRevealItem>

      <MotionRevealItem variant="scale" className="min-w-0">
        <Card
          data-generate-templates=""
          className="flex h-full min-w-0 flex-col gap-4 bg-glass p-5 backdrop-blur-md md:p-6"
        >
          <header className="flex flex-col gap-1">
            <h2 className="font-heading text-body-lg font-semibold text-foreground">
              Templates
            </h2>
            <p className="text-label-sm text-muted-foreground">
              Click a card to load it into the form above.
            </p>
          </header>

          {guest ? (
            <div className="flex min-w-0 flex-col items-start gap-3 rounded-nested border border-border bg-glass-subtle p-3">
              <p className="text-label-sm text-muted-foreground">
                Template art loads through your own session, so guests
                don&rsquo;t see it here.
              </p>
              <SignInAction guest reason="Sign in to browse templates.">
                Sign in to browse templates
              </SignInAction>
            </div>
          ) : templatesFailed ? (
            <div className="flex min-w-0 flex-col items-start gap-3 rounded-nested border border-border bg-glass-subtle p-3">
              <p className="text-label-sm text-muted-foreground">
                Templates couldn&rsquo;t be loaded — the presentation service
                didn&rsquo;t answer for the list.
              </p>
              <ButtonLink
                href="/tools/presentation/templates"
                variant="outline"
                size="sm"
              >
                Try again
              </ButtonLink>
            </div>
          ) : teasers.length === 0 ? (
            <div className="flex min-w-0 flex-col items-start gap-3 rounded-nested border border-border bg-glass-subtle p-3">
              <p className="text-label-sm text-muted-foreground">
                No templates to show — the service returned none.
              </p>
              <WorkspaceAction href="/tools/presentation/templates">
                Browse all templates
              </WorkspaceAction>
            </div>
          ) : (
            <>
              <div className="grid min-w-0 grid-cols-2 gap-3">
                {teasers.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    data-template-teaser={template.id}
                    onClick={() => onSelectTemplate(template.id)}
                    className="group flex min-w-0 flex-col gap-2 rounded-base text-left hover-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <TemplateThumb template={template} />
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-heading text-label-sm font-semibold text-foreground">
                        {template.name}
                      </span>
                      <span className="shrink-0 font-mono text-label-caps text-muted-foreground">
                        {template.layoutCount} layouts
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-auto">
                <WorkspaceAction href="/tools/presentation/templates">
                  Browse all templates
                </WorkspaceAction>
              </div>
            </>
          )}
        </Card>
      </MotionRevealItem>
    </MotionRevealGroup>
  );
}
