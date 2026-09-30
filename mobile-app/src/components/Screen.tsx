import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme/ThemeProvider";
import { Backdrop } from "./Backdrop";

type ScreenProps = {
  children: React.ReactNode;
  /** Scrollable screens keep the bottom padding clear of the tab bar. */
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

/** A screen = the fixed backdrop + safe areas + the shared content frame. */
export function Screen({ children, scroll = true, contentStyle }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const frame: ViewStyle = {
    paddingHorizontal: theme.layout.screenMargin,
    paddingTop: theme.spacing.lg,
    width: "100%",
    maxWidth: theme.layout.maxContentWidth,
    alignSelf: "center",
  };

  return (
    <View style={styles.root}>
      <Backdrop />
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        {scroll ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              frame,
              {
                gap: theme.spacing.xxl,
                paddingBottom: theme.spacing.giant + insets.bottom,
              },
              contentStyle,
            ]}
          >
            {children}
          </ScrollView>
        ) : (
          <View
            style={[
              frame,
              styles.center,
              { paddingBottom: theme.spacing.giant + insets.bottom },
              contentStyle,
            ]}
          >
            {children}
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  center: { flex: 1, justifyContent: "center" },
});
