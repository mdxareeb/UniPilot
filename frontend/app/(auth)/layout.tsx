import Link from "next/link";
import { Rocket } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-dotted-grid">
      <header className="px-5 py-5 md:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-base text-label-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Rocket aria-hidden="true" className="size-4" />
          UniPilot
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-16 md:px-6">
        {children}
      </main>
    </div>
  );
}
