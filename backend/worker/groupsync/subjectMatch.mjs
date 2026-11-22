/**
 * WhatsApp group sync: match a message to one of the student's subjects.
 *
 * Deterministic first (course code, alias, name), in that order of strength. The
 * model is only asked to REPORT the course as written (`course_hint`) and,
 * when none of the student's subjects fits, to PROPOSE a new name; this module
 * decides what that means. The model never picks a subject id.
 *
 * Two rules keep sorting trustworthy:
 * - an ambiguous match (two subjects fit equally well) is NOT guessed: it
 *   returns no subject and flags `ambiguous`, so the item is reviewed;
 * - a new subject is never created here. A proposal travels to the review
 *   queue, and the student approves it.
 */

/** Lower-case, drop punctuation, collapse spaces. */
export function norm(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "CS 301", "cs-301" and "CS301" are the same code. */
export function compact(text) {
  return norm(text).replace(/ /g, "");
}

/** True when `needle` appears in `haystack` as whole words (both normalised). */
function containsWords(haystack, needle) {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * @param {string[]} texts  candidate strings (the model's hint, then the title,
 *   evidence and the message itself) in priority order
 * @param {Array<{id: string, name: string, course_code?: string|null, aliases?: string[]|null}>} subjects
 * @returns {{subjectId: string|null, method: string|null, ambiguous: boolean}}
 */
export function matchSubject(texts, subjects, { only = null } = {}) {
  const list = (subjects ?? []).filter((s) => s && s.id && s.name);
  if (list.length === 0) return { subjectId: null, method: null, ambiguous: false };

  const levels = [
    {
      method: "code",
      test: (s, t) => {
        const code = compact(s.course_code ?? "");
        if (code.length < 3) return false;
        // The code as a token, or as 2-3 adjacent tokens joined ("CS 301").
        // Never as a substring of a longer word ("dabcd" is not "ABC").
        const words = norm(t).split(" ").filter(Boolean);
        for (let i = 0; i < words.length; i += 1) {
          let joined = "";
          for (let len = 0; len < 3 && i + len < words.length; len += 1) {
            joined += words[i + len];
            if (joined === code) return true;
          }
        }
        return false;
      },
    },
    {
      method: "alias",
      test: (s, t) =>
        (s.aliases ?? []).some((a) => {
          const alias = norm(a);
          return alias.length >= 2 && (norm(t) === alias || containsWords(norm(t), alias));
        }),
    },
    {
      method: "name",
      test: (s, t) => {
        const name = norm(s.name);
        const text = norm(t);
        if (name.length < 3 || !text) return false;
        return text === name || containsWords(text, name) || (text.length >= 4 && containsWords(name, text));
      },
    },
  ];

  for (const level of levels) {
    if (only && level.method !== only) continue;
    for (const text of texts) {
      if (!text || !String(text).trim()) continue;
      const hits = list.filter((s) => level.test(s, text));
      if (hits.length === 1) return { subjectId: hits[0].id, method: level.method, ambiguous: false };
      if (hits.length > 1) return { subjectId: null, method: null, ambiguous: true };
    }
  }
  return { subjectId: null, method: null, ambiguous: false };
}

/**
 * Decide the subject outcome for one extracted item.
 *
 * @returns {{subjectId: string|null, proposedName: string|null, ambiguous: boolean, method: string|null}}
 */
export function resolveSubject({ hint, proposed, title, evidence, messageText }, subjects) {
  // Strongest signal first: what the model says the course is called.
  const byHint = matchSubject([hint], subjects);
  if (byHint.subjectId || byHint.ambiguous) {
    return { ...byHint, proposedName: null };
  }

  // A course code written anywhere in the message beats guessing. Only the
  // code level is trusted for free text, to avoid matching a course name that
  // merely appears in passing.
  const byCode = matchSubject([title, evidence, messageText], subjects, { only: "code" });
  if (byCode.subjectId) {
    // The model says "a course that is not in the list" while the text carries
    // a known course code: two readings that disagree. Do not pick one.
    if (proposed) return { subjectId: null, method: null, ambiguous: true, proposedName: null };
    return { ...byCode, proposedName: null };
  }

  // The model's proposal might just be an existing subject worded differently.
  if (proposed) {
    const byProposal = matchSubject([proposed], subjects);
    if (byProposal.subjectId) return { ...byProposal, proposedName: null };
    if (byProposal.ambiguous) return { ...byProposal, proposedName: null };
    return { subjectId: null, method: null, ambiguous: false, proposedName: proposed.trim().slice(0, 100) };
  }

  return { subjectId: null, method: null, ambiguous: false, proposedName: null };
}
