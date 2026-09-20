import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Layers } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { PageHeader } from "@/components/app/PageHeader";
import { SignInAction } from "@/components/auth/SignInAction";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { isPresentonConfigured } from "@/lib/integrations/presentonConfig";
import {
  getPresentationTemplate,
  getTemplateTheme,
  isSafeSegment,
  PresentonError,
} from "@/lib/integrations/presenton";
import { motionIndex } from "@/components/motion/stagger";
import type { DeckTheme, PresentationTemplate } from "@/lib/presentation/types";
import { TemplatePreview } from "./_components/TemplatePreview";
import { renderableTemplateLayouts } from "./_components/templatePreviewModel";

/**
 * Template preview (Task E2, spec §5.1 row 8, §8.1, §10-E).
 *
 * Server page, `getWorkspaceAccess` first: a guest gets the sign-in prompt
 * (the template's art loads through the session-gated asset route), and a
 * malformed id is a 404 before any engine call. `getPresentationTemplate`
 * supplies the layouts, fonts and — on this engine — the stored theme; when
 * the stored theme is absent (possible for `/init`-created customs), the
 * engine's explicit deriving read (`getTemplateTheme`) is asked once, and a
 * failure there leaves the honest default rendering instead of failing the
 * page. Malformed layouts are dropped by `renderableTemplateLayouts` before
 * anything renders (review fix, E2).
 *
 * Unknown template (the engine's 4xx) → `notFound()`. An unconfigured service
 * and an unreachable engine each render their honest panel; no layout is ever
 * faked. The client `TemplatePreview` owns the read-only stage and the layout
 * picker; `PreviewShell` owns the page's entrance ladder (slot 0 is
 * `PageHeader`, slot 1 the content below it).
 */
export default async function PresentationTemplatePreviewPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const user = await getWorkspaceAccess();
  if (!user) {
    return (
      <PreviewShell title="Template preview">
        <Card className="bg-glass p-6 backdrop-blur-md md:p-8">
          <EmptyState
            icon={<Layers aria-hidden="true" className="size-6" />}
            title="Sign in to preview templates"
            description="Templates come from your own presentation service and their art loads through your session. Sign in to preview the template's layouts here."
            action={
              <SignInAction
                guest
                reason="Sign in to preview presentation templates."
              >
                Sign in
              </SignInAction>
            }
          />
        </Card>
      </PreviewShell>
    );
  }

  if (!isSafeSegment(templateId)) notFound();

  if (!isPresentonConfigured()) {
    return (
      <PreviewShell title="Template preview">
        <Card
          data-template-unavailable=""
          className="bg-glass p-6 backdrop-blur-md md:p-8"
        >
          <EmptyState
            icon={<Layers aria-hidden="true" className="size-6" />}
            title="The presentation service isn't connected"
            description="This environment has no presentation service configured, so the template can't be read here. Nothing is faked in its place."
            action={
              <ButtonLink href="/tools/presentation/templates" variant="outline">
                Back to templates
              </ButtonLink>
            }
          />
        </Card>
      </PreviewShell>
    );
  }

  let template: PresentationTemplate;
  try {
    template = await getPresentationTemplate(templateId);
  } catch (error) {
    if (error instanceof PresentonError && error.code === "rejected") {
      notFound();
    }
    return (
      <PreviewShell title="Template preview">
        <Card
          data-template-unavailable=""
          className="bg-glass p-6 backdrop-blur-md md:p-8"
        >
          <EmptyState
            icon={<Layers aria-hidden="true" className="size-6" />}
            title="This template couldn't be loaded"
            description="The presentation service didn't answer for this template. It may be temporarily unavailable — try again in a moment."
            action={
              <ButtonLink href="/tools/presentation/templates" variant="outline">
                Back to templates
              </ButtonLink>
            }
          />
        </Card>
      </PreviewShell>
    );
  }

  const layouts = renderableTemplateLayouts(template.layouts?.layouts);
  const theme = await resolveTemplateTheme(templateId, template);

  return (
    <PreviewShell
      title={template.name}
      description={
        template.description ??
        "A read-only preview of this template's layouts in your browser."
      }
      templateId={template.id}
    >
      {layouts.length === 0 ? (
        <Card
          data-template-unavailable=""
          className="bg-glass p-6 backdrop-blur-md md:p-8"
        >
          <EmptyState
            icon={<Layers aria-hidden="true" className="size-6" />}
            title="This template has no layouts"
            description="The presentation service served the template without any layouts, so there's nothing to render here. Nothing is faked in their place."
            action={
              <ButtonLink href="/tools/presentation/templates" variant="outline">
                Back to templates
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <TemplatePreview
          templateId={template.id}
          name={template.name}
          layoutCount={layouts.length}
          layouts={layouts}
          theme={theme}
          fonts={template.fonts}
        />
      )}
    </PreviewShell>
  );
}

/**
 * The template's theme: the stored one this engine serves on the template
 * read, or the engine's explicit deriving read when it is absent. The deriving
 * route persists on the engine (E1's recorded choice: the adapter never calls
 * it implicitly), which is exactly what this preview needs to be truthful for
 * a template created before theme derivation existed. A failed deriving read
 * leaves `null` — the stage renders its honest defaults.
 */
async function resolveTemplateTheme(
  templateId: string,
  template: PresentationTemplate,
): Promise<DeckTheme | null> {
  if (template.theme !== null) return template.theme;
  try {
    return await getTemplateTheme(templateId);
  } catch {
    return null;
  }
}

function PreviewShell({
  title,
  description,
  templateId,
  children,
}: {
  title: string;
  description?: string;
  templateId?: string;
  children: ReactNode;
}) {
  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <PageHeader
        eyebrow="Presentation generator"
        title={title}
        description={description}
        secondaryAction={
          <ButtonLink href="/tools/presentation/templates" variant="outline">
            Back to templates
          </ButtonLink>
        }
        primaryAction={
          templateId !== undefined ? (
            <ButtonLink
              href={`/tools/presentation?template=${encodeURIComponent(templateId)}`}
              data-template-use=""
            >
              Use this template
            </ButtonLink>
          ) : undefined
        }
      />
      {/* The page's entrance ladder: `PageHeader` owns slot 0, this section is
          slot 1 (spec §8.1/§8.3, MOTION.md "workspace entrance ladder"). The
          shared CSS keyframe honours reduced motion, like every `[data-enter]`. */}
      <div
        data-enter="scale"
        style={motionIndex(1)}
        className="flex min-w-0 flex-col gap-6"
      >
        {templateId !== undefined ? (
          <p className="flex items-center gap-2 text-label-sm text-muted-foreground">
            <Badge variant="outline" size="sm">
              Read-only
            </Badge>
            Previews use the template&rsquo;s own theme, fonts and layouts.
          </p>
        ) : null}
        {children}
      </div>
    </Container>
  );
}
