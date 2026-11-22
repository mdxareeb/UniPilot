/**
 * Google Calendar (More -> Integrations): link the account, choose which
 * calendars import, opt in to exporting UniPilot deadlines to a dedicated
 * calendar, and Sync Now. Every state is the server's real one; nothing is
 * faked while a sync is in flight.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { CalendarDays, ChevronLeft } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { Switch } from "@/components/Switch";
import { AppButton } from "@/components/ui/AppButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/StatusPill";
import { gcalSyncedLabel, GCAL_COPY } from "@/features/googleCalendar/gcalValues";
import { isGcalApiConfigured } from "@/features/googleCalendar/gcalClient";
import { useGcal } from "@/features/googleCalendar/useGcal";
import { tapFeedback } from "@/lib/haptics";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

export default function GoogleCalendarScreen() {
  const theme = useTheme();
  const router = useRouter();
  const gcal = useGcal();
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const onConnect = async () => {
    setActionError(null);
    setNotice(null);
    const { authorizationUrl, error } = await gcal.connect();
    if (error !== null || authorizationUrl === null) {
      setActionError(error ?? "Couldn't start the link.");
      return;
    }
    // The system browser runs the consent round trip; the callback returns
    // the app through unipilot://oauth/google. If the custom tab intercepts
    // that URL instead of the deep link, the refresh below still settles the
    // screen on the real server state.
    const result = await WebBrowser.openAuthSessionAsync(
      authorizationUrl,
      "unipilot://oauth/google",
    );
    if (result.type === "success") {
      await gcal.refresh();
    }
  };

  const onSync = async () => {
    setActionError(null);
    setNotice(null);
    const { outcome, error } = await gcal.sync();
    if (error !== null) {
      setActionError(error);
      return;
    }
    if (outcome === "throttled") setNotice(GCAL_COPY.SYNC_THROTTLED);
    if (outcome === "not_connected") setNotice(GCAL_COPY.SYNC_NOT_CONNECTED);
    if (outcome === "accepted") setNotice(GCAL_COPY.SYNC_ACCEPTED);
  };

  const onDisconnect = async () => {
    const result = await gcal.disconnect();
    setConfirmingDisconnect(false);
    if (result.error !== null) setActionError(result.error);
    else setNotice(GCAL_COPY.DISCONNECT_NOTE);
  };

  const view = gcal.view;

  return (
    <Screen>
      <PageHeading eyebrow="Integrations" title="Google Calendar" />

      <MotionEnter index={0} style={{ gap: theme.spacing.xs }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.xs }}
        >
          <ChevronLeft size={18} color={theme.colors.mutedForeground} />
          <AppText variant="mono" color={theme.colors.mutedForeground}>
            Integrations
          </AppText>
        </Pressable>
      </MotionEnter>

      {!isGcalApiConfigured ? (
        <MotionEnter index={1}>
          <Notice>{GCAL_COPY.NOT_CONFIGURED}</Notice>
        </MotionEnter>
      ) : gcal.loadError !== null ? (
        <MotionEnter index={1} style={{ gap: theme.spacing.sm }}>
          <Notice tone="error">{gcal.loadError}</Notice>
          <AppButton
            label="Try again"
            variant="secondary"
            fullWidth
            onPress={() => void gcal.refresh()}
          />
        </MotionEnter>
      ) : view === null || gcal.snapshot === null ? (
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          Loading…
        </AppText>
      ) : (
        <>
          <MotionEnter index={1}>
            <Card style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
              <StatusPill label={view.badge} tone={view.tone} dot />
              <AppText variant="headlineMd">{view.title}</AppText>
              <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
                {view.body}
              </AppText>
              {view.showConnect ? (
                <AppButton
                  label="Continue with Google"
                  fullWidth
                  leading={<CalendarDays size={16} color={theme.colors.onPrimary} />}
                  onPress={() => void onConnect()}
                />
              ) : null}
              {view.showDisconnect ? (
                <AppButton
                  label="Disconnect"
                  variant="destructive"
                  fullWidth
                  onPress={() => setConfirmingDisconnect(true)}
                />
              ) : null}
            </Card>
          </MotionEnter>

          {actionError !== null ? <Notice tone="error">{actionError}</Notice> : null}
          {notice !== null ? <Notice>{notice}</Notice> : null}

          {view.showPreferences ? (
            <MotionEnter index={2} style={{ gap: theme.spacing.sm }}>
              <AppText variant="caps" color={theme.colors.mutedForeground}>
                Sync
              </AppText>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: theme.spacing.md,
                    padding: theme.spacing.lg,
                  }}
                >
                  <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                    <AppText variant="bodyMd">Sync now</AppText>
                    <AppText variant="mono" color={theme.colors.mutedForeground}>
                      {gcalSyncedLabel(gcal.snapshot)}
                    </AppText>
                  </View>
                  <AppButton
                    label="Sync"
                    size="sm"
                    variant="secondary"
                    loading={gcal.busy}
                    onPress={() => void onSync()}
                  />
                </View>
                <Divider />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: theme.spacing.md,
                    padding: theme.spacing.lg,
                  }}
                >
                  <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                    <AppText variant="bodyMd">Export deadlines to Google</AppText>
                    <AppText variant="mono" color={theme.colors.mutedForeground}>
                      A dedicated &quot;UniPilot&quot; calendar; never re-exports
                      Google&apos;s own events.
                    </AppText>
                  </View>
                  <Switch
                    value={gcal.snapshot.autoExport}
                    disabled={gcal.busy}
                    onValueChange={(next) => {
                      tapFeedback();
                      void gcal.setAutoExport(next).then((result) => {
                        if (result.error !== null) setActionError(result.error);
                      });
                    }}
                    accessibilityLabel="Export deadlines to Google Calendar"
                  />
                </View>
              </Card>
            </MotionEnter>
          ) : null}

          {view.showCalendars && gcal.calendars.length > 0 ? (
            <MotionEnter index={3} style={{ gap: theme.spacing.sm }}>
              <AppText variant="caps" color={theme.colors.mutedForeground}>
                Calendars
              </AppText>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {gcal.calendars.map((calendar, index) => (
                  <View key={calendar.id}>
                    {index > 0 ? <Divider /> : null}
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: theme.spacing.md,
                        padding: theme.spacing.lg,
                      }}
                    >
                      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                        <AppText variant="bodyMd">
                          {calendar.summary || calendar.googleCalendarId}
                        </AppText>
                        <AppText variant="mono" color={theme.colors.mutedForeground}>
                          {calendar.isActive ? "Importing" : "Off"}
                        </AppText>
                      </View>
                      <Switch
                        value={calendar.isActive}
                        disabled={gcal.busy}
                        onValueChange={(next) => {
                          tapFeedback();
                          void gcal.setCalendarActive(calendar.id, next).then((result) => {
                            if (result.error !== null) setActionError(result.error);
                          });
                        }}
                        accessibilityLabel={`Import ${calendar.summary || calendar.googleCalendarId}`}
                      />
                    </View>
                  </View>
                ))}
              </Card>
              <AppText variant="mono" color={theme.colors.mutedForeground}>
                Secondary and holiday calendars start off; turn on only what you want.
              </AppText>
            </MotionEnter>
          ) : null}
        </>
      )}

      <BottomSheet
        visible={confirmingDisconnect}
        onClose={() => setConfirmingDisconnect(false)}
        title="Disconnect Google Calendar?"
        subtitle="The stored authorization is revoked"
      >
        <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
          {GCAL_COPY.DISCONNECT_NOTE}
        </AppText>
        <AppButton
          label="Disconnect"
          variant="destructive"
          fullWidth
          onPress={() => void onDisconnect()}
        />
        <AppButton
          label="Keep connected"
          variant="secondary"
          fullWidth
          onPress={() => setConfirmingDisconnect(false)}
        />
      </BottomSheet>
    </Screen>
  );
}
