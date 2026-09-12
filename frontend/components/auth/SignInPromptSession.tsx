import { sessionViewer } from "@/lib/auth/viewer";
import { SignInPromptSessionReporter } from "./SignInPromptProvider";

/**
 * The streamed server boundary for the guest flag, mounted by the `(app)`
 * layout exactly like `SidebarUser` is mounted by the rail.
 *
 * The layout is synchronous on purpose — a runtime data read there would hold
 * back `(app)/loading.tsx` and every navigation under it — so the session
 * verdict resolves here, behind the layout's own `Suspense` boundary, and the
 * client reporter hands it to `SignInPromptProvider`. `sessionViewer` never
 * throws and never redirects: a Supabase outage resolves to the guest state,
 * which only makes the prompt available; the Server Actions remain the hard
 * gate on every write.
 */
export async function SignInPromptSession() {
  const viewer = await sessionViewer();

  return <SignInPromptSessionReporter signedIn={viewer.signedIn} />;
}
