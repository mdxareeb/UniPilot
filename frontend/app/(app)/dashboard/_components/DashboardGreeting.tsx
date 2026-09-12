import { motionIndex } from "@/components/motion/stagger";
import { isPresent, type DashboardStudent } from "./dashboardStudent";

type DashboardGreetingProps = {
  /**
   * The fields this header speaks. The route hands it the whole persisted
   * student; each line appears only when its facts are present, so an unfinished
   * or skipped profile renders exactly the greeting it always did.
   */
  student: Pick<
    DashboardStudent,
    | "firstName"
    | "institution"
    | "courseProgram"
    | "academicYear"
    | "semester"
    | "subjects"
  >;
  /**
   * The request's date, already formatted (see `dashboardDate.ts`). A string,
   * not a `Date`: the server renders it and the client hydrates the same text,
   * so the header can never produce a hydration mismatch over the clock.
   */
  dateLabel: string;
};

/**
 * The page's opening: what day it is, whose workspace this is, and where to go
 * next — small metadata, large greeting, one supporting line. Nothing taller:
 * this is the top of a surface a student opens every day, so the space above
 * the first real card is worth more than a hero treatment.
 *
 * The date takes the eyebrow slot — Geist Mono label-caps, the same metadata
 * convention as the card eyebrows below it and the marketing pages' eyebrows.
 * The greeting is Bricolage at the largest workspace size; the supporting text
 * stays Geist body/small. No card, no glass — the header sits directly on the
 * dotted canvas it visually opens.
 *
 * As of Task 13.10 the supporting line can be the student's own persisted
 * answers: programme at institution, then year and semester, then their
 * subjects. Every part is optional and joined only from what exists — a
 * student who skipped setup, or a guest, gets the original sentence rather
 * than an empty fact line. The name prefers the persisted `first_name` (the
 * form's answer) and falls back to a provider display name; when neither
 * exists the greeting reads finished with no name at all.
 *
 * `wrap-anywhere` on the heading because the name is not ours: an unbroken
 * 40-character word would otherwise push the page sideways at 320px.
 *
 * `data-enter`, not `data-reveal` — this is above the fold on every viewport,
 * and the CSS-only entrance cannot leave it blank if a script never runs. The
 * lines are one ladder, and they differ in kind, not only in delay: the date
 * and the supporting line rise the default 8px, while the greeting between
 * them arrives at 6px with `scale(0.97)` — the one dimensional entrance in the
 * header, so the page's own title lands with weight rather than repeating the
 * rise the rest of the ladder already uses.
 */
export function DashboardGreeting({ student, dateLabel }: DashboardGreetingProps) {
  const { firstName, institution, courseProgram, academicYear, semester, subjects } =
    student;

  const studies =
    isPresent(courseProgram) && isPresent(institution)
      ? `${courseProgram} at ${institution}`
      : isPresent(courseProgram)
        ? courseProgram
        : isPresent(institution)
          ? institution
          : undefined;
  const stage = [academicYear, semester].filter(isPresent).join(" · ");
  const context = [studies, stage].filter(isPresent).join(" · ");

  return (
    <header>
      <p
        data-enter
        style={motionIndex(0)}
        className="mb-3 font-mono text-label-caps uppercase text-muted-foreground"
      >
        {dateLabel}
      </p>
      <h1
        data-enter="scale"
        style={motionIndex(1)}
        className="wrap-anywhere text-headline-lg-mobile text-foreground"
      >
        {isPresent(firstName)
          ? `Welcome to UniPilot, ${firstName}.`
          : "Welcome to UniPilot."}
      </h1>
      <p
        data-enter
        style={motionIndex(2)}
        className="wrap-anywhere mt-2 max-w-[56ch] text-body-md text-muted-foreground"
      >
        {context !== ""
          ? context
          : "Start with your academic workspace — or explore what you can do here."}
      </p>
      {subjects && subjects.length > 0 ? (
        <p
          data-enter
          style={motionIndex(3)}
          className="wrap-anywhere mt-1.5 max-w-[56ch] text-label-sm text-muted-foreground"
        >
          Your subjects: {subjects.join(", ")}
        </p>
      ) : null}
    </header>
  );
}
