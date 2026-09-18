"use client";

/**
 * Stage-scoped context (Task B3): the deck id every image/font source resolves
 * its asset-proxy URL through, and the deck font entries every text run maps
 * its family name through. Populated once by `DeckStage` so the deeply nested
 * element tree reads one vocabulary instead of threading props through every
 * container.
 */
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import {
  resolveDeckFontFamily,
  type DeckFontEntry,
} from "@/lib/presentation/elements";

type DeckStageContextValue = {
  /** Presentation id for `/api/presentation/{id}/asset` (B2). */
  id: string;
  fonts: DeckFontEntry[];
};

const DeckStageContext = createContext<DeckStageContextValue>({
  id: "",
  fonts: [],
});

export function DeckStageProvider({
  id,
  fonts,
  children,
}: {
  id: string;
  fonts: DeckFontEntry[];
  children: ReactNode;
}) {
  const value = useMemo(() => ({ id, fonts }), [id, fonts]);
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
