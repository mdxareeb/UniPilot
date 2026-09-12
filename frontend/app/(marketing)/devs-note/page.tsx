import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { motionIndex } from "@/components/motion/stagger";
import { DevsNoteCta } from "./_components/DevsNoteCta";

export const metadata: Metadata = {
  title: "Dev's note",
  description:
    "A note from the founder on why UniPilot exists — one connected workspace for your college work.",
};

export default function DevsNotePage() {
  return (
    <Section>
      <Container>
        <article className="mx-auto max-w-[640px] font-sans">
          {/* Only the header animates. This is a reading page — revealing each
              paragraph on scroll would interrupt the read. */}
          <header>
            <p
              data-enter
              style={motionIndex(0)}
              className="text-label-caps uppercase text-muted-foreground"
            >
              A note from the founder
            </p>
            <h1
              data-enter
              style={motionIndex(1)}
              className="mt-4 text-headline-lg-mobile tracking-tight text-foreground md:text-headline-lg"
            >
              Why I built UniPilot
            </h1>
            <p
              data-enter
              style={motionIndex(2)}
              className="mt-3 text-body-md text-muted-foreground"
            >
              — Areeb, August 2026
            </p>
          </header>

          <div className="mt-10 flex flex-col gap-6 text-body-lg leading-relaxed text-foreground">
            <p>
              College work doesn&apos;t live in one place. It lives in a notes
              app, a folder of PDFs, a calendar, a messaging group and the back
              of your memory. Every semester starts with the best intentions,
              and somewhere around week four the system quietly falls apart.
            </p>
            <p>
              The problem was never a lack of tools. It was the opposite. Notes
              went in one app, assignments in another, deadlines on a calendar,
              documents in a drive. Each one solved its own little problem
              well, and together they created a bigger one: keeping track of
              the tools became work of its own.
            </p>
            <p>
              What gets lost isn&apos;t usually the big stuff. It&apos;s the
              reading that was due yesterday, the deadline buried on page two
              of a syllabus, the detail you were sure you&apos;d remember. When
              information is scattered, remembering where you put it takes more
              energy than the work itself.
            </p>
            <p>
              For a while I thought the answer was another app — something
              better than what I was already using. But that just adds one
              more thing to check, one more place things can slip through.
            </p>
          </div>

          <blockquote className="my-12 border-l-2 border-foreground pl-6">
            <p className="font-heading text-headline-md text-foreground md:text-headline-lg">
              &ldquo;I didn&apos;t want another app to manage. I wanted one
              less thing to think about.&rdquo;
            </p>
          </blockquote>

          <div className="flex flex-col gap-6 text-body-lg leading-relaxed text-foreground">
            <p>
              That&apos;s the idea behind UniPilot. One connected workspace
              where your documents, tasks, deadlines and assistant all work
              from the same academic context. Upload a syllabus, and the
              deadlines it contains become part of your plan — not another
              thing to copy by hand into yet another tool.
            </p>
            <p>
              The goal was never to build another productivity app you have to
              babysit. It was to remove the small, constant tax of keeping
              track — the mental overhead of wondering what&apos;s due,
              where it is, and whether you&apos;ve forgotten something.
            </p>
            <p>
              UniPilot is still early, and I&apos;d rather it be honest than
              impressive. But the direction is clear: fewer tabs, fewer
              tools, fewer things competing for your attention. If it makes
              you feel a little more organized and a little less behind,
              it&apos;s doing what I built it to do.
            </p>
          </div>

          <footer className="mt-12">
            <p className="text-body-md text-muted-foreground">— Areeb</p>
            <div className="mt-6">
              <DevsNoteCta />
            </div>
          </footer>
        </article>
      </Container>
    </Section>
  );
}
