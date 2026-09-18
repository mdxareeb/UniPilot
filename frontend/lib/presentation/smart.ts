/**
 * Smart-deck detection (spec §5.7, §6.10, D7).
 *
 * Presenton's Smart mode stores freeform HTML (`html_content`) that depends on
 * its own Tailwind browser runtime and Chart.js injection; UniPilot's native
 * viewer renders standard Template V2 decks only, so every native route that
 * receives a Smart deck shows a labelled fallback instead of faking a stage.
 *
 * Detection is deliberately generous (D7): the deck-level flags OR any slide's
 * non-empty `html_content`. `slides[]` is stored unvalidated by the engine, so
 * the helper treats a missing array as "nothing to scan" rather than throwing —
 * the viewer still renders its own honest state for such a read.
 */
import type { PresentationDeck } from "./types";

export function isSmartDeck(deck: PresentationDeck): boolean {
  if (deck.generation_mode === "smart" || deck.type === "smart") return true;

  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  return slides.some(
    (slide) =>
      typeof slide.html_content === "string" && slide.html_content.trim() !== "",
  );
}
