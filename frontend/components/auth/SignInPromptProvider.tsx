"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SignInPrompt } from "./SignInPrompt";

type SignInPromptContextValue = {
  /**
   * `null` until the streamed server boundary reports; `false` is a confirmed
   * guest and `true` a confirmed session.
   */
  signedIn: boolean | null;
  /** Called once by the streamed boundary with the server's verdict. */
  setSignedIn: (signedIn: boolean) => void;
  /** Opens the prompt directly (page-level controls that already know). */
  openPrompt: (reason?: string) => void;
  /**
   * The guard every interactive control calls before acting. Returns `false`
   * for a confirmed guest — after opening the prompt — so the caller stops;
   * `true` lets the caller proceed.
   */
  requireAuth: (reason?: string) => boolean;
};

const SignInPromptContext = createContext<SignInPromptContextValue | null>(null);

/**
 * The sign-in prompt's state, mounted once in the `(app)` layout.
 *
 * The layout is deliberately synchronous, so the guest flag is not awaited
 * there: `SignInPromptSession` (a server boundary mirroring `SidebarUser`)
 * streams the `sessionViewer` verdict in behind `Suspense` and
 * `SignInPromptSessionReporter` writes it here. Every page and every piece of
 * chrome then shares one answer without a second session read — the viewer is
 * memoized per request.
 *
 * While the flag is still unknown (the first frames after the shell paints)
 * `requireAuth` lets callers proceed rather than guessing "guest": an
 * authenticated visitor is never shown a prompt, and a genuine guest is
 * stopped server-side by the action's own `requireOnboardedUser` gate. Once
 * the flag lands, a guest gets the dialog and nothing else.
 */
export function SignInPromptProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const openPrompt = useCallback((nextReason?: string) => {
    setReason(nextReason ?? null);
    setOpen(true);
  }, []);

  const requireAuth = useCallback(
    (nextReason?: string): boolean => {
      if (signedIn === false) {
        openPrompt(nextReason);
        return false;
      }
      return true;
    },
    [signedIn, openPrompt],
  );

  const value = useMemo<SignInPromptContextValue>(
    () => ({ signedIn, setSignedIn, openPrompt, requireAuth }),
    [signedIn, openPrompt, requireAuth],
  );

  return (
    <SignInPromptContext.Provider value={value}>
      {children}
      {/* `data-signed-in` is the streamed flag's probe: QA waits for the
          server verdict before driving a chrome control (the page's own
          controls take the flag as a server prop and need no probe). The
          wrapper is `contents`, so it adds no box. */}
      <div
        className="contents"
        data-signed-in={
          signedIn === null ? "unknown" : signedIn ? "true" : "false"
        }
      >
        <SignInPrompt open={open} reason={reason} onOpenChange={setOpen} />
      </div>
    </SignInPromptContext.Provider>
  );
}

/**
 * Client half of the streamed session boundary: receives the server's verdict
 * and hands it to the provider. Rendered by `SignInPromptSession`; on its own
 * it renders nothing.
 */
export function SignInPromptSessionReporter({
  signedIn,
}: {
  signedIn: boolean;
}) {
  const { setSignedIn } = useSignInPrompt();

  useEffect(() => {
    setSignedIn(signedIn);
  }, [signedIn, setSignedIn]);

  return null;
}

/** Strict hook for controls that are always inside the provider. */
export function useSignInPrompt(): SignInPromptContextValue {
  const value = useContext(SignInPromptContext);
  if (!value) {
    throw new Error("useSignInPrompt must be used inside SignInPromptProvider.");
  }
  return value;
}

/**
 * Optional hook for chrome that is also mounted outside the `(app)` shell
 * (`AssistantLauncher` on marketing pages): `null` means no provider, so the
 * control behaves exactly as it did before the prompt existed.
 */
export function useSignInPromptOptional(): SignInPromptContextValue | null {
  return useContext(SignInPromptContext);
}
