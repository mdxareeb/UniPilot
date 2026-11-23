/**
 * Ask AI's scope state and transitions.
 *
 * A scope is always one of three explicit shapes. A session's scope is stored
 * as ids only; the UI resolves the current names from the owner's rows, so a
 * deleted course/document falls back to All Materials rather than showing a
 * stale label. Pure so the fallback matrix is a direct Jest case.
 */
import type { AiScopeMode, StoredAiScope } from "@/lib/preferences";

import type { ChatSessionSummary } from "./chatValues";

export type AskScope =
  | { kind: "all" }
  | { kind: "subject"; id: string; name: string }
  | { kind: "document"; id: string; name: string };

export type ScopeSubject = { id: string; name: string };
export type ScopeDocument = { id: string; name: string };

export const ALL_SCOPE: AskScope = { kind: "all" };

export function sameScope(a: AskScope, b: AskScope): boolean {
  if (a.kind === "all" || b.kind === "all") return a.kind === b.kind;
  return a.kind === b.kind && a.id === b.id;
}

/** The POST /sessions body fields for this scope (both omitted for all). */
export function scopeToSessionInput(scope: AskScope): {
  subjectId?: string;
  documentId?: string;
} {
  if (scope.kind === "subject") return { subjectId: scope.id };
  if (scope.kind === "document") return { documentId: scope.id };
  return {};
}

export function scopeToStored(scope: AskScope): StoredAiScope | null {
  if (scope.kind === "subject") return { kind: "subject", id: scope.id };
  if (scope.kind === "document") return { kind: "document", id: scope.id };
  return null;
}

function findSubject(
  subjects: readonly ScopeSubject[],
  id: string,
): ScopeSubject | null {
  return subjects.find((subject) => subject.id === id) ?? null;
}

function findDocument(
  documents: readonly ScopeDocument[],
  id: string,
): ScopeDocument | null {
  return documents.find((document) => document.id === id) ?? null;
}

/**
 * The first-open scope. `all` always wins; `last` resumes a stored subject or
 * document only while it still exists in the owner's current rows.
 */
export function resolveInitialScope(
  mode: AiScopeMode,
  stored: StoredAiScope | null,
  subjects: readonly ScopeSubject[],
  documents: readonly ScopeDocument[],
): AskScope {
  if (mode !== "last" || stored === null) return ALL_SCOPE;

  if (stored.kind === "subject") {
    const subject = findSubject(subjects, stored.id);
    if (subject !== null) {
      return { kind: "subject", id: subject.id, name: subject.name };
    }
    return ALL_SCOPE;
  }

  const document = findDocument(documents, stored.id);
  if (document !== null) {
    return { kind: "document", id: document.id, name: document.name };
  }
  return ALL_SCOPE;
}

/** Resolve a session's stored ids to the current labels. */
export function scopeFromSession(
  session: Pick<ChatSessionSummary, "scopeSubjectId" | "scopeDocumentId">,
  subjects: readonly ScopeSubject[],
  documents: readonly ScopeDocument[],
): AskScope {
  if (session.scopeSubjectId !== null) {
    const subject = findSubject(subjects, session.scopeSubjectId);
    if (subject !== null) {
      return { kind: "subject", id: subject.id, name: subject.name };
    }
  }
  if (session.scopeDocumentId !== null) {
    const document = findDocument(documents, session.scopeDocumentId);
    if (document !== null) {
      return { kind: "document", id: document.id, name: document.name };
    }
  }
  return ALL_SCOPE;
}

/** True while the selected row still exists; a stale scope becomes all. */
export function scopeStillValid(
  scope: AskScope,
  subjects: readonly ScopeSubject[],
  documents: readonly ScopeDocument[],
): boolean {
  if (scope.kind === "subject") return findSubject(subjects, scope.id) !== null;
  if (scope.kind === "document") {
    return findDocument(documents, scope.id) !== null;
  }
  return true;
}

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

/** The chip label: the scope's own name, bounded for the horizontal bar. */
export function scopeChipLabel(scope: AskScope, maxLength = 24): string {
  if (scope.kind === "all") return "All Materials";
  return truncate(scope.name, maxLength);
}

/** A short history badge: "All materials", "Subject" or "Document". */
export function scopeKindLabel(
  session: Pick<ChatSessionSummary, "scopeSubjectId" | "scopeDocumentId">,
): string {
  if (session.scopeSubjectId !== null) return "Subject";
  if (session.scopeDocumentId !== null) return "Document";
  return "All materials";
}

/** The history row's resolved scope name (falls back to the kind label). */
export function sessionScopeLabel(
  session: Pick<ChatSessionSummary, "scopeSubjectId" | "scopeDocumentId">,
  subjects: readonly ScopeSubject[],
  documents: readonly ScopeDocument[],
  maxLength = 28,
): string {
  const scope = scopeFromSession(session, subjects, documents);
  if (scope.kind !== "all") return truncate(scope.name, maxLength);
  if (session.scopeSubjectId !== null) return "Subject no longer available";
  if (session.scopeDocumentId !== null) return "Document no longer available";
  return "All materials";
}

/** "5m ago"-style labels for the history sheet; older rows show a date. */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function relativeTimestamp(iso: string, now = Date.now()): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "Unknown time";

  const elapsed = Math.max(0, now - parsed);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) return "Just now";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d ago`;

  const date = new Date(parsed);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}
