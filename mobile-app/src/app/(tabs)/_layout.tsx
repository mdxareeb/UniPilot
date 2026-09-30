import { Tabs } from "expo-router";
import {
  CalendarDays,
  MoreHorizontal,
  SquareCheck,
} from "lucide-react-native";

import { useTheme } from "@/theme/ThemeProvider";

/**
 * The approved tab IA (decision (b)): Calendar (default) · Tasks · More.
 * More holds Integrations, Settings and the design specimen for M1; later
 * milestones add their surfaces there.
 */
export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.foreground,
        tabBarInactiveTintColor: theme.colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.border,
        },
        tabBarLabelStyle: {
          fontFamily: theme.fontFamily.bodyMedium,
          fontSize: 11,
        },
        sceneStyle: { backgroundColor: "transparent" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, size }) => (
            <CalendarDays color={color} size={size ?? 22} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ color, size }) => (
            <SquareCheck color={color} size={size ?? 22} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <MoreHorizontal color={color} size={size ?? 22} />
          ),
        }}
      />
    </Tabs>
  );
}
