import { PageHeader } from "@/components/app/PageHeader";
import { motionIndex } from "@/components/motion/stagger";
import { Container } from "@/components/ui/Container";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { GmailMark, WhatsAppMark } from "./_components/BrandMarks";
import { IntegrationCard } from "./_components/IntegrationCard";

/**
 * Integrations (14.13): what UniPilot plans to connect to, stated honestly.
 *
 * Both services are named with their official brand marks (the sanctioned
 * DESIGN.md §The Icon Rule exception in `_components/BrandMarks.tsx`), one
 * future-tense sentence each, and an explicit `Coming soon` / `Not connected`
 * state. There is no Connect control, no connected/synced status and no
 * session-dependent copy: the page reads no user data and claims nothing is
 * wired because nothing is. The lead line says the same thing before the
 * cards do.
 *
 * Guest-aware like every workspace route: `getWorkspaceAccess` sends an
 * unfinished signed-in student into /onboarding and lets a guest (or a
 * completed student) render the same page.
 *
 * Motion reuses the workspace entrance ladder: `PageHeader` owns slot 0 and
 * the grid arrives with depth at slot 1. Nothing here is interactive, so
 * nothing lifts on hover.
 */
const INTEGRATIONS = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    description:
      "UniPilot will send deadline and revision reminders to your WhatsApp.",
    mark: <WhatsAppMark className="size-5" />,
  },
  {
    id: "gmail",
    name: "Gmail",
    description:
      "UniPilot will pull assignment emails and their attachments into your workspace.",
    mark: <GmailMark className="h-5 w-auto" />,
  },
];

export default async function IntegrationsPage() {
  await getWorkspaceAccess();

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <PageHeader
        eyebrow="Integrations"
        title="Integrations"
        description="UniPilot will connect to the services you already use. Nothing is wired up yet — the integrations below are planned."
      />
      <ul
        data-enter="scale"
        style={motionIndex(1)}
        className="grid min-w-0 list-none gap-4 sm:grid-cols-2"
      >
        {INTEGRATIONS.map((integration) => (
          <li key={integration.id} className="min-w-0">
            <IntegrationCard
              name={integration.name}
              description={integration.description}
              mark={integration.mark}
            />
          </li>
        ))}
      </ul>
    </Container>
  );
}
