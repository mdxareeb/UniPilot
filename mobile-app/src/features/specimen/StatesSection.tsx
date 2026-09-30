import { View } from "react-native";
import { CircleSlash } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { Surface } from "@/components/Surface";
import { MotionEnter } from "@/motion/MotionEnter";
import { useReduceMotion } from "@/motion/useReduceMotion";
import { useTheme } from "@/theme/ThemeProvider";
import { SpecimenSection } from "./SpecimenSection";

/** Empty and error states, plus the motion ladder and its reduced-motion read. */
export function StatesSection({ index }: { index: number }) {
  const theme = useTheme();
  const reduced = useReduceMotion();

  return (
    <SpecimenSection title="States" index={index}>
      <View style={{ gap: theme.spacing.md }}>
        <EmptyState
          icon={<CircleSlash size={24} color={theme.colors.mutedForeground} />}
          title="Nothing here yet"
          body="The empty-state pattern a real surface shows before it has data."
          footnote="Empty state"
        />
        <Notice tone="error">
          Something went wrong. Nothing was saved — the error-state pattern.
        </Notice>
        <Notice>The informational state: one sentence, never a status claim.</Notice>
      </View>

      <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <AppText variant="caps" color={theme.colors.mutedForeground}>
            Reduced motion
          </AppText>
          <AppText variant="mono" color={theme.colors.foreground}>
            {reduced ? "on" : "off"}
          </AppText>
        </View>

        <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
          {[0, 1, 2].map((slot) => (
            <MotionEnter
              key={slot}
              index={slot}
              variant={slot === 1 ? "scale" : "up"}
              style={{ flex: 1 }}
            >
              <Surface
                fill="solid"
                elevation="raised"
                radius="nested"
                padding={theme.spacing.md}
                style={{ alignItems: "center" }}
              >
                <AppText variant="mono">{`slot ${slot}`}</AppText>
              </Surface>
            </MotionEnter>
          ))}
        </View>
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          Entrance ladder 0→2 at 60ms stagger, 400ms ease-out. With reduced
          motion every slot renders instantly in its final position.
        </AppText>
      </View>
    </SpecimenSection>
  );
}
