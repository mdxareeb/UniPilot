"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { MESSAGE_CONTENT_MAX_LENGTH } from "@/lib/data/assistantValues";

/**
 * Task 19.7 — the action chips.
 *
 * Real prompt text only, in the document/workspace retrieval the assistant
 * actually runs against: a chip is a question a person might really type, not
 * a button label dressed up as one, and never a canned "answer". Clicking one
 * fills the composer (documented by the visible hint and the code below) but
 * never sends: sending is always the caller's explicit action, so no turn can
 * be started, and no reply invented, behind their back. The provider in this
 * environment is unconfigured, and a chip that auto-sent would surface the
 * honest unconfigured copy as if a question had been asked — confusing and
 * dishonest about what happened.
 */
const ACTION_CHIPS = [
  "Summarise my latest document",
  "What are the key ideas in my notes?",
  "What should I revise first?",
] as const;

type AssistantComposerProps = {
  /** The conversation the next send targets; null starts one server-side. */
  conversationId: string | null;
  /** True while a turn is in flight; the send is blocked, typing is not. */
  busy: boolean;
  /**
   * 19.2 — bumped by the workspace after a verb creates a new conversation
   * (or otherwise hands the caller a fresh writing surface). A changed,
   * non-zero value focuses the textarea; the initial 0 never steals focus.
   */
  focusRequest: number;
  /** Receives the exact typed text; the composer never trims or rewrites it. */
  onSend: (content: string) => void;
};

/**
 * Tasks 19.8 (input) and 19.9 (send) — the conversation composer.
 *
 * A real labelled `<textarea>` (`sr-only` label, the compact-layout idiom the
 * global search already uses) bounded by the contract's own
 * `MESSAGE_CONTENT_MAX_LENGTH`, sending the exact typed text. Enter sends,
 * Shift+Enter inserts a newline (documented in the visible hint), and IME
 * composition is respected so Enter never ends a candidate selection early.
 *
 * Send is honestly disabled — never a dead-looking live control — when the
 * composer is empty/whitespace-only or while a turn is in flight; the textarea
 * itself stays enabled so the next message can be typed during a stream. The
 * busy state is announced twice over: `aria-busy` on the composer and a polite
 * status line (the hint's row, so nothing shifts when it becomes busy).
 *
 * Focus after a settle: if focus was inside the composer when the turn was
 * sent (Enter in the textarea, or the Send button), it returns to the textarea
 * once the turn settles — unless the caller has meanwhile focused something
 * outside the composer, in which case focus is deliberately left alone.
 * 19.2's create verb is the other focus path: its `focusRequest` bump lands
 * the caret in the textarea of the conversation it just created.
 *
 * No composer is rendered for a guest (the guest empty state owns that) or in
 * the `?c=`-unavailable state (see `AssistantWorkspace`: a send there would
 * either drop the conversation the URL names or silently start a different one
 * behind an error message).
 */
export function AssistantComposer({
  conversationId,
  busy,
  focusRequest,
  onSend,
}: AssistantComposerProps) {
  const [value, setValue] = useState("");
  const inputId = useId();
  const hintId = useId();
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const restoreFocus = useRef(false);
  const wasBusy = useRef(false);
  const handledFocusRequest = useRef(0);

  /* 19.2: the workspace bumps `focusRequest` when a conversation verb created
     the surface the caller is about to write into. The ref makes this run
     exactly once per request — including on a mount that arrives with the
     request already pending — and never on the initial 0. */
  useEffect(() => {
    if (focusRequest === 0 || focusRequest === handledFocusRequest.current) {
      return;
    }
    handledFocusRequest.current = focusRequest;
    inputRef.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    const settled = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (!settled || !restoreFocus.current) return;
    restoreFocus.current = false;

    const active = document.activeElement;
    if (
      active === null ||
      active === document.body ||
      composerRef.current?.contains(active)
    ) {
      inputRef.current?.focus();
    }
  }, [busy]);

  const submit = () => {
    if (busy || value.trim() === "") return;
    restoreFocus.current =
      composerRef.current?.contains(document.activeElement) ?? false;
    onSend(value);
    setValue("");
  };

  const hint =
    conversationId === null
      ? "Enter sends · Shift+Enter adds a line · sending starts a new conversation"
      : "Enter sends · Shift+Enter adds a line";

  return (
    <div
      ref={composerRef}
      data-assistant-composer=""
      aria-busy={busy}
      className="flex min-w-0 flex-col gap-3 border-t border-border pt-4"
    >
      <div
        role="group"
        aria-label="Suggested prompts"
        className="flex min-w-0 flex-wrap gap-2"
      >
        {ACTION_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            data-assistant-chip=""
            onClick={() => {
              setValue(chip);
              inputRef.current?.focus();
            }}
            className="inline-flex rounded-pill border border-border bg-card px-3 py-1.5 font-heading text-label-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {chip}
          </button>
        ))}
      </div>

      <form
        className="flex min-w-0 flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Message the assistant
        </label>
        <Textarea
          ref={inputRef}
          id={inputId}
          data-assistant-input=""
          rows={3}
          maxLength={MESSAGE_CONTENT_MAX_LENGTH}
          value={value}
          placeholder="Ask about your workspace…"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.nativeEvent.isComposing
            ) {
              return;
            }
            event.preventDefault();
            submit();
          }}
          aria-describedby={hintId}
          className="resize-none"
        />
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p
            id={hintId}
            role="status"
            data-assistant-busy=""
            className="text-label-sm text-muted-foreground"
          >
            {busy ? "The assistant is answering…" : hint}
          </p>
          <Button
            type="submit"
            size="sm"
            data-assistant-send=""
            disabled={busy || value.trim() === ""}
          >
            <SendHorizontal aria-hidden="true" className="size-4" />
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
