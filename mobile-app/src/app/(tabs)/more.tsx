import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ChevronRight,
  LogOut,
  Pencil,

  ShieldCheck,
} from "lucide-react-native";

import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { Input } from "@/components/Input";
import { ListRow } from "@/components/ListRow";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { AppButton } from "@/components/ui/AppButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Card } from "@/components/ui/Card";
import { FilterChip } from "@/components/ui/FilterChip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusPill } from "@/components/ui/StatusPill";
import { parseProfileEdit } from "@/features/profile/profileEdit";
import { REGISTRY_ICONS } from "@/features/workspace/icons";
import {
  INTEGRATIONS_REGISTRY,
  relativeTime,
  TOOLS_REGISTRY,
  type WhatsAppStatus,
} from "@/features/workspace/registries";
import { isApiConfigured, whatsappApi } from "@/features/whatsappGroups/client";
import { confirmFeedback } from "@/lib/haptics";
import { appIdentity, isSupabaseConfigured, supabase } from "@/lib/supabase";
import { MotionEnter } from "@/motion/MotionEnter";
import { THEME_MODES, type ThemeMode } from "@/lib/preferences";
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

/**
 * More: the workspace and account hub. Profile, tools, integrations and
 * settings are registry/entry driven so a new tool or provider is one entry,
 * never a layout rewrite.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, profile, profileError, signOut, saveProfile } = useAuth();

  const [docCount, setDocCount] = useState<number | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);
  const [planned, setPlanned] = useState<{ name: string; description: string } | null>(
    null,
  );
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

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (supabase === null) {
        setDocCount(null);
      } else {
        void supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .then(({ count, error }) => {
            if (active && error === null) setDocCount(count ?? 0);
          });
      }

      if (!isApiConfigured) {
        setWhatsapp({
          configured: false,
          state: "unknown",
          pending: 0,
          lastSyncedAt: null,
          checkedAt: Date.now(),
        });
      } else {
        void whatsappApi
          .getSnapshot()
          .then((snapshot) => {
            if (!active) return;
            const stamps = snapshot.groups
              .map((group) => group.lastSyncedAt)
              .filter((value): value is string => value !== null)
              .sort();
            setWhatsapp({
              configured: true,
              state: snapshot.state,
              pending: snapshot.review.length,
              lastSyncedAt: stamps.length > 0 ? stamps[stamps.length - 1] : null,
              checkedAt: Date.now(),
            });
          })
          .catch(() => {
            if (active) {
              setWhatsapp({
                configured: true,
                state: "unknown",
                pending: 0,
                lastSyncedAt: null,
                checkedAt: Date.now(),
              });
            }
          });
      }

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
    confirmFeedback();
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

  return (
    <Screen>
      <PageHeading
        eyebrow="Workspace"
        title="More"
        description="Your profile, tools and connections."
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
                  width: 56,
                  height: 56,
                  borderRadius: 28,
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
                  {academic.length > 0 ? academic.join(" · ") : "Academic details not set"}
                </AppText>
                {profile?.institution ? (
                  <AppText variant="mono" color={theme.colors.mutedForeground}>
                    {profile.institution}
                  </AppText>
                ) : null}
              </View>
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: theme.spacing.md,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
                paddingTop: theme.spacing.md,
              }}
            >
              <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  {user?.email ?? "No email"}
                </AppText>
                <StatusPill
                  label={profile?.onboardingComplete ? "Setup complete" : "Setup unfinished"}
                  tone={profile?.onboardingComplete ? "neutral" : "warning"}
                />
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

      <MotionEnter index={2} style={{ gap: theme.spacing.sm }}>
        <SectionHeader label="Tools" />
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: theme.spacing.md,
          }}
        >
          {TOOLS_REGISTRY.map((tool) => {
            const Icon = REGISTRY_ICONS[tool.icon];
            const badge =
              tool.badge === "materials"
                ? docCount === null
                  ? null
                  : `${docCount} ${docCount === 1 ? "file" : "files"}`
                : null;
            return (
              <Pressable
                key={tool.id}
                onPress={() => {
                  if (tool.route) {
                    router.push(tool.route);
                  } else {
                    setPlanned({ name: tool.name, description: tool.description });
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`${tool.name}${tool.status === "planned" ? ", planned" : ""}`}
                style={{ flexGrow: 1, flexBasis: "46%" }}
              >
                <Card style={{ height: "100%" }}>
                  <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: theme.colors.muted,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon size={18} color={theme.colors.foreground} />
                    </View>
                    <AppText variant="bodyMd">{tool.name}</AppText>
                    <AppText
                      variant="mono"
                      color={theme.colors.mutedForeground}
                      numberOfLines={2}
                    >
                      {tool.description}
                    </AppText>
                    <View style={{ marginTop: "auto", paddingTop: theme.spacing.xs }}>
                      {tool.status === "planned" ? (
                        <StatusPill label="Planned" tone="planned" />
                      ) : badge !== null ? (
                        <StatusPill label={badge} tone="outline" />
                      ) : (
                        <StatusPill label="Live" tone="neutral" />
                      )}
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      </MotionEnter>

      <MotionEnter index={3} style={{ gap: theme.spacing.sm }}>
        <SectionHeader label="Integrations & devices" />
        <Card>
          {INTEGRATIONS_REGISTRY.map((integration, index) => {
            const Icon = REGISTRY_ICONS[integration.icon];
            const status = integration.statusResolver({ whatsapp });
            const lastSynced = integration.lastSyncedAt?.({ whatsapp }) ?? null;
            const live = integration.route !== undefined;
            return (
              <View key={integration.id}>
                {index > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => {
                    if (live && integration.route) {
                      router.push(integration.route);
                    } else {
                      setPlanned({
                        name: integration.name,
                        description: integration.description,
                      });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${integration.name}, ${status.label}`}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: theme.spacing.md,
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.md,
                    }}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: theme.colors.muted,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon size={18} color={theme.colors.foreground} />
                    </View>
                    <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                      <AppText variant="bodyMd">{integration.name}</AppText>
                      <AppText
                        variant="mono"
                        color={theme.colors.mutedForeground}
                        numberOfLines={1}
                      >
                        {integration.description}
                      </AppText>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: theme.spacing.sm,
                          marginTop: theme.spacing.xxs,
                        }}
                      >
                        <StatusPill label={status.label} tone={status.tone} />
                        {lastSynced !== null || live ? (
                          <AppText variant="mono" color={theme.colors.mutedForeground}>
                            {relativeTime(lastSynced, whatsapp?.checkedAt ?? 0, profile?.timezone ?? "UTC")}
                          </AppText>
                        ) : null}
                      </View>
                    </View>
                    <ChevronRight size={16} color={theme.colors.mutedForeground} />
                  </View>
                </Pressable>
              </View>
            );
          })}
        </Card>
      </MotionEnter>

      <MotionEnter index={4} style={{ gap: theme.spacing.sm }}>
        <SectionHeader label="Academic & sync" />
        <Card>
          <ListRow
            title="Timezone"
            subtitle="Every date the app renders uses this zone"
            value={profile?.timezone ?? "UTC"}
            disabled
            showChevron={false}
          />
          <Divider />
          <ListRow
            title="WhatsApp review"
            subtitle="Items under 85% confidence wait for your review"
            value="Manual"
            disabled
            showChevron={false}
          />
          <Divider />
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
            <AppText variant="bodyMd">Appearance</AppText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm }}>
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
          </View>
        </Card>
      </MotionEnter>

      <MotionEnter index={5} style={{ gap: theme.spacing.sm }}>
        <SectionHeader label="Account & diagnostics" />
        <Card>
          <ListRow title="Supabase" value={isSupabaseConfigured ? "Connected" : "Not configured"} disabled showChevron={false} />
          <Divider />
          <ListRow
            title="WhatsApp service"
            value={isApiConfigured ? "Configured" : "No API address"}
            disabled
            showChevron={false}
          />
          <Divider />
          <ListRow title="Version" value={appIdentity.version} disabled showChevron={false} />
          <Divider />
          <ListRow title="Package" value={appIdentity.packageId} disabled showChevron={false} />
        </Card>
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
      </MotionEnter>

      <MotionEnter index={6}>
        <AppText
          variant="caps"
          color={theme.colors.mutedForeground}
          style={{ textAlign: "center" }}
        >
          UniPilot mobile · M3
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
          This surface is reserved. It will appear here without changing the
          workspace layout.
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
          <ShieldCheck size={18} color={theme.colors.mutedForeground} />
          <AppText variant="mono" color={theme.colors.mutedForeground} style={{ flex: 1 }}>
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
