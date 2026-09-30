import { View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "./AppText";
import { Surface } from "./Surface";

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  body: string;
  /** A mono technical footnote (e.g. the milestone that fills this surface). */
  footnote?: string;
};

/** The centred "nothing exists here yet" surface; content is never faked. */
export function EmptyState({ icon, title, body, footnote }: EmptyStateProps) {
  const theme = useTheme();

  return (
    <Surface
      fill="solid"
      elevation="raised"
      radius="card"
      padding={theme.spacing.xxl}
      style={{ alignItems: "center", gap: theme.spacing.md }}
    >
      {icon ? <View>{icon}</View> : null}
      <AppText variant="headlineMd" style={{ textAlign: "center" }}>
        {title}
      </AppText>
      <AppText
        variant="bodyMd"
        color={theme.colors.mutedForeground}
        style={{ textAlign: "center" }}
      >
        {body}
      </AppText>
      {footnote ? (
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          {footnote}
        </AppText>
      ) : null}
    </Surface>
  );
}
