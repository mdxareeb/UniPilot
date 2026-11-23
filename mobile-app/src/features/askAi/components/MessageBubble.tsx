import { useMemo } from "react";
import { View } from "react-native";
import { Sparkles } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Notice } from "@/components/Notice";
import { Surface } from "@/components/Surface";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";
import { groupCitations, type CitationGroup } from "../citations";
import type { ChatMessage } from "../chatValues";
import { CitationPills } from "./CitationPills";
import { FormattedMessage } from "./FormattedMessage";

function AssistantIdentity() {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.xs + 2,
      }}
    >
      <Sparkles size={13} color={theme.colors.mutedForeground} />
      <AppText variant="caps" color={theme.colors.mutedForeground}>
        Ask AI
      </AppText>
    </View>
  );
}

/** One persisted turn: the user's bubble or the assistant's editorial answer. */
export function MessageBubble({
  message,
  onCitation,
}: {
  message: ChatMessage;
  onCitation: (group: CitationGroup) => void;
}) {
  const theme = useTheme();
  const groups = useMemo(
    () => groupCitations(message.sources),
    [message.sources],
  );

  if (message.role === "user") {
    return (
      <MotionEnter index={0} style={{ alignItems: "flex-end" }}>
        <View style={{ maxWidth: "88%", gap: theme.spacing.xs }}>
          <Surface
            fill="inverted"
            elevation="flush"
            radius="card"
            padding={theme.spacing.md + 2}
          >
            <AppText
              variant="bodyMd"
              color={theme.colors.onInverted}
              selectable
            >
              {message.content}
            </AppText>
          </Surface>
          <AppText
            variant="caps"
            color={theme.colors.mutedForeground}
            style={{ textAlign: "right" }}
          >
            You
          </AppText>
        </View>
      </MotionEnter>
    );
  }

  return (
    <MotionEnter index={0} style={{ gap: theme.spacing.sm }}>
      <AssistantIdentity />
      {message.status === "failed" ? (
        <Notice tone="error">{message.content}</Notice>
      ) : (
        <FormattedMessage content={message.content} />
      )}
      {message.status === "complete" ? (
        groups.length > 0 ? (
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="caps" color={theme.colors.mutedForeground}>
              Sources
            </AppText>
            <CitationPills groups={groups} onPress={onCitation} />
          </View>
        ) : null
      ) : null}
    </MotionEnter>
  );
}
