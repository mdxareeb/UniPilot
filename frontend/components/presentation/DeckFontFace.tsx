/**
 * Stage-scoped deck fonts (Task B3, spec §6.5/§6.8).
 *
 * Rendered inside the stage element. Absolute font-service stylesheet URLs are
 * deck content and load with `<link>` exactly as the deck declares them —
 * never proxied. Engine-relative font files become `@font-face` rules with a
 * namespaced family name (`updeck-…`), fetched through the owner-gated asset
 * proxy, so deck fonts cannot collide with (or replace) UniPilot chrome fonts.
 * Text runs map their wire family names to these names via `StageContext`.
 */
import { deckAssetUrl, deckFontEntries } from "@/lib/presentation/elements";
import type { PresentationDeck } from "@/lib/presentation/types";

function fontFormat(url: string): string {
  const path = url.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (path.endsWith(".woff2")) return "woff2";
  if (path.endsWith(".woff")) return "woff";
  if (path.endsWith(".otf")) return "opentype";
  if (path.endsWith(".eot")) return "embedded-opentype";
  return "truetype";
}

function cssString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\3c ")
    .replace(/>/g, "\\3e ")
    .replace(/[\n\r]/g, "")}"`;
}

export function DeckFontFace({
  id,
  fonts,
}: {
  id: string;
  fonts: PresentationDeck["fonts"];
}) {
  const entries = deckFontEntries(fonts);
  const stylesheets = entries.filter((entry) => entry.kind === "stylesheet");
  const css = entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => {
      const source = deckAssetUrl(id, entry.url);
      if (!source) return "";
      return `@font-face{font-family:${cssString(
        entry.cssFamily,
      )};src:url(${cssString(source)}) format(${cssString(
        fontFormat(entry.url),
      )});font-style:normal;font-weight:100 900;font-display:swap}`;
    })
    .join("");

  return (
    <>
      {stylesheets.map((entry) => (
        <link
          key={entry.family}
          data-deck-font-stylesheet={entry.family}
          rel="stylesheet"
          href={entry.url}
        />
      ))}
      {css ? (
        <style data-deck-font-faces="true">{css}</style>
      ) : null}
    </>
  );
}
