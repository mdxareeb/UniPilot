import { Tabs } from "expo-router";
import {
  CalendarDays,
  House,
  MoreHorizontal,
  Sparkles,
  SquareCheck,
} from "lucide-react-native";

import { useTheme } from "@/theme/ThemeProvider";

/**
 * The 5-tab workspace: Home · Ask AI · Tasks · Calendar · More.
 * Home is the default; More keeps the registry-driven account and
 * integration hub. The tab order is the registration order below.
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
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <House color={color} size={size ?? 22} />
          ),
        }}
      />
      <Tabs.Screen
        name="ask"
        options={{
          title: "Ask AI",
          tabBarIcon: ({ color, size }) => (
            <Sparkles color={color} size={size ?? 22} />
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
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, size }) => (
            <CalendarDays color={color} size={size ?? 22} />
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
