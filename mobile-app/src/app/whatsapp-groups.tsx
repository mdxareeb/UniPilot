import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { Surface } from "@/components/Surface";
import { GroupsCard } from "@/features/whatsappGroups/GroupsCard";
import { PairingCodeCard } from "@/features/whatsappGroups/PairingCodeCard";
import { PhoneLinkForm } from "@/features/whatsappGroups/PhoneLinkForm";
import { ReviewCard } from "@/features/whatsappGroups/ReviewCard";
import { effectiveView } from "@/features/whatsappGroups/stateView";
import { useGroupSync } from "@/features/whatsappGroups/useGroupSync";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

const SECTION_LABEL = { marginBottom: 8 } as const;

/**
 * WhatsApp groups (More → Integrations). Link with a pairing code, switch
 * college groups on, and review suggestions. The phone never needs a QR: the
 * code is typed (or pasted) into WhatsApp > Linked devices > Link with phone
 * number.
 */
export default function WhatsAppGroupsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const sync = useGroupSync();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const snapshot = sync.snapshot;
  const view = snapshot === null ? null : effectiveView(snapshot);

  const onDisconnect = async () => {
    setDisconnectBusy(true);
    setActionError(null);
    const result = await sync.disconnect();
    setDisconnectBusy(false);
    setConfirmingDisconnect(false);
    if (result.error !== null) setActionError(result.error);
    else setNotice(result.notice ?? null);
  };

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to More"
        onPress={() => router.back()}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.xs,
          alignSelf: "flex-start",
        }}
      >
        <ChevronLeft size={16} color={theme.colors.mutedForeground} />
        <AppText variant="label" color={theme.colors.mutedForeground}>
          More
        </AppText>
      </Pressable>

      <PageHeading
        eyebrow="Integrations"
        title="WhatsApp groups"
        description="Deadlines, exams and files from your college groups, sorted by subject."
      />

      {!sync.configured ? (
        <MotionEnter index={1}>
          <Notice tone="error">
            This build isn&apos;t connected to the UniPilot server (no API address), so
            WhatsApp groups can&apos;t load.
          </Notice>
        </MotionEnter>
      ) : snapshot === null || view === null ? (
        <MotionEnter index={1}>
          {sync.loadError !== null ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Notice tone="error">{sync.loadError}</Notice>
              <Button
                label="Try again"
                variant="outline"
                onPress={() => void sync.refresh()}
                style={{ alignSelf: "stretch" }}
              />
            </View>
          ) : (
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              Loading…
            </AppText>
          )}
        </MotionEnter>
      ) : (
        <>
          <MotionEnter index={1}>
            <Surface
              fill="solid"
              elevation="raised"
              radius="card"
              padding={theme.spacing.xl}
              style={{ gap: theme.spacing.md }}
            >
              <Badge>{view.badge}</Badge>
              <AppText variant="headlineMd">{view.title}</AppText>
              <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
                {view.body}
              </AppText>
              {view.showPhoneForm ? (
                <PhoneLinkForm onSubmit={sync.link} lastError={snapshot.lastError} />
              ) : null}
              {view.showDisconnect ? (
                confirmingDisconnect ? (
                  <View style={{ gap: theme.spacing.sm }}>
                    <AppText variant="bodyMd">
                      {snapshot.state === "connected"
                        ? "Disconnect WhatsApp? Captured message text is deleted. Tasks, events and files already saved stay."
                        : "Cancel this link?"}
                    </AppText>
                    <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
                      <Button
                        label={disconnectBusy ? "Working…" : view.disconnectLabel}
                        variant="destructive"
                        size="sm"
                        disabled={disconnectBusy}
                        onPress={() => void onDisconnect()}
                      />
                      <Button
                        label="Keep"
                        variant="outline"
                        size="sm"
                        disabled={disconnectBusy}
                        onPress={() => setConfirmingDisconnect(false)}
                      />
                    </View>
                  </View>
                ) : (
                  <Button
                    label={view.disconnectLabel}
                    variant="outline"
                    onPress={() => setConfirmingDisconnect(true)}
                    style={{ alignSelf: "stretch" }}
                  />
                )
              ) : null}
            </Surface>
          </MotionEnter>

          {view.showCode && snapshot.pairing !== null ? (
            <MotionEnter index={2}>
              <PairingCodeCard pairing={snapshot.pairing} />
            </MotionEnter>
          ) : null}

          {actionError !== null ? <Notice tone="error">{actionError}</Notice> : null}
          {notice !== null ? <Notice>{notice}</Notice> : null}
          {sync.loadError !== null ? <Notice tone="error">{sync.loadError}</Notice> : null}

          {view.showGroups ? (
            <MotionEnter index={3}>
              <AppText
                variant="caps"
                color={theme.colors.mutedForeground}
                style={SECTION_LABEL}
              >
                Groups
              </AppText>
              <GroupsCard groups={snapshot.groups} onToggle={sync.setGroup} />
            </MotionEnter>
          ) : null}

          {view.showReview && (snapshot.review.length > 0 || view.showGroups) ? (
            <MotionEnter index={4}>
              <AppText
                variant="caps"
                color={theme.colors.mutedForeground}
                style={SECTION_LABEL}
              >
                Needs your review
              </AppText>
              <ReviewCard items={snapshot.review} onDecide={sync.decide} />
            </MotionEnter>
          ) : null}
        </>
      )}
    </Screen>
  );
}
