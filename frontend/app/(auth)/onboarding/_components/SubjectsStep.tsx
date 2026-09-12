"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { MotionListItem } from "@/components/motion/MotionListItem";
import { MotionNotice } from "@/components/motion/MotionNotice";
import type { StepFieldsProps } from "./onboardingData";

const INPUT_ID = "subject-name";
const ERROR_ID = "subject-name-error";

/**
 * The optional subjects step: type a subject, add it, remove any that were a
 * mistake.
 *
 * Two pieces of state live here rather than in `OnboardingData`: the text being
 * typed and the message shown when it cannot be added. Neither is an answer — the
 * answer is the list — so neither belongs in what 13.10 persists. The
 * shell remounts the step on navigation, which clears both and leaves the list
 * itself untouched, exactly the behaviour wanted.
 *
 * Subjects are listed as rows rather than pills. A subject can be "Maths" or
 * "Introduction to Quantitative Research Methods", and a pill wide enough for the
 * second wraps into an odd shape at 320px, while a row wraps its text and keeps
 * its remove button in the same place every time.
 */
export function SubjectsStep({ value, onSubjectsChange }: StepFieldsProps) {
  const { subjects } = value;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();

  function add() {
    const name = draft.trim();

    if (name === "") {
      setError("Enter a subject name.");
      return;
    }

    // Matched case-insensitively so "Calculus" and "calculus" count as the same
    // subject, but stored as typed: the student's own capitalisation is what they
    // read back.
    const isDuplicate = subjects.some(
      (subject) => subject.toLowerCase() === name.toLowerCase(),
    );

    if (isDuplicate) {
      setError("That subject is already on your list.");
      return;
    }

    onSubjectsChange([...subjects, name]);
    setDraft("");
    setError(undefined);
  }

  function remove(name: string) {
    onSubjectsChange(subjects.filter((subject) => subject !== name));
    // The pressed button unmounts with its row, which would leave focus on the
    // document body. Sending it back to the input keeps the keyboard where the
    // next action is, and makes removing several in a row possible without a
    // mouse. Found by id because `Input` is a shared primitive that does not take
    // a ref, and this one step is not a reason to change its API.
    document.getElementById(INPUT_ID)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // The other steps' inputs advance on Enter. Here it adds the subject instead:
    // with text in the field, finishing that entry is plainly what Enter means,
    // and advancing would silently drop what was typed. Continue is still one Tab
    // and one press away.
    event.preventDefault();
    add();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={INPUT_ID}
          className="text-label-sm font-medium text-foreground"
        >
          Subject name
        </label>

        <div className="flex gap-2">
          <Input
            id={INPUT_ID}
            name={INPUT_ID}
            type="text"
            // No standard autocomplete token covers a subject, and an unrecognised
            // one would leave the browser free to offer a saved address instead.
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            placeholder="e.g. Linear Algebra"
            value={draft}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? ERROR_ID : undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              // Drop the message as soon as the reader starts changing what it
              // was about, the same way the flow clears a field's error.
              if (error !== undefined) setError(undefined);
            }}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1"
          />
          {/* Never disabled: a disabled Add on an empty field cannot say why it
              will not work, and pressing it is how someone finds out. */}
          <Button type="button" variant="outline" onClick={add}>
            Add
          </Button>
        </div>

        {error ? (
          <MotionNotice
            id={ERROR_ID}
            role="alert"
            className="text-label-sm text-destructive"
          >
            {error}
          </MotionNotice>
        ) : null}
      </div>

      {/* Adding a subject changes this region while focus stays in the input, so
          without a live region a screen reader would get no confirmation that Add
          did anything. The wrapper is always present: a live region that appears
          together with its content is not announced. */}
      <div aria-live="polite">
        {subjects.length === 0 ? (
          <p className="text-label-sm text-muted-foreground">
            Optional — you can add subjects later.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {/* An added subject drops into its own place and a removed one
                fades while the rows below close the gap — the only list on the
                site today that gains and loses members, and the reason
                `MotionListItem` carries `layout`. Focus has already moved back
                to the input by then, so the movement is the only confirmation
                the eye gets that Add did something.

                `subject` is a safe key: the list refuses a repeat, so no two
                rows can ever share one. */}
            <AnimatePresence initial={false}>
              {subjects.map((subject) => (
                <MotionListItem
                  key={subject}
                  className="flex items-center gap-2 rounded-base border border-border bg-card pl-3"
                >
                  <span className="min-w-0 flex-1 wrap-anywhere py-2 text-body-md text-foreground">
                    {subject}
                  </span>
                  {/* The name is in the label because "Remove" on its own is
                      what every row would be called. */}
                  <IconButton
                    type="button"
                    aria-label={`Remove ${subject}`}
                    onClick={() => remove(subject)}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </IconButton>
                </MotionListItem>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}
