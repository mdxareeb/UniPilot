/**
 * The new-thread starters. They are prompts, not commands: tapping one sends
 * it as the student's first question through the same grounded turn route.
 */
import type { AskScope } from "./scope";

export type StarterPrompt = {
  id: string;
  label: string;
  prompt: string;
};

const ALL_STARTERS: readonly StarterPrompt[] = [
  {
    id: "latest-summary",
    label: "Summarize my latest notes",
    prompt: "Summarize the key concepts from my latest course notes.",
  },
  {
    id: "deadlines",
    label: "Find deadlines",
    prompt:
      "Extract every deadline, exam date and important date mentioned in my files.",
  },
  {
    id: "quiz",
    label: "Quiz me",
    prompt: "Quiz me on the main topics in my course materials.",
  },
  {
    id: "hardest",
    label: "Explain the hardest idea",
    prompt: "Explain the hardest idea in my latest reading in simple terms.",
  },
];

const SUBJECT_STARTERS: readonly StarterPrompt[] = [
  {
    id: "subject-summary",
    label: "Summarize this subject",
    prompt: "Summarize the key concepts in this subject.",
  },
  {
    id: "subject-quiz",
    label: "Quiz me",
    prompt: "Quiz me on the main topics in this subject.",
  },
  {
    id: "subject-review",
    label: "What should I review first?",
    prompt:
      "What should I review first in this subject, based on the materials?",
  },
  {
    id: "subject-dates",
    label: "Find key dates",
    prompt: "List the deadlines and exam dates mentioned in this subject.",
  },
];

const DOCUMENT_STARTERS: readonly StarterPrompt[] = [
  {
    id: "document-summary",
    label: "Summarize this document",
    prompt: "Summarize this document's key points.",
  },
  {
    id: "document-terms",
    label: "Key terms",
    prompt: "List the key terms and definitions in this document.",
  },
  {
    id: "document-quiz",
    label: "Quiz me",
    prompt: "Quiz me on this document's main topics.",
  },
  {
    id: "document-dates",
    label: "Find dates",
    prompt: "Find the deadlines or exam dates mentioned in this document.",
  },
];

/** Three or four starters that match the current scope. */
export function starterPromptsFor(scope: AskScope): readonly StarterPrompt[] {
  if (scope.kind === "subject") return SUBJECT_STARTERS;
  if (scope.kind === "document") return DOCUMENT_STARTERS;
  return ALL_STARTERS;
}
