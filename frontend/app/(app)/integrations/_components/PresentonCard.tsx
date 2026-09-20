import { cache } from "react";
import { Presentation as PresentationIcon } from "lucide-react";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { presentonBaseUrl } from "@/lib/integrations/presentonConfig";
import { IntegrationCard } from "./IntegrationCard";

/**
 * Task F3 — the Presenton half of `/integrations` (spec §9, §10-F).
 *
 * The engine is a server-side service, not a per-user connection, so this is
 * a server component and both of its facts are read on the server: whether
 * `PRESENTON_URL` names a service at all (`presentonBaseUrl()`, the same
 * reader the adapter uses) and whether that service answers right now. The
 * probe is `/api/v1/auth/status` — the engine's public status route — so no
 * bearer or key is involved, and a card on the guest-visible page never
 * touches a user's session or any per-user row.
 *
 * The three honest states, and what each slot says:
 *
 * - `not-configured` — `PRESENTON_URL` is unset; no probe is attempted
 *   (there is nothing to probe). Badge `Not configured`, mono `Unavailable`.
 * - `reachable` — the probe answered 2xx. Badge `Configured`, mono
 *   `Reachable`.
 * - `unreachable` — refused, DNS, the 1.5 s timeout, or a non-2xx answer.
 *   Badge `Configured`, mono `Unreachable`. Nothing is retried or faked.
 *
 * The link is the tool's own page (a guest gets that page's honest guest
 * state, so the link is never dead), and the one note keeps provider/model
 * configuration where it belongs: Presenton's own admin UI. No key, no base
 * URL and no provider field ever reaches this card — the state words are the
 * whole payload.
 */

/** One engine status read is bounded to 1.5 s; a dead service never stalls the page. */
const PROBE_TIMEOUT_MS = 1_500;

/**
 * One reachability probe per request: `cache()` dedupes repeated renders in
 * the same request scope, and the fetch is `no-store` with a hard timeout, so
 * a dead engine delays the card by at most {@link PROBE_TIMEOUT_MS} and can
 * never poison a later request with a cached answer.
 */
const probePresenton = cache(async (baseUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/api/v1/auth/status`,
      {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
});

export type PresentonCardState = "not-configured" | "reachable" | "unreachable";

/** The mono status line's word for each state (never a claim about a user). */
const STATUS_COPY: Record<PresentonCardState, string> = {
  "not-configured": "Unavailable",
  reachable: "Reachable",
  unreachable: "Unreachable",
};

export async function PresentonCard() {
  const baseUrl = presentonBaseUrl();
  const configured = baseUrl !== null;
  const reachable = baseUrl !== null ? await probePresenton(baseUrl) : false;
  const state: PresentonCardState = !configured
    ? "not-configured"
    : reachable
      ? "reachable"
      : "unreachable";

  return (
    <IntegrationCard
      name="Presenton"
      description="Generate and edit decks with a self-hosted Presenton service. Finished decks are saved to your Documents."
      mark={
        <PresentationIcon
          aria-hidden="true"
          className="size-5 text-muted-foreground"
        />
      }
      badge={
        <span data-presenton-configured={configured ? "true" : "false"}>
          {configured ? "Configured" : "Not configured"}
        </span>
      }
      status={<span data-presenton-state={state}>{STATUS_COPY[state]}</span>}
    >
      <div className="flex flex-col gap-2">
        <p className="text-label-sm text-muted-foreground">
          Providers and models are configured in Presenton’s own admin UI —
          never here.
        </p>
        <WorkspaceAction href="/tools/presentation">
          Open presentation generator
        </WorkspaceAction>
      </div>
    </IntegrationCard>
  );
}
