import { useState } from "react";
import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Divider } from "@/components/Divider";
import { Notice } from "@/components/Notice";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/theme/ThemeProvider";

import { candidateMeta, type DecisionOutcome } from "./reviewActions";
import type { GroupCandidateItem } from "./types";

type ReviewCardProps = {
  items: GroupCandidateItem[];
  onDecide: (id: string, decision: "confirm" | "reject") => Promise<DecisionOutcome>;
};

/**
 * Suggestions the pipeline was not sure enough to add by itself. Add puts the
 * item in Tasks or Calendar; Dismiss is final (it is never suggested again), so
 * it asks first, in place.
 */
export function ReviewCard({ items, onDecide }: ReviewCardProps) {
  const theme = useTheme();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(
    null,
  );

  const decide = async (id: string, decision: "confirm" | "reject") => {
    setBusyId(id);
    setMessage(null);
    const outcome = await onDecide(id, decision);
    setBusyId(null);
    setConfirmingId(null);
    if (outcome.message !== null && outcome.tone !== null) {
      setMessage({ text: outcome.message, tone: outcome.tone });
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {items.length > 0 ? (
        <Surface
          fill="solid"
          elevation="raised"
          radius="card"
          padding={0}
          style={{ overflow: "hidden" }}
        >
          {items.map((item, index) => {
            const busy = busyId === item.id;
            const confirming = confirmingId === item.id;
            return (
              <View key={item.id}>
                {index > 0 ? <Divider /> : null}
                <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
                  <AppText variant="bodyMd">{item.title}</AppText>
                  <AppText variant="mono" color={theme.colors.mutedForeground}>
                    {candidateMeta(item)}
                  </AppText>
                  {item.messageText !== "" ? (
                    <AppText
                      variant="mono"
                      color={theme.colors.mutedForeground}
                      numberOfLines={3}
                    >
                      {item.sender !== "" ? `${item.sender}: ` : ""}
                      {item.messageText}
                    </AppText>
                  ) : null}
                  {item.confidencePercent !== null ? (
                    <Badge>{`${item.confidencePercent}% sure`}</Badge>
                  ) : null}
                  {confirming ? (
                    <View style={{ gap: theme.spacing.sm }}>
                      <AppText variant="bodyMd">
                        Dismiss this for good? It won&apos;t be suggested again.
                      </AppText>
                      <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
                        <Button
                          label="Dismiss"
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onPress={() => void decide(item.id, "reject")}
                        />
                        <Button
                          label="Keep"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onPress={() => setConfirmingId(null)}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
                      <Button
                        label={busy ? "Adding…" : "Add"}
                        size="sm"
                        disabled={busy}
                        accessibilityLabel={`Add ${item.title}`}
                        onPress={() => void decide(item.id, "confirm")}
                      />
                      <Button
                        label="Dismiss"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        accessibilityLabel={`Dismiss ${item.title}`}
                        onPress={() => setConfirmingId(item.id)}
                      />
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </Surface>
      ) : (
        <Notice>Nothing to review. Suggestions the app isn&apos;t sure about show up here.</Notice>
      )}
      {message !== null ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </View>
  );
}
