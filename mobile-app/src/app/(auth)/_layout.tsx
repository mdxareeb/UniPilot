import { Stack } from "expo-router";

/** The signed-out group: one stack, no headers — the screen owns its frame. */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "transparent" },
      }}
    />
  );
}
