import type { ReactNode } from "react";
import { Layers } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { PageHeader } from "@/components/app/PageHeader";
import { SignInAction } from "@/components/auth/SignInAction";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { motionIndex } from "@/components/motion/stagger";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { isPresentonConfigured } from "@/lib/integrations/presentonConfig";
import {
  listPresentationTemplates,
  PRESENTON_TEMPLATE_PAGE_SIZE_MAX,
  type PresentonTemplate,
} from "@/lib/integrations/presenton";
import {
  TemplatesBrowser,
  type TemplateCard,
} from "./_components/TemplatesBrowser";

/**
 * Templates browser (Task E2, spec §5.1 row 7, §8.1, §10-E).
 *
 * Server page, `getWorkspaceAccess` first (the workspace guest convention:
 * a guest renders the sign-in prompt, never a redirect). The catalog itself is
 * the engine's template list read through the adapter with the widest scope
 * (`scope: "all"`, one page of up to 100): the engine's `default` filter
 * splits exactly into the two tabs, so one read carries both and the tabs are
 * a client-side view of the same page. `total` travels too, so a page that
 * does not cover the engine's count says so instead of implying it does.
 *
 * Honesty posture: no configured service renders the not-connected state, a
 * failed read renders the unavailable state — no template card and no
 * thumbnail is ever invented, and a guest never sees a catalog they cannot
 * load art for (the template-asset route is session-gated).
 */
export default async function PresentationTemplatesPage() {
  const user = await getWorkspaceAccess();

  if (!user) {
    return (
      <TemplatesShell>
        <Card className="bg-glass p-6 backdrop-blur-md md:p-8">
          <EmptyState
            icon={<Layers aria-hidden="true" className="size-6" />}
            title="Sign in to browse templates"
            description="Templates come from your own presentation service and their art loads through your session. Sign in to see the built-in and custom templates here."
            action={
              <SignInAction
                guest
                reason="Sign in to browse presentation templates."
              >
                Sign in
              </SignInAction>
            }
          />
        </Card>
      </TemplatesShell>
    );
  }

  const configured = isPresentonConfigured();
  if (!configured) {
    return (
      <TemplatesShell>
        <Card
          data-templates-unavailable=""
          className="bg-glass p-6 backdrop-blur-md md:p-8"
        >
          <EmptyState
            icon={<Layers aria-hidden="true" className="size-6" />}
            title="The presentation service isn't connected"
            description="This environment has no presentation service configured, so there are no templates to browse here. Nothing is faked in their place."
            action={
              <ButtonLink href="/tools/presentation" variant="outline">
                Back to generator
              </ButtonLink>
            }
          />
        </Card>
      </TemplatesShell>
    );
  }

  const builtIn: TemplateCard[] = [];
  const custom: TemplateCard[] = [];
  let total = 0;
  let unavailable = false;
  try {
    const page = await listPresentationTemplates({
      scope: "all",
      page: 1,
      pageSize: PRESENTON_TEMPLATE_PAGE_SIZE_MAX,
    });
    total = page.total;
    for (const template of page.items) {
      const card = toCard(template);
      if (template.isDefault) builtIn.push(card);
      else custom.push(card);
    }
  } catch {
    unavailable = true;
  }

  if (unavailable) {
    return (
      <TemplatesShell>
        <Card
          data-templates-unavailable=""
          className="bg-glass p-6 backdrop-blur-md md:p-8"
        >
          <EmptyState
            icon={<Layers aria-hidden="true" className="size-6" />}
            title="Templates couldn't be loaded"
            description="The presentation service didn't answer for the template list. It may be temporarily unavailable — try again in a moment."
            action={
              <ButtonLink href="/tools/presentation/templates" variant="outline">
                Try again
              </ButtonLink>
            }
          />
        </Card>
      </TemplatesShell>
    );
  }

  return (
    <TemplatesShell>
      <div
        data-enter="scale"
        data-templates-browser=""
        style={motionIndex(1)}
      >
        <TemplatesBrowser builtIn={builtIn} custom={custom} total={total} />
      </div>
    </TemplatesShell>
  );
}

function toCard(template: PresentonTemplate): TemplateCard {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    layoutCount: template.layoutCount,
    thumbnail: template.thumbnail,
  };
}

function TemplatesShell({ children }: { children: ReactNode }) {
  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <PageHeader
        eyebrow="Presentation generator"
        title="Templates"
        description="Built-in and custom templates from your presentation service. Open one for a read-only preview."
        primaryAction={
          <ButtonLink href="/tools/presentation" variant="outline">
            Back to generator
          </ButtonLink>
        }
      />
      {children}
    </Container>
  );
}
