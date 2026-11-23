import type {
  HomeToolGroup,
  HomeToolItem,
  HomeToolsGroup,
} from "./homeGroups";
import type { IntegrationStatusContext } from "@/features/workspace/registries";
import { INTEGRATIONS_REGISTRY } from "@/features/workspace/registries";

/** Count the tools that actually open (planned rows are not live). */
export function liveToolCount(group: HomeToolsGroup): number {
  return group.items.filter((item) => item.status === "live").length;
}

/** The compact pill on a Home group header. */
export function toolGroupPill(group: HomeToolsGroup): string {
  const live = liveToolCount(group);
  if (live === 0) return "Planned";
  return live === 1 ? "1 live" : `${live} live`;
}

/** Count the integrations whose resolver says Connected. */
export function connectedIntegrationCount(context: IntegrationStatusContext): number {
  return INTEGRATIONS_REGISTRY.filter(
    (integration) => integration.statusResolver(context).label === "Connected",
  ).length;
}

export function integrationGroupPill(context: IntegrationStatusContext): string {
  const connected = connectedIntegrationCount(context);
  if (connected === 0) return "Set up";
  return connected === 1 ? "1 connected" : `${connected} connected`;
}

/** The vault badge's plural rule; null while the count is still unknown. */
export function indexedFilesLabel(count: number | null): string | null {
  if (count === null) return null;
  if (count === 0) return "No files";
  return count === 1 ? "1 file" : `${count} files`;
}

/** A dashboard stat: an em dash while the count is unavailable, never a zero. */
export function statValue(count: number | null): string {
  return count === null ? "—" : String(count);
}

/** The one place a Home group's trailing pill is decided. */
export function groupPill(
  group: HomeToolGroup,
  context: IntegrationStatusContext,
): string {
  return group.kind === "integrations"
    ? integrationGroupPill(context)
    : toolGroupPill(group);
}

/** Live items in a tool group, in registry order. */
export function liveTools(group: HomeToolsGroup): HomeToolItem[] {
  return group.items.filter((item) => item.status === "live");
}
