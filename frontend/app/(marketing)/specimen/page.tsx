import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { BentoGrid, BentoItem } from "@/components/ui/BentoGrid";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconButton } from "@/components/ui/IconButton";
import { LoadingState } from "@/components/ui/LoadingState";
import { Metric, MetricRow } from "@/components/ui/Metric";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Task 3.13 — the design-foundation specimen page (§25). A dev artifact, not
 * a product surface: it renders the whole token + primitive foundation on
 * one screen so the founder can judge the system from one view, and it can
 * be re-run after every future design change.
 *
 * PRODUCTION EXCLUSION — how, exactly:
 * - `UNIPILOT_SPECIMEN` is set to `1` only in `.env.development.local`
 *   (git-ignored). In any other environment — including `next build`, which
 *   runs without that file — the guard below calls `notFound()` and the
 *   route serves the 404 page. The production bundle therefore contains no
 *   specimen content.
 * - No sitemap exists yet in the repository (Task 58.5 owns it); when one
 *   lands, this route is dev-only by the same guard and must be excluded
 *   from it. There is no sitemap to exclude it from today.
 * - It is linked from nowhere in the product (verified by search), and
 *   `robots: noindex` below keeps any accidental crawl out regardless.
 *
 * NO FABRICATED DATA (§26): every value below is self-evidently a
 * placeholder. A metric reads "000" and a label that names the slot ("Metric
 * label"), never a plausible reading. A card says "Card title". No student
 * names, no course names, no dates, no percentages, no counts.
 */

const specimenEnabled = process.env.UNIPILOT_SPECIMEN === "1";

export const metadata: Metadata = {
  title: "Design specimen (dev)",
  robots: { index: false, follow: false },
};

function SpecimenSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 py-6">
      <p className="font-mono text-label-caps uppercase text-muted-foreground">
        {label}
      </p>
      {children}
    </section>
  );
}

function SpecimenPage() {
  return (
    <div className="container-page flex flex-col pb-24">
      <header className="py-10">
        <h1 className="text-headline-lg-mobile md:text-headline-lg">
          Design foundation specimen
        </h1>
        <p className="max-w-[56ch] text-body-md text-muted-foreground">
          Dev-only artifact. Every value is a placeholder; nothing on this page
          is product content.
        </p>
      </header>

      {/* --- Backdrop motif candidates (§29) — presented neutrally, chosen
          by nobody here. Each panel mounts the same bg-dotted-grid utility
          with a different data-motif; the founder compares all three over a
          representative glass surface. */}
      <SpecimenSection label="Backdrop motif candidates">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(["dots", "grid", "diagonal"] as const).map((motif) => (
            <div
              key={motif}
              data-motif={motif}
              className="bg-dotted-grid flex min-h-40 flex-col gap-3 rounded-frame p-5"
            >
              <p className="font-mono text-label-caps uppercase text-muted-foreground">
                {motif}
              </p>
              {/* A glass panel over the field, so the interaction between
                  motif and translucent surfaces is visible per candidate. */}
              <div className="rounded-card border border-border bg-glass p-4 backdrop-blur-md">
                <p className="text-label-sm text-foreground">
                  Glass panel over {motif} field
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-label-sm text-muted-foreground">
          One is chosen by changing the single `--motif` token.
        </p>
      </SpecimenSection>

      {/* --- Radius scale (§6), every step labelled --- */}
      <SpecimenSection label="Radius scale">
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex flex-col gap-2">
            <div className="size-20 rounded-frame border border-border bg-card" />
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              frame 32
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="size-20 rounded-card border border-border bg-card" />
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              card 20
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="size-20 rounded-nested border border-border bg-card" />
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              nested 12
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="size-20 rounded-base border border-border bg-card" />
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              control 8
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-20 w-32 rounded-pill border border-border bg-card" />
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              pill
            </span>
          </div>
        </div>
      </SpecimenSection>

      {/* --- Elevation scale (§7), every level labelled --- */}
      <SpecimenSection label="Elevation scale">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-2">
            <div className="h-20 rounded-card border border-border bg-card" />
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              flush — none
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-20 rounded-card border border-border bg-card shadow-raised" />
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              raised
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-20 rounded-card border border-border bg-card shadow-floating" />
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              floating
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-20 rounded-card border border-border bg-card shadow-overlay" />
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              overlay
            </span>
          </div>
        </div>
      </SpecimenSection>

      {/* --- The three fills (§8), side by side --- */}
      <SpecimenSection label="Surface fills">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <Card className="min-h-28 p-5">
            <p className="text-body-md font-semibold text-foreground">Solid</p>
            <p className="text-label-sm text-muted-foreground">
              Opaque card fill. Body text sample.
            </p>
          </Card>
          <div className="rounded-card border border-border bg-glass p-5 backdrop-blur-md">
            <p className="text-body-md font-semibold text-foreground">Glass</p>
            <p className="text-label-sm text-muted-foreground">
              Translucent + blur. Body text sample.
            </p>
          </div>
          <Card variant="inverted" className="min-h-28 p-5">
            <p className="text-body-md font-semibold">Inverted</p>
            <p className="text-label-sm opacity-80">
              Near-black emphasis fill. Body text sample.
            </p>
          </Card>
        </div>
      </SpecimenSection>

      {/* --- Inverted card containing nested surfaces (§9/§10) --- */}
      <SpecimenSection label="Inverted card with nested surfaces">
        <Card variant="inverted" className="flex flex-col gap-4 p-6">
          <p className="text-body-md font-semibold">Inverted card title</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <Card key={n} variant="inverted-nested" className="p-4">
                <p className="text-label-sm">Nested surface {n}</p>
                <p className="text-label-sm opacity-75">Fill step lighter</p>
              </Card>
            ))}
          </div>
          <p className="text-label-sm opacity-75">
            Nested surfaces step lighter by fill, not by shadow.
          </p>
        </Card>
      </SpecimenSection>

      {/* --- Bento grid (§11): dominant, medium, small --- */}
      <SpecimenSection label="Bento grid composition">
        <BentoGrid>
          <BentoItem md={8} rows={2}>
            <Card className="h-full p-6">
              <p className="text-body-lg font-semibold text-foreground">
                Dominant cell
              </p>
              <p className="text-label-sm text-muted-foreground">
                Spans 8 of 12 columns and 2 row units.
              </p>
            </Card>
          </BentoItem>
          <BentoItem md={4} rows={2}>
            <Card variant="inverted" className="h-full p-6">
              <p className="text-body-lg font-semibold">Medium cell</p>
              <p className="text-label-sm opacity-80">
                4 columns, 2 rows. The one inverted surface in the composition.
              </p>
            </Card>
          </BentoItem>
          <BentoItem md={4}>
            <Card className="h-full p-5">
              <p className="text-body-md font-semibold text-foreground">
                Small cell A
              </p>
            </Card>
          </BentoItem>
          <BentoItem md={4}>
            <Card className="h-full p-5">
              <p className="text-body-md font-semibold text-foreground">
                Small cell B
              </p>
            </Card>
          </BentoItem>
          <BentoItem md={4}>
            <Card className="h-full p-5">
              <p className="text-body-md font-semibold text-foreground">
                Small cell C
              </p>
            </Card>
          </BentoItem>
        </BentoGrid>
      </SpecimenSection>

      {/* --- Buttons and icon buttons: every variant, every state, on both
          fills (§25) --- */}
      <SpecimenSection label="Buttons — all variants and states">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-4 rounded-card border border-border bg-card p-5">
            <Button>Primary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
            <Button className="focus-visible:ring-2">
              Focus this
            </Button>
            <IconButton aria-label="Icon button sample" variant="default">
              <Plus aria-hidden="true" className="size-4" />
            </IconButton>
            <IconButton aria-label="Icon outline sample" variant="outline">
              <Plus aria-hidden="true" className="size-4" />
            </IconButton>
            <IconButton aria-label="Icon primary sample" variant="primary">
              <Plus aria-hidden="true" className="size-4" />
            </IconButton>
            <IconButton aria-label="Icon disabled sample" disabled>
              <Plus aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
          <Card variant="inverted" className="flex flex-wrap items-center gap-4 p-5">
            <Button>Inverted context</Button>
            <Button variant="outline">Outline on inverted</Button>
            <Button variant="ghost" className="text-surface-inverted-foreground">
              Ghost on inverted
            </Button>
            <Button disabled>Disabled on inverted</Button>
            <IconButton aria-label="Icon on inverted" variant="outline-inverted">
              <Plus aria-hidden="true" className="size-4" />
            </IconButton>
          </Card>
        </div>
      </SpecimenSection>

      {/* --- Badges, dividers, ghost, empty, loading (§25) --- */}
      <SpecimenSection label="Badges, dividers, ghost, empty, loading">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Badge default</Badge>
            <Badge variant="outline">Badge outline</Badge>
            <Badge variant="dark">Badge dark</Badge>
          </div>
          <div className="flex flex-col gap-4">
            <Divider />
            <p className="text-label-sm text-muted-foreground">
              Divider above this line.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card variant="ghost" className="flex min-h-40 flex-col items-center justify-center gap-2">
              <Plus aria-hidden="true" className="size-6 text-muted-foreground" />
              <p className="text-label-sm text-muted-foreground">
                Ghost surface — add-slot affordance
              </p>
            </Card>
            <Card className="flex min-h-40 items-center justify-center p-6">
              <EmptyState
                title="Empty state title"
                description="Empty state description slot."
              />
            </Card>
          </div>
          <LoadingState label="Loading state sample">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          </LoadingState>
        </div>
      </SpecimenSection>

      {/* --- Navigation item: four states + nested child (§12) --- */}
      <SpecimenSection label="Navigation item states">
        <div className="flex flex-col gap-3 rounded-frame border border-border bg-glass p-5 shadow-floating backdrop-blur-md">
          <p className="font-mono text-label-caps uppercase text-muted-foreground">
            On glass rail
          </p>
          <nav aria-label="Specimen navigation" className="flex flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2.5 rounded-pill bg-surface-inverted px-2.5 py-2 text-label-sm font-semibold text-primary-foreground">
              Primary active
            </span>
            <span className="flex min-w-0 items-center gap-2.5 rounded-pill px-2.5 py-2 text-label-sm text-muted-foreground hover:bg-glass-subtle">
              Inactive
            </span>
            <span className="flex min-w-0 items-center gap-2.5 rounded-pill bg-card px-2.5 py-2 text-label-sm font-semibold text-foreground shadow-raised">
              Secondary active (within section)
            </span>
            <span className="flex min-w-0 items-center gap-2.5 rounded-pill px-2.5 py-2 text-label-sm text-muted-foreground hover:bg-glass-subtle">
              <span aria-hidden="true" className="ml-2 h-4 w-px bg-border" />
              Nested child item
            </span>
          </nav>
        </div>
      </SpecimenSection>

      {/* --- Metric pattern (§16) — placeholder values only (§26) --- */}
      <SpecimenSection label="Metric pattern">
        <Card className="p-6">
          <MetricRow>
            {[1, 2, 3].map((n) => (
              <div key={n} className="p-4">
                <Metric value="000" label="Metric label slot" />
              </div>
            ))}
          </MetricRow>
          <Divider />
          <div className="p-4">
            <Metric value="000" label="Metric — mono numeral variant" numeralFont="mono" />
          </div>
        </Card>
      </SpecimenSection>

      {/* --- Type specimen: every step of both scales (§14), display
          treatment applied --- */}
      <SpecimenSection label="Type scales">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              Marketing scale
            </span>
            <p className="text-display-xl text-foreground">
              Display-xl 96 · 800
            </p>
            <p className="text-display text-foreground">Display 72 · 800</p>
            <p className="text-headline-lg text-foreground">
              Headline-lg 48 · 700
            </p>
            <p className="text-headline-lg-mobile text-foreground">
              Headline-lg-mobile 32 · 700
            </p>
            <p className="text-body-lg text-muted-foreground">
              Body-lg 18 · 400 — generously leaded body text sample with a
              constrained measure.
            </p>
          </div>
          <Divider />
          <div className="flex flex-col gap-2">
            <span className="font-mono text-label-caps uppercase text-muted-foreground">
              App scale
            </span>
            <p className="text-headline-md text-foreground">
              Headline-md 24 · 600
            </p>
            <p className="text-body-md text-muted-foreground">
              Body-md 16 · 400 — dense, scannable, uniform.
            </p>
            <p className="text-label-sm text-muted-foreground">
              Label-sm 13 · 500
            </p>
            <p className="text-label-caps uppercase text-muted-foreground">
              Label-caps 12 · 600 · tracked
            </p>
          </div>
        </div>
      </SpecimenSection>
    </div>
  );
}

export default function SpecimenRoute() {
  if (!specimenEnabled) notFound();
  return <SpecimenPage />;
}
