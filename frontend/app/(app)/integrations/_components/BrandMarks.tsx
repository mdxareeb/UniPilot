/**
 * The official WhatsApp and Gmail brand marks, inline (14.13).
 *
 * DESIGN.md §The Icon Rule bans inline-fill SVGs and second icon families.
 * This file is the sanctioned second exception to that rule — the first is the
 * Google "G" on the sign-in control — because WhatsApp's and Gmail's branding
 * guidelines require their official marks on an integrations surface. They are
 * brand authentication assets, not UI iconography.
 *
 * The constraints that keep the exception narrow:
 * - Official geometry, unmodified: the Gmail "M" from Google's 2020 mark and
 *   the WhatsApp glyph in WhatsApp green (#25D366). No recolouring, no
 *   re-stroking, no gradient added or removed.
 * - Inline only: no external asset, no CDN, no dependency. `aria-hidden` keeps
 *   the adjacent heading as the card's accessible name, and the caller sizes
 *   one axis only so the mark's aspect ratio cannot distort.
 * - Scoped to `/integrations`. No other surface may copy this file.
 */

type BrandMarkProps = {
  /** Sizing comes from the caller — one axis only, so the mark cannot distort. */
  className?: string;
};

export function WhatsAppMark({ className }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
      />
    </svg>
  );
}

export function GmailMark({ className }: BrandMarkProps) {
  return (
    <svg
      viewBox="52 42 88 66"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
      <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
      <path
        fill="#fbbc04"
        d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"
      />
      <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
      <path
        fill="#c5221f"
        d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"
      />
    </svg>
  );
}
