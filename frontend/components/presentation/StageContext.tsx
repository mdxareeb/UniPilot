"use client";

/**
 * Stage-scoped context (Task B3): the asset resolver every image/font source
 * builds its browser URL through, and the deck font entries every text run
 * maps its family name through. Populated once by `DeckStage` so the deeply
 * nested element tree reads one vocabulary instead of threading props through
 * every container. The default resolver is the owner-gated deck proxy
 * (`/api/presentation/{id}/asset`); the E2 template preview passes
 * `templateAssetUrl` so the same stage renders through the session-gated
 * template-asset route instead.
 */
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { deckAssetUrl } from "@/lib/presentation/elements";
import {
  resolveDeckFontFamily,
  type DeckFontEntry,
} from "@/lib/presentation/elements";

/**
 * The resolver a stage uses for every engine asset source: given a wire path
 * (engine mount, absolute URL or `data:`), return the browser URL or null when
 * it cannot be resolved. Deck stages default to the owner-gated deck proxy
 * (`deckAssetUrl`); the template preview points the same stage at the
 * session-gated template-asset route (`templateAssetUrl`) instead.
 */
export type DeckStageAssetUrl = (src: string) => string | null;

type DeckStageContextValue = {
  /** Presentation id for `/api/presentation/{id}/asset` (B2). */
  id: string;
  /** The asset resolver this stage renders images/fonts through. */
  assetUrl: DeckStageAssetUrl;
  fonts: DeckFontEntry[];
};

const DeckStageContext = createContext<DeckStageContextValue>({
  id: "",
  assetUrl: (src) => deckAssetUrl("", src),
  fonts: [],
});

export function DeckStageProvider({
  id,
  assetUrl,
  fonts,
  children,
}: {
  id: string;
  /** Defaults to the deck's owner-gated proxy; see {@link DeckStageAssetUrl}. */
  assetUrl?: DeckStageAssetUrl;
  fonts: DeckFontEntry[];
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      id,
      assetUrl: assetUrl ?? ((src: string) => deckAssetUrl(id, src)),
      fonts,
    }),
    [id, assetUrl, fonts],
  );
  return (
    <DeckStageContext.Provider value={value}>
      {children}
    </DeckStageContext.Provider>
  );
}

export function useDeckStage(): DeckStageContextValue {
  return useContext(DeckStageContext);
}

/** A family resolver bound to the deck's font map, for `fontTextStyle`. */
export function useDeckFontFamily(): (
  family: string | null | undefined,
) => string | null {
  const { fonts } = useDeckStage();
  return useMemo(
    () => (family: string | null | undefined) =>
      resolveDeckFontFamily(family, fonts),
    [fonts],
  );
}
