import { useCallback, useState } from "react";
import { View } from "react-native";

import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { ChoiceRow } from "@/components/ChoiceRow";
import { Input } from "@/components/Input";
import { Notice } from "@/components/Notice";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/theme/ThemeProvider";
import {
  ACADEMIC_YEAR_OPTIONS,
  PLANNING_STYLE_OPTIONS,
  REMINDER_LEAD_OPTIONS,
  SEMESTER_OPTIONS,
} from "../../../../frontend/lib/data/onboardingValues";
import { completeOnboarding, ONBOARDING_COPY } from "./completeOnboarding";
import { addSubject, parseOnboardingDraft } from "./validation";

type Notice_ = { text: string; tone: "info" | "error" };

/** Label-valued options: the draft speaks display strings, like the web flow. */
const labelOptions = <T extends { label: string }>(options: readonly T[]) =>
  options.map((option) => ({ label: option.label, value: option.label }));

const YEAR_OPTIONS = labelOptions(ACADEMIC_YEAR_OPTIONS);
const SEMESTER_OPTIONS_ = labelOptions(SEMESTER_OPTIONS);
const STYLE_OPTIONS = labelOptions(PLANNING_STYLE_OPTIONS);
const LEAD_OPTIONS = labelOptions(REMINDER_LEAD_OPTIONS);

/**
 * The native onboarding form (M2b): the web flow's answers, validated by the
 * mirrored rule set and persisted through the SAME `complete_onboarding` RPC.
 * On success the provider re-reads the profile and the shell gate moves to the
 * workspace — this form never navigates by itself.
 */
export function OnboardingForm() {
  const theme = useTheme();
  const { refreshProfile } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [institution, setInstitution] = useState("");
  const [courseProgram, setCourseProgram] = useState("");
  const [academicYear, setAcademicYear] = useState<string | null>(null);
  const [semester, setSemester] = useState<string | null>(null);
  const [planningStyle, setPlanningStyle] = useState<string | null>(null);
  const [reminderLead, setReminderLead] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subjectInput, setSubjectInput] = useState("");
  const [notice, setNotice] = useState<Notice_ | null>(null);
  const [busy, setBusy] = useState(false);

  const addSubjectRow = useCallback(() => {
    const next = addSubject(subjects, subjectInput);
    if (next === null) {
      setNotice({ text: ONBOARDING_COPY.SUBJECT_INVALID, tone: "error" });
      return;
    }
    setSubjects(next);
    setSubjectInput("");
    setNotice(null);
  }, [subjectInput, subjects]);

  const removeSubject = useCallback((name: string) => {
    setSubjects((current) => current.filter((subject) => subject !== name));
  }, []);

  const save = useCallback(async () => {
    if (busy) return;
    const parsed = parseOnboardingDraft({
      firstName,
      lastName,
      institution,
      courseProgram,
      academicYear: academicYear ?? "",
      semester: semester ?? "",
      planningStyle: planningStyle ?? "",
      reminderLead: reminderLead ?? "",
      subjects,
    });
    if (parsed === null) {
      setNotice({ text: ONBOARDING_COPY.INVALID, tone: "error" });
      return;
    }
    setNotice(null);
    setBusy(true);
    const result = await completeOnboarding(parsed);
    if (result.error !== null) {
      setBusy(false);
      setNotice({ text: result.error, tone: "error" });
      return;
    }
    await refreshProfile();
    setBusy(false);
  }, [
    academicYear,
    busy,
    courseProgram,
    firstName,
    institution,
    lastName,
    planningStyle,
    refreshProfile,
    reminderLead,
    semester,
    subjects,
  ]);

  return (
    <View style={{ gap: theme.spacing.xxl }}>
      <Surface
        fill="solid"
        elevation="raised"
        radius="card"
        padding={theme.spacing.xl}
        style={{ gap: theme.spacing.lg }}
      >
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          About you
        </AppText>
        <Input
          label="First name"
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Areeb"
          autoCapitalize="words"
          textContentType="givenName"
          editable={!busy}
        />
        <Input
          label="Last name"
          value={lastName}
          onChangeText={setLastName}
          placeholder="Khan"
          autoCapitalize="words"
          textContentType="familyName"
          editable={!busy}
        />
      </Surface>

      <Surface
        fill="solid"
        elevation="raised"
        radius="card"
        padding={theme.spacing.xl}
        style={{ gap: theme.spacing.lg }}
      >
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          Your studies
        </AppText>
        <Input
          label="Institution"
          value={institution}
          onChangeText={setInstitution}
          placeholder="UniPilot Test University"
          autoCapitalize="words"
          editable={!busy}
        />
        <Input
          label="Course / program"
          value={courseProgram}
          onChangeText={setCourseProgram}
          placeholder="Computer Science"
          autoCapitalize="words"
          editable={!busy}
        />
        <ChoiceRow
          label="Academic year"
          options={YEAR_OPTIONS}
          value={academicYear}
          onChange={setAcademicYear}
          disabled={busy}
        />
        <ChoiceRow
          label="Semester"
          options={SEMESTER_OPTIONS_}
          value={semester}
          onChange={setSemester}
          disabled={busy}
        />
      </Surface>

      <Surface
        fill="solid"
        elevation="raised"
        radius="card"
        padding={theme.spacing.xl}
        style={{ gap: theme.spacing.lg }}
      >
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          Planning
        </AppText>
        <ChoiceRow
          label="Planning style"
          options={STYLE_OPTIONS}
          value={planningStyle}
          onChange={setPlanningStyle}
          disabled={busy}
        />
        <ChoiceRow
          label="Remind me before deadlines"
          options={LEAD_OPTIONS}
          value={reminderLead}
          onChange={setReminderLead}
          disabled={busy}
        />
      </Surface>

      <Surface
        fill="solid"
        elevation="raised"
        radius="card"
        padding={theme.spacing.xl}
        style={{ gap: theme.spacing.lg }}
      >
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          Subjects
        </AppText>
        <Input
          label="Add a subject"
          value={subjectInput}
          onChangeText={setSubjectInput}
          placeholder="Linear Algebra"
          autoCapitalize="words"
          returnKeyType="done"
          editable={!busy}
          onSubmitEditing={addSubjectRow}
        />
        <Button
          label="Add subject"
          variant="outline"
          size="sm"
          disabled={busy}
          onPress={addSubjectRow}
          style={{ alignSelf: "flex-start" }}
        />
        {subjects.length === 0 ? (
          <AppText variant="mono" color={theme.colors.mutedForeground}>
            No subjects yet — add the courses you want planned around.
          </AppText>
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            {subjects.map((subject) => (
              <View
                key={subject}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: theme.spacing.sm,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.muted,
                  borderRadius: theme.radii.nested,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                }}
              >
                <AppText variant="bodyMd" style={{ flex: 1 }}>
                  {subject}
                </AppText>
                <Button
                  label="Remove"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onPress={() => removeSubject(subject)}
                  accessibilityLabel={`Remove ${subject}`}
                />
              </View>
            ))}
          </View>
        )}
      </Surface>

      <Button
        label={busy ? "Saving…" : "Finish setup"}
        onPress={() => void save()}
        disabled={busy}
        style={{ alignSelf: "stretch" }}
      />

      {notice !== null ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
    </View>
  );
}
