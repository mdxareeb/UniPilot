/**
 * WhatsApp group sync: turn a validated extraction into concrete decisions.
 *
 * Pure: no I/O. For each item the model found it decides whether to
 *   - "auto":   add straight to the calendar/tasks (confident, dated, sorted),
 *   - "review": send to the review queue (below the threshold, undated task,
 *               ambiguous subject, or a proposed NEW subject), or
 *   - "skip":   drop it (already past, no usable date for an event, invalid).
 *
 * The final confidence is the model's, MINUS the penalties the date resolver
 * and subject matcher report for the guesses they had to make, so an uncertain
 * reading can only ever reach the review queue, never the calendar.
 */
import { createHash } from "node:crypto";
import { norm, resolveSubject } from "./subjectMatch.mjs";
import { TASK_TYPES } from "./schemas.mjs";
import { resolveWhen } from "./whenResolver.mjs";

export const DEFAULT_AUTO_APPROVE_THRESHOLD = 0.85;

/** Penalty when the subject match was ambiguous. */
const AMBIGUOUS_SUBJECT_PENALTY = 0.1;
/** A task with no resolvable date is useful but vague. */
const UNDATED_TASK_PENALTY = 0.2;

/** events.type vocabulary: class | exam | deadline | NULL. */
const EVENT_TYPE = { exam: "exam", lab: "class", event: null };

export function readThreshold(env = process.env) {
  const raw = Number(env.WHATSAPP_AUTO_APPROVE_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_AUTO_APPROVE_THRESHOLD;
}

/**
 * The idempotency key for one extracted item. Prefixed `wg-` so it can never
 * collide with an export fingerprint in the shared (user_id, fingerprint)
 * unique key. The same message re-extracted yields the same ref, so a re-run
 * can never create a second task, event or candidate; and a rejected
 * candidate (terminal, same key) is never resurrected.
 */
export function itemRef({ rawFingerprint, type, title, startAt }) {
  const dateKey = startAt ? startAt.toISOString() : "undated";
  return `wg-${createHash("sha256")
    .update([rawFingerprint, type, norm(title), dateKey].join("\u001f"))
    .digest("hex")
    .slice(0, 32)}`;
}

/**
 * @param {object} extraction  validated ExtractionSchema output
 * @param {object} ctx
 * @param {Date}   ctx.sentAt
 * @param {string} ctx.timeZone
 * @param {'DMY'|'MDY'} ctx.dateOrder
 * @param {Date}   ctx.now
 * @param {number} ctx.threshold
 * @param {Array}  ctx.subjects
 * @param {string} ctx.messageText
 * @param {string} ctx.rawFingerprint
 * @returns {Array<object>}
 */
export function planItems(extraction, ctx) {
  const plans = [];
  for (const item of extraction.items ?? []) {
    const kind = TASK_TYPES.has(item.type) ? "task" : "event";
    const when = resolveWhen(item.when, {
      sentAt: ctx.sentAt,
      timeZone: ctx.timeZone,
      dateOrder: ctx.dateOrder,
      now: ctx.now,
    });

    if (when.status === "past") {
      plans.push({ action: "skip", reason: "past", item, kind });
      continue;
    }
    // An exam or lab with no usable date cannot be put on a calendar.
    if (kind === "event" && when.status !== "resolved") {
      plans.push({ action: "skip", reason: "no_date", item, kind });
      continue;
    }

    const subject = resolveSubject(
      {
        hint: item.course_hint ?? null,
        proposed: item.proposed_subject_name ?? null,
        title: item.title,
        evidence: item.evidence,
        messageText: ctx.messageText,
      },
      ctx.subjects,
    );

    const dated = when.status === "resolved";
    let confidence = item.confidence - when.penalty;
    if (subject.ambiguous) confidence -= AMBIGUOUS_SUBJECT_PENALTY;
    if (kind === "task" && !dated) confidence -= UNDATED_TASK_PENALTY;
    confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(3))));

    const startAt = dated ? when.startAt : null;
    const ref = itemRef({
      rawFingerprint: ctx.rawFingerprint,
      type: item.type,
      title: item.title,
      startAt,
    });

    // Anything uncertain about WHERE it belongs goes to a human:
    // a proposed new subject, an ambiguous match, an undated task, or a low score.
    const needsReview =
      Boolean(subject.proposedName) ||
      subject.ambiguous ||
      (kind === "task" && !dated) ||
      confidence < ctx.threshold;

    plans.push({
      action: needsReview ? "review" : "auto",
      reason: needsReview
        ? subject.proposedName
          ? "new_subject"
          : subject.ambiguous
            ? "ambiguous_subject"
            : kind === "task" && !dated
              ? "undated"
              : "low_confidence"
        : "confident",
      kind,
      type: item.type,
      eventType: kind === "event" ? EVENT_TYPE[item.type] : null,
      title: item.title.trim(),
      evidence: item.evidence,
      startAt,
      endAt: dated ? when.endAt : null,
      allDay: dated ? when.allDay : false,
      confidence,
      subjectId: subject.subjectId,
      proposedSubjectName: subject.proposedName,
      ref,
      notes: when.notes,
      item,
    });
  }
  return plans;
}

/**
 * Pick the subject a whole document belongs to: the most common subject among
 * the items it produced, else a course code in its name/caption/opening text,
 * else a name match on its file name and caption alone.
 */
export function pickDocumentSubject({ plans, fileName, caption, textHead, subjects }) {
  const counts = new Map();
  for (const plan of plans) {
    if (plan.subjectId) counts.set(plan.subjectId, (counts.get(plan.subjectId) ?? 0) + 1);
  }
  if (counts.size > 0) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  const byCode = resolveSubject(
    { hint: null, proposed: null, title: fileName, evidence: caption, messageText: textHead },
    subjects,
  );
  if (byCode.subjectId) return byCode.subjectId;
  const byName = resolveSubject({ hint: fileName, proposed: null, title: "", evidence: "", messageText: "" }, subjects);
  if (byName.subjectId) return byName.subjectId;
  const byCaption = resolveSubject({ hint: caption, proposed: null, title: "", evidence: "", messageText: "" }, subjects);
  return byCaption.subjectId;
}
