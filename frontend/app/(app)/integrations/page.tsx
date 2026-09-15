import { PageHeader } from "@/components/app/PageHeader";
import { motionIndex } from "@/components/motion/stagger";
import { Container } from "@/components/ui/Container";
import {
  getGoogleStatus,
  getWhatsAppOverview,
  isLiveEnabled,
} from "@/lib/data/integrations";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { GmailMark } from "./_components/BrandMarks";
import { IntegrationCard } from "./_components/IntegrationCard";
import { WhatsAppCard } from "./_components/WhatsAppCard";

/**
 * Integrations (14.13; 46.15 P5.1): the WhatsApp card is real and the Gmail
 * card stays honestly planned.
 *
 * The server page owns access and the two reads, in that order:
 * `getWorkspaceAccess` gates first (`requireOnboardedUser("/integrations")`
 * stays the Server Actions' hard fallback), then `getWhatsAppOverview` loads
 * the caller's connection/runs/candidates — it also owns the 30-day purge and
 * the stale-run sweep, replacing P4.5's temporary maintenance block — and
 * `getGoogleStatus` reports the read-only Google Calendar state for the
 * candidate push. A guest gets `null` for both and no data call happens; the
 * card renders its signed-out states and every action routes to the shared
 * sign-in prompt.
 *
 * `isLiveEnabled()` is read on the server too, so the flag-off line is the
 * same render for everyone; the live panel itself is P6.
 *
 * Motion reuses the workspace entrance ladder: `PageHeader` owns slot 0 and
 * the grid arrives with depth at slot 1.
 */
export default async function IntegrationsPage() {
  const access = await getWorkspaceAccess();
  const overview = access ? await getWhatsAppOverview(access.id) : null;
  const google = access ? await getGoogleStatus(access.id) : null;
  const liveEnabled = isLiveEnabled();

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <PageHeader
        eyebrow="Integrations"
        title="Integrations"
        description="Connect the services you already use. WhatsApp imports events from your chats — you choose whether each event waits for review or is added automatically."
      />
      <ul
        data-enter="scale"
        style={motionIndex(1)}
        className="grid min-w-0 list-none gap-4 sm:grid-cols-2"
      >
        <li className="min-w-0">
          <WhatsAppCard
            initial={overview}
            guest={!access}
            liveEnabled={liveEnabled}
            googleStatus={google}
          />
        </li>
        <li className="min-w-0">
          <IntegrationCard
            name="Gmail"
            description="UniPilot will pull assignment emails and their attachments into your workspace."
            mark={<GmailMark className="h-5 w-auto" />}
          />
        </li>
      </ul>
    </Container>
  );
}
