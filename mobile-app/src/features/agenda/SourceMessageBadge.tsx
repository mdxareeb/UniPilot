import { useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/AppText";
import { Badge } from "@/components/Badge";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";

import { WHATSAPP_MARK } from "./agenda";
import { fetchOriginalMessage } from "./queries";
import {
  ORIGINAL_GONE_COPY,
  toOriginalMessage,
  type OriginalMessage,
} from "./sourceMessage";

type Phase =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "ready"; message: OriginalMessage }
  | { kind: "gone" }
  | { kind: "error"; message: string };

/**
 * The "From WhatsApp" marker, made tappable: one tap reveals the captured
 * message it came from (sender, text, when). Reading `raw_messages` is
 * owner-scoped; after the 30-day purge the snippet honestly says so instead of
 * pretending the source still exists.
 */
export function SourceMessageBadge({ messageId }: { messageId: string }) {
  const theme = useTheme();
  const { profile } = useAuth();
  const timeZone = profile?.timezone ?? "UTC";
  const [phase, setPhase] = useState<Phase>({ kind: "closed" });
  const request = useRef(0);

  const toggle = async () => {
    if (phase.kind !== "closed") {
      request.current += 1;
      setPhase({ kind: "closed" });
      return;
    }

    const mine = ++request.current;
    setPhase({ kind: "loading" });
    const result = await fetchOriginalMessage(messageId);
    if (mine !== request.current) return;
    if (result.error !== null) {
      setPhase({ kind: "error", message: result.error });
      return;
    }
    if (result.row === null) {
      setPhase({ kind: "gone" });
      return;
    }
    setPhase({ kind: "ready", message: toOriginalMessage(result.row, timeZone) });
  };

  const expanded = phase.kind !== "closed";

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Pressable
        onPress={() => void toggle()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${WHATSAPP_MARK}: view the original message`}
        accessibilityState={{ expanded }}
      >
        <Badge>{WHATSAPP_MARK}</Badge>
      </Pressable>
      {phase.kind === "loading" ? (
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          Loading the original…
        </AppText>
      ) : null}
      {phase.kind === "gone" ? (
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          {ORIGINAL_GONE_COPY}
        </AppText>
      ) : null}
      {phase.kind === "error" ? (
        <AppText variant="mono" color={theme.colors.destructive}>
          {phase.message}
        </AppText>
      ) : null}
      {phase.kind === "ready" ? (
        <View
          style={{
            gap: theme.spacing.xs,
            padding: theme.spacing.md,
            borderRadius: theme.radii.nested,
            backgroundColor: theme.colors.muted,
          }}
          accessibilityLabel={`Original message from ${phase.message.sender}, ${phase.message.sentLabel}`}
        >
          <AppText variant="caps" color={theme.colors.mutedForeground}>
            {`${phase.message.sender} · ${phase.message.sentLabel}`}
          </AppText>
          <AppText variant="bodyMd">{phase.message.text}</AppText>
        </View>
      ) : null}
    </View>
  );
}
