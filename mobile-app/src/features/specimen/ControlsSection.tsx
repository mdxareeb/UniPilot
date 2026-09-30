import { View } from "react-native";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Divider } from "@/components/Divider";
import { ListRow } from "@/components/ListRow";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/theme/ThemeProvider";
import { SpecimenSection } from "./SpecimenSection";

type ControlsSectionProps = {
  index: number;
  onAction: (message: string) => void;
};

/** Buttons, badges and list rows — every control answers its press. */
export function ControlsSection({ index, onAction }: ControlsSectionProps) {
  const theme = useTheme();

  return (
    <SpecimenSection title="Controls" index={index}>
      <View style={{ gap: theme.spacing.md }}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: theme.spacing.sm,
          }}
        >
          <Button
            label="Primary"
            onPress={() => onAction("Primary button pressed.")}
          />
          <Button
            label="Outline"
            variant="outline"
            onPress={() => onAction("Outline button pressed.")}
          />
          <Button
            label="Ghost"
            variant="ghost"
            onPress={() => onAction("Ghost button pressed.")}
          />
          <Button
            label="Delete"
            variant="destructive"
            onPress={() => onAction("Destructive button pressed.")}
          />
          <Button label="Small" size="sm" variant="outline" onPress={() => onAction("Small button pressed.")} />
          <Button label="Disabled" disabled onPress={() => undefined} />
        </View>

        <View
          style={{
            flexDirection: "row",
            gap: theme.spacing.sm,
            alignItems: "center",
          }}
        >
          <Badge>badge</Badge>
          <Badge tone="inverted">inverted</Badge>
        </View>

        <Surface
          fill="solid"
          elevation="raised"
          radius="card"
          padding={0}
          style={{ overflow: "hidden" }}
        >
          <ListRow
            title="Row with action"
            subtitle="Opens something real"
            onPress={() => onAction("Row with action pressed.")}
          />
          <Divider />
          <ListRow
            title="Row with value"
            subtitle="Status text sits in Geist Mono"
            value="Ready"
            disabled
            showChevron={false}
          />
          <Divider />
          <ListRow
            title="Disabled row"
            subtitle="Not built yet — says so"
            value="Later"
            disabled
          />
        </Surface>
      </View>
    </SpecimenSection>
  );
}
