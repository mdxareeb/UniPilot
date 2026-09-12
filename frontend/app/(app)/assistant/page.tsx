import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { SignInAction } from "@/components/auth/SignInAction";
import { PageHeader } from "@/components/app/PageHeader";
import { motionIndex } from "@/components/motion/stagger";
import { Container } from "@/components/ui/Container";
import { Sparkles } from "lucide-react";

/**
 * Assistant (19.x placeholder shell).
 *
 * Guest-aware: a visitor without a session gets the same header and empty
 * surface with a sign-in line, and "New conversation" opens the shared
 * skippable prompt instead of reaching any action (nothing can send yet — no
 * conversation store exists). An unfinished signed-in student is still sent
 * into /onboarding upstream by `getWorkspaceAccess`.
 */
export default async function AssistantPage() {
  const user = await getWorkspaceAccess();

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <PageHeader
        eyebrow="Assistant"
        title="Assistant"
        description="Ask questions and work with your workspace."
        primaryAction={
          <SignInAction
            size="sm"
            aria-label="New conversation"
            reason="Sign in to start a conversation with the assistant."
            guest={!user}
          >
            <Sparkles aria-hidden="true" className="size-4" />
            New conversation
          </SignInAction>
        }
      />
      {/* Placeholder — real assistant UI lands in 19.x. Slot 1 of the page's
          entrance ladder, behind the header. The launcher panel already owns the
          assistant's popup motion through `MotionPopover`; this route is the
          full-page version of the same surface, and its conversation list is a
          `MotionListItem` case for 19.x. */}
      <div
        data-enter="scale"
        style={motionIndex(1)}
        className="rounded-card border border-dashed border-border bg-card/50 p-8 text-label-sm text-muted-foreground"
      >
        {user
          ? "Your conversations will appear here."
          : "Sign in to start a conversation with the assistant."}
      </div>
    </Container>
  );
}
