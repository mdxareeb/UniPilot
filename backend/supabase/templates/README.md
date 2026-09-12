# Email templates

Three transactional email templates for UniPilot, sharing one layout.

| File | Purpose | Supabase Auth template name | Sent automatically today? |
| --- | --- | --- | --- |
| [`confirmation.html`](./confirmation.html) | Email address verification after sign up | `confirmation` | Yes — by Supabase Auth |
| [`recovery.html`](./recovery.html) | Password reset | `recovery` | Yes — by Supabase Auth |
| [`welcome.html`](./welcome.html) | Post-signup welcome | **none — not a Supabase template** | **No.** See below |

Delivery configuration (SMTP provider, sender identity, DNS) lives in
[../../EMAIL.md](../../EMAIL.md). Production SMTP is not configured yet, so
these templates are not in use on the hosted project.

## Subjects

| Template | Subject |
| --- | --- |
| `confirmation.html` | Confirm your UniPilot email |
| `recovery.html` | Reset your UniPilot password |
| `welcome.html` | Welcome to UniPilot |

The two Supabase subjects match the `subject` values already recorded in
[EMAIL.md](../../EMAIL.md). Change them in both places or they will drift.

## Installing the two Supabase templates

Supabase Auth renders these itself. There are two surfaces, and they are
independent — configuring one does not configure the other.

**Hosted project.** Dashboard → Authentication → Email Templates → pick
`Confirm signup` / `Reset password`, paste the file contents into the message
body and set the subject. The dashboard stores the HTML; it does not read this
repository.

**Local development (Supabase CLI).** Add to `supabase/config.toml`, which the
CLI generates and this repo does not commit:

```toml
[auth.email.template.confirmation]
subject = "Confirm your UniPilot email"
content_path = "./supabase/templates/confirmation.html"

[auth.email.template.recovery]
subject = "Reset your UniPilot password"
content_path = "./supabase/templates/recovery.html"
```

Then `supabase stop && supabase start` to pick up the change, and read the
result in the local mail catcher rather than a real inbox — see
[EMAIL.md](../../EMAIL.md).

## Template variables

Both Supabase templates use `{{ .ConfirmationURL }}` and nothing else.
Supabase generates the full action link — including the token — and substitutes
it. The link is never assembled in these files, and no token, hash or user id
is printed anywhere in the markup.

`{{ .ConfirmationURL }}` is correct for **both** confirmation and recovery;
that is what Supabase's own default recovery template uses. The other supported
variables (`{{ .Token }}`, `{{ .TokenHash }}`, `{{ .SiteURL }}`,
`{{ .RedirectTo }}`, `{{ .Email }}`, `{{ .Data }}`, …) are listed in
[EMAIL.md](../../EMAIL.md). Do not invent new ones — an unrecognised variable
is a template render error, not a blank.

## The welcome template

**Supabase Auth has no welcome email.** Its template names are `invite`,
`confirmation`, `recovery`, `magic_link`, `email_change` and
`reauthentication`. There is no trigger that fires when a user finishes signing
up, so `welcome.html` is **not sent by anything today** and must not be added
to `[auth.email.template.*]`.

It exists so the copy and layout are ready. The intended use, when there is a
provider and a verified sending domain:

1. A user confirms their email address through `confirmation.html`.
2. Application code sends `welcome.html` through the transactional provider's
   own API (a server-side send — never from the browser, and never with the
   provider key reaching client code).
3. Because that send does not go through Supabase, **`{{ .SiteURL }}` is not
   substituted for you.** Whoever builds the send must replace it with the site
   origin. It is written as a Supabase variable name only so all three files
   speak one placeholder language.

Do not describe the welcome email as automatic anywhere until step 2 exists.

## Layout

One structure, shared by all three files: a 600px white card on `#f9f9f9` with
a 1px `#e5e5e5` border, a text wordmark, then eyebrow → heading → body → black
pill button → plain-text link fallback → rule → closing note, and a footer
outside the card.

- **Tables, inline styles.** Gmail and Outlook.com strip or rewrite `<style>`,
  so the `<style>` block carries only resets and the `max-width: 600px` media
  query. Everything else is an inline `style` attribute.
- **No images.** There is no static logo asset in `public/`, and the site mark
  is a React-rendered icon. A text wordmark renders everywhere; a remote image
  does not.
- **No `@font-face`.** The site's Geist and Bricolage Grotesque faces are
  loaded by Next.js and are unavailable to mail clients. Headings ask for
  `'Bricolage Grotesque'` first and fall back to the system sans stack; body
  text is system sans only.
- **Button.** A shrink-wrapped table with `bgcolor="#000000"` and a
  `border-radius: 999px` anchor. It renders as a pill in Gmail and Apple Mail
  and degrades to a square black button in Outlook, which ignores
  `border-radius`. There is no hover state — mail clients cannot be relied on
  for one — and no VML, which would need per-template pixel widths.
- **Fallback link.** Every button is followed by the same URL as selectable
  text, with `word-break: break-all`, for clients that strip the anchor.

To change the shared shell, change it in all three files. The duplication is
deliberate: Supabase's dashboard and `content_path` both take one complete HTML
document, so there is no partial/include mechanism to share.

## Rules for editing these files

- **No secrets.** No SMTP credentials, provider API keys, service-role keys or
  anon keys. These files are read by the mail client and are effectively
  public. Sender identity is configured in the provider and Supabase dashboards
  once a domain is verified.
- **No tokens or ids.** Do not print `{{ .Token }}`, `{{ .TokenHash }}` or
  internal identifiers. The only place a token appears is inside the link
  Supabase generates.
- **Do not log generated links.** A confirmation or recovery URL is a
  credential until it is used.
- **No unsupported claims.** Copy describes what the product does today.
