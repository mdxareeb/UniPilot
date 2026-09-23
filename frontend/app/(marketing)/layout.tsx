import type { Metadata } from "next";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { Navbar } from "@/components/marketing/Navbar";
import { Footer } from "@/components/marketing/Footer";
import { ASSISTANT_FAILED_COPY } from "@/lib/data/assistantValues";

export const metadata: Metadata = {
  title: {
    default: "UniPilot",
    template: "%s | UniPilot",
  },
  description:
    "Your AI-powered college operating system. Turn scattered academic information into a clear plan.",
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Scroll reveals start hidden and are shown by Motion once their target
          enters the viewport. Without a script there is nothing to show them,
          so opt out entirely rather than leave content invisible. */}
      <noscript>
        <style>{`[data-reveal],[data-reveal-bar]{opacity:1!important;transform:none!important;clip-path:none!important}`}</style>
      </noscript>
      <div
        id="top"
        className="marketing flex min-h-screen flex-1 flex-col bg-dotted-grid"
      >
        <Navbar />
        <div className="flex flex-1 flex-col pt-24 md:pt-24">{children}</div>
        <Footer />
        {/* Inside this element, not beside it: `bg-dotted-grid` sets
            `isolation: isolate`, so the launcher has to share this stacking
            context to stay under the navbar rather than over it. The
            `failedCopy` prop is the server's sanitized transport-failure
            fallback (19.16), read from the client-safe vocabulary module so
            global chrome does not import the server pipeline; marketing has
            no sign-in provider, so the panel opens for everyone and the turn
            route's own 401 copy is what a guest's send surfaces. */}
        <AssistantLauncher failedCopy={ASSISTANT_FAILED_COPY} />
      </div>
    </>
  );
}
