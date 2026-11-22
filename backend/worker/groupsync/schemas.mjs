/**
 * WhatsApp group sync: the validated shapes the model must return.
 *
 * Every model response is parsed with Zod before anything is trusted. The same
 * schemas are converted to JSON Schema and sent with the request so the model
 * is steered toward them, but validation here is the actual gate: a response
 * that does not parse is retried once and then fails the message with a
 * sanitized reason, never half-written.
 *
 * The `when` object deliberately holds what was SAID, not a computed date:
 * `whenResolver.mjs` does the arithmetic.
 */
import { z } from "zod";

const WEEKDAY = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const WhenSchema = z.object({
  date_text: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .describe('A numeric date exactly as written, e.g. "5/12" or "12.03.26". Null otherwise.'),
  day: z.number().int().min(1).max(31).nullable().optional(),
  month: z.number().int().min(1).max(12).nullable().optional(),
  year: z.number().int().min(2000).max(2100).nullable().optional(),
  weekday: WEEKDAY.nullable().optional(),
  week_ref: z.enum(["this", "next"]).nullable().optional(),
  relative: z
    .enum(["today", "tonight", "tomorrow", "day_after_tomorrow"])
    .nullable()
    .optional(),
  in_days: z.number().int().min(1).max(365).nullable().optional(),
  in_weeks: z.number().int().min(1).max(52).nullable().optional(),
  time: HHMM.nullable().optional().describe("24-hour HH:MM start time, if one was said."),
  end_time: HHMM.nullable().optional(),
});

export const ITEM_TYPES = ["assignment", "quiz", "exam", "lab", "event"];
/** assignment/quiz become tasks; exam/lab/event become calendar events. */
export const TASK_TYPES = new Set(["assignment", "quiz"]);

export const ItemSchema = z.object({
  type: z.enum(ITEM_TYPES),
  title: z.string().trim().min(1).max(200),
  course_hint: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .describe("The course code or name exactly as the message wrote it, if any."),
  proposed_subject_name: z
    .string()
    .max(100)
    .nullable()
    .optional()
    .describe("Only when the message clearly names a course that is NOT in the student's list."),
  when: WhenSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(300).describe("The shortest phrase of the message that supports this item."),
});

export const ExtractionSchema = z.object({
  relevant: z
    .boolean()
    .describe("False for chatter, jokes, logistics unrelated to coursework, greetings."),
  items: z.array(ItemSchema).max(25),
  summary: z.string().max(600).nullable().optional(),
  topic_tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
});

export const IMAGE_CATEGORIES = [
  "exam_schedule",
  "official_notice",
  "whiteboard_notes",
  "meme",
  "selfie",
  "casual_photo",
  "other",
];
/** Only these go on to extraction; every other category is discarded. */
export const USEFUL_IMAGE_CATEGORIES = new Set([
  "exam_schedule",
  "official_notice",
  "whiteboard_notes",
]);

export const ImageClassSchema = z.object({
  category: z.enum(IMAGE_CATEGORIES),
  confidence: z.number().min(0).max(1),
});

/** JSON Schema for the request, without the `$schema` key the API does not want. */
export function toRequestSchema(schema) {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  delete json.$schema;
  return json;
}
