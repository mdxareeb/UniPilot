import Link from "next/link";
import { Rocket } from "lucide-react";
import { Container } from "@/components/ui/Container";

const linkGroups = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "How it works", href: "/how-it-works" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Benchmarks", href: "/benchmarks" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    heading: "Company",
    links: [{ label: "Dev's note", href: "/devs-note" }],
  },
];

const linkClasses =
  "rounded-base text-label-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

type FooterProps = {
  className?: string;
};

export function Footer({ className }: FooterProps) {
  return (
    <footer
      className={`border-t border-border bg-surface${className ? ` ${className}` : ""}`}
    >
      <Container className="py-14 md:py-16">
        <div className="mb-10 grid grid-cols-2 gap-gutter md:mb-12 md:grid-cols-5">
          <div className="col-span-2 flex flex-col gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 self-start rounded-base text-body-lg font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <span className="flex items-center justify-center rounded-base bg-primary p-1.5 text-primary-foreground">
                <Rocket aria-hidden="true" className="size-4" />
              </span>
              UniPilot
            </Link>
            <p className="max-w-xs text-body-md text-muted-foreground">
              Your AI-powered college operating system. Turn scattered academic
              information into a clear plan.
            </p>
          </div>
          {linkGroups.map((group) => (
            <div key={group.heading} className="flex flex-col gap-4">
              <h3 className="text-label-caps uppercase text-foreground">
                {group.heading}
              </h3>
              <nav
                aria-label={group.heading}
                className="flex flex-col items-start gap-3"
              >
                {group.links.map((link) => (
                  <Link key={link.href} href={link.href} className={linkClasses}>
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-6">
          <p className="text-label-sm text-muted-foreground">
            © 2026 UniPilot — All rights reserved.
          </p>
        </div>
      </Container>
    </footer>
  );
}

export type { FooterProps };
