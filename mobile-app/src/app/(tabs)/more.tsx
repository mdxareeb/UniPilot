import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  LogOut,
  Palette,
  Pencil,
  Plug,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react-native";

import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { Input } from "@/components/Input";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { AccordionSection } from "@/components/ui/AccordionSection";
import { AppButton } from "@/components/ui/AppButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Card } from "@/components/ui/Card";
import { FilterChip } from "@/components/ui/FilterChip";
import { StatusPill } from "@/components/ui/StatusPill";
import { parseProfileEdit } from "@/features/profile/profileEdit";
import { IntegrationRows } from "@/features/workspace/IntegrationRows";
import { probeApiHealth, type ApiHealth } from "@/features/workspace/health";
import { useIntegrationStatuses } from "@/features/workspace/useIntegrationStatuses";
import { useWorkspaceCounts } from "@/features/workspace/useWorkspaceCounts";
import { statValue } from "@/features/home/homeValues";
import {
  AI_SCOPE_LABELS,
  AI_SCOPE_MODES,
  loadAiScopeMode,
  saveAiScopeMode,
  THEME_MODES,
  type AiScopeMode,
  type ThemeMode,
} from "@/lib/preferences";
import { appIdentity, isSupabaseConfigured } from "@/lib/supabase";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

const THEME_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

function initialsOf(name: string | null, email: string | undefined): string {
  if (name !== null) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    if (parts.length > 1) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
  }
  return email?.slice(0, 2).toUpperCase() ?? "UP";
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, gap: theme.spacing.xxs }}>
      <AppText variant="headlineMd">{value}</AppText>
      <AppText variant="caps" color={theme.colors.mutedForeground}>
        {label}
      </AppText>
    </View>
  );
}

function InfoRow({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xxs }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: theme.spacing.md,
        }}
      >
        <AppText variant="bodyMd">{label}</AppText>
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          {value}
        </AppText>
      </View>
      {subtitle ? (
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * More: a compact profile summary over four accordions. The registry still
 * owns integrations, the settings are the same tokens, and nothing is hidden
 * behind a fake success: counts show an em dash when a read fails, and the
 * health probe only turns green after the Bearer route answers.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const { user, profile, profileError, signOut, saveProfile } = useAuth();
  const counts = useWorkspaceCounts();
  const { whatsapp, google, checkedAt } = useIntegrationStatuses();
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [aiScope, setAiScope] = useState<AiScopeMode>("all");
  const [planned, setPlanned] = useState<{
    name: string;
    description: string;
    note: string;
  } | null>(null);

  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [editError, setEditError] = useState<{
    field: "name" | "timezone";
    message: string;
  } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadAiScopeMode().then((mode) => {
      if (active) setAiScope(mode);
    });
    return () => {
      active = false;
    };
  }, []);

  const checkHealth = useCallback(async () => {
    setHealthBusy(true);
    const result = await probeApiHealth();
    setHealth(result);
    setHealthBusy(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setHealthBusy(true);
      void probeApiHealth().then((result) => {
        if (!active) return;
        setHealth(result);
        setHealthBusy(false);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const openEdit = () => {
    setFirstName(profile?.firstName ?? "");
    setLastName(profile?.lastName ?? "");
    setTimezone(profile?.timezone ?? "UTC");
    setEditError(null);
    setEditSaveError(null);
    setEditOpen(true);
  };

  const academic = [
    profile?.courseProgram ?? null,
    profile?.academicYear !== null && profile?.academicYear !== undefined
      ? `Year ${profile.academicYear}`
      : null,
    profile?.semester !== null && profile?.semester !== undefined
      ? `Semester ${profile.semester}`
      : null,
  ].filter((value): value is string => value !== null);

  const onSaveProfile = async () => {
    const parsed = parseProfileEdit({ firstName, lastName, timezone });
    if (!parsed.ok) {
      setEditError({ field: parsed.field, message: parsed.message });
      return;
    }
    setEditError(null);
    setEditBusy(true);
    const result = await saveProfile(parsed.value);
    setEditBusy(false);
    if (result.error !== null) {
      setEditSaveError(result.error);
      return;
    }
    setEditOpen(false);
  };

  const onSignOut = async () => {
    if (signOutBusy) return;
    setSignOutBusy(true);
    setSignOutError(null);
    const result = await signOut();
    setSignOutBusy(false);
    if (result.error !== null) {
      setSignOutError(result.error);
      return;
    }
    setSignOutOpen(false);
  };

  const chooseAiScope = (mode: AiScopeMode) => {
    setAiScope(mode);
    void saveAiScopeMode(mode);
  };

  const healthStatus = (() => {
    if (health === null) return { label: "Checking…", tone: "outline" as const };
    if (health.status === "online") return { label: "Online", tone: "solid" as const };
    if (health.status === "offline") {
      return { label: "Unavailable", tone: "danger" as const };
    }
    return { label: "Not configured", tone: "outline" as const };
  })();

  return (
    <Screen>
      <PageHeading
        eyebrow="Workspace"
        title="More"
        description="Your account, preferences and connections."
      />

      <MotionEnter index={1}>
        <Card>
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.md,
              }}
            >
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: theme.colors.inverted,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AppText variant="headlineMd" color={theme.colors.onInverted}>
                  {initialsOf(profile?.fullName ?? null, user?.email)}
                </AppText>
              </View>
              <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                <AppText variant="headlineMd">
                  {profile?.fullName ?? "Your account"}
                </AppText>
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  {academic.length > 0
                    ? academic.join(" · ")
                    : "Academic details not set"}
                </AppText>
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  {user?.email ?? "No email"}
                </AppText>
              </View>
              <AppButton
                label="Edit"
                variant="secondary"
                size="sm"
                leading={<Pencil size={14} color={theme.colors.foreground} />}
                onPress={openEdit}
                accessibilityLabel="Edit profile"
              />
            </View>
            {profileError !== null ? <Notice tone="error">{profileError}</Notice> : null}
          </View>
        </Card>
      </MotionEnter>

      <MotionEnter index={2}>
        <AccordionSection
          title="Profile & academic details"
          subtitle="Who you are and what you study"
          icon={<UserRound size={18} color={theme.colors.foreground} />}
          defaultOpen
        >
          <InfoRow label="Email" value={user?.email ?? "No email"} />
          <Divider />
          <InfoRow
            label="Institution"
            value={profile?.institution ?? "Not set"}
          />
          <Divider />
          <InfoRow
            label="Program"
            value={profile?.courseProgram ?? "Not set"}
          />
          <Divider />
          <InfoRow
            label="Year & semester"
            value={
              profile?.academicYear !== null &&
              profile?.academicYear !== undefined
                ? `Year ${profile.academicYear} · Semester ${profile.semester ?? "—"}`
                : "Not set"
            }
          />
          <Divider />
          <InfoRow label="Timezone" value={profile?.timezone ?? "UTC"} />
          <Divider />
          <View
            style={{
              flexDirection: "row",
              gap: theme.spacing.md,
              paddingVertical: theme.spacing.xs,
            }}
          >
            <Stat label="Subjects" value={statValue(counts.subjects)} />
            <Stat label="Synced tasks" value={statValue(counts.syncedTasks)} />
            <Stat label="Indexed docs" value={statValue(counts.indexedDocs)} />
          </View>
          <AppButton
            label="Edit profile"
            variant="secondary"
            fullWidth
            leading={<Pencil size={14} color={theme.colors.foreground} />}
            onPress={openEdit}
          />
        </AccordionSection>
      </MotionEnter>

      <MotionEnter index={3}>
        <AccordionSection
          title="Appearance & app preferences"
          subtitle="Theme, Ask AI and review behaviour"
          icon={<Palette size={18} color={theme.colors.foreground} />}
        >
          <AppText variant="bodyMd">Appearance</AppText>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: theme.spacing.sm,
            }}
          >
            {THEME_MODES.map((mode) => (
              <FilterChip
                key={mode}
                label={THEME_LABELS[mode]}
                active={theme.mode === mode}
                onPress={() => theme.setMode(mode)}
                accessibilityLabel={`${THEME_LABELS[mode]} theme`}
              />
            ))}
          </View>
          <Divider />
          <AppText variant="bodyMd">Ask AI opening scope</AppText>
          <AppText variant="mono" color={theme.colors.mutedForeground}>
            Start every conversation with all materials, or resume the scope you
            used last.
          </AppText>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: theme.spacing.sm,
            }}
          >
            {AI_SCOPE_MODES.map((mode) => (
              <FilterChip
                key={mode}
                label={AI_SCOPE_LABELS[mode]}
                active={aiScope === mode}
                onPress={() => chooseAiScope(mode)}
                accessibilityLabel={`Ask AI scope: ${AI_SCOPE_LABELS[mode]}`}
              />
            ))}
          </View>
          <Divider />
          <InfoRow
            label="WhatsApp review"
            value="Manual"
            subtitle="Items under 85% confidence wait for your review."
          />
        </AccordionSection>
      </MotionEnter>

      <MotionEnter index={4}>
        <AccordionSection
          title="Connected accounts & sync"
          subtitle="WhatsApp, Google Calendar and reserved providers"
          icon={<Plug size={18} color={theme.colors.foreground} />}
        >
          <IntegrationRows
            context={{ whatsapp, google }}
            checkedAt={checkedAt}
            timeZone={profile?.timezone ?? "UTC"}
            onPlanned={setPlanned}
          />
        </AccordionSection>
      </MotionEnter>

      <MotionEnter index={5}>
        <AccordionSection
          title="Account, diagnostics & support"
          subtitle="Health, retention, version and sign out"
          icon={<ShieldCheck size={18} color={theme.colors.foreground} />}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: theme.spacing.md,
            }}
          >
            <View style={{ flex: 1, gap: theme.spacing.xxs }}>
              <AppText variant="bodyMd">Backend health</AppText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: theme.spacing.sm,
                }}
              >
                <StatusPill label={healthStatus.label} tone={healthStatus.tone} />
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  {health === null
                    ? "Checking the API"
                    : health.aiConfigured
                      ? "AI ready"
                      : "AI not configured"}
                </AppText>
              </View>
            </View>
            <AppButton
              label="Check"
              variant="secondary"
              size="sm"
              loading={healthBusy}
              leading={<RefreshCw size={14} color={theme.colors.foreground} />}
              onPress={() => void checkHealth()}
              accessibilityLabel="Check backend health"
            />
          </View>
          <Divider />
          <InfoRow
            label="Supabase"
            value={isSupabaseConfigured ? "Configured" : "Not configured"}
          />
          <Divider />
          <InfoRow
            label="Raw messages"
            value="30-day retention"
            subtitle="Captured WhatsApp text is purged after 30 days; deadlines and documents stay."
          />
          <Divider />
          <InfoRow label="Version" value={appIdentity.version} />
          <Divider />
          <InfoRow label="Package" value={appIdentity.packageId} />
          <Divider />
          <AppButton
            label="Sign out"
            variant="destructive"
            fullWidth
            leading={<LogOut size={16} color={theme.colors.onDestructive} />}
            onPress={() => {
              setSignOutError(null);
              setSignOutOpen(true);
            }}
          />
        </AccordionSection>
      </MotionEnter>

      <MotionEnter index={6}>
        <AppText
          variant="caps"
          color={theme.colors.mutedForeground}
          style={{ textAlign: "center" }}
        >
          UniPilot mobile · Home hub
        </AppText>
      </MotionEnter>

      <BottomSheet
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit profile"
        subtitle="Name and timezone"
      >
        <Input
          label="First name"
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          autoComplete="given-name"
          error={editError?.field === "name" ? editError.message : null}
        />
        <Input
          label="Last name"
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
          autoComplete="family-name"
        />
        <Input
          label="Timezone"
          value={timezone}
          onChangeText={setTimezone}
          placeholder="Asia/Kolkata"
          autoCapitalize="none"
          error={editError?.field === "timezone" ? editError.message : null}
        />
        {editSaveError !== null ? <Notice tone="error">{editSaveError}</Notice> : null}
        <AppButton
          label="Save profile"
          loading={editBusy}
          fullWidth
          onPress={() => void onSaveProfile()}
        />
      </BottomSheet>

      <BottomSheet
        visible={planned !== null}
        onClose={() => setPlanned(null)}
        title={planned?.name ?? ""}
        subtitle="Planned"
      >
        <StatusPill label="Planned" tone="planned" />
        <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
          {planned?.description ?? ""}
        </AppText>
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          {planned?.note ?? ""}
        </AppText>
        <AppButton
          label="Got it"
          variant="secondary"
          fullWidth
          onPress={() => setPlanned(null)}
        />
      </BottomSheet>

      <BottomSheet
        visible={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title="Sign out?"
        subtitle="This device will need your credentials again"
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
        >
          <ShieldCheck size={18} color={theme.colors.mutedForeground} />
          <AppText
            variant="mono"
            color={theme.colors.mutedForeground}
            style={{ flex: 1 }}
          >
            Tasks, events and files stay in your account; only the session on
            this phone ends.
          </AppText>
        </View>
        {signOutError !== null ? <Notice tone="error">{signOutError}</Notice> : null}
        <AppButton
          label="Sign out"
          variant="destructive"
          fullWidth
          loading={signOutBusy}
          onPress={() => void onSignOut()}
        />
        <AppButton
          label="Keep me signed in"
          variant="secondary"
          fullWidth
          disabled={signOutBusy}
          onPress={() => setSignOutOpen(false)}
        />
      </BottomSheet>
    </Screen>
  );
}
