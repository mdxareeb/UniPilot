import type { ExpoConfig } from "expo/config";

/**
 * UniPilot mobile — the M1 app configuration (see mobile-app/plan.md §G).
 *
 * Package id `com.unipilot.app` and scheme `unipilot` are PROVISIONAL (founder
 * decision (a), 2026-09-30): changing the package id later means a new build
 * and a new store listing (recorded in the plan). The scheme backs every
 * `unipilot://` deep link (M2 auth, M3+ provider OAuth).
 *
 * Cleartext HTTP is enabled only when EXPO_PUBLIC_ALLOW_CLEARTEXT is set
 * (the `preview` EAS profile sets it) so a device can reach a local
 * Supabase/Next server over http; production stays HTTPS-only.
 */
const allowCleartext = process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT === "1";

/** Expo plugins, in order; cleartext is appended only for dev/preview builds. */
const plugins: NonNullable<ExpoConfig["plugins"]> = [
  "expo-router",
  [
    "expo-splash-screen",
    {
      backgroundColor: "#131316",
      image: "./assets/images/splash-icon.png",
      imageWidth: 76,
    },
  ],
];
if (allowCleartext) {
  plugins.push([
    "expo-build-properties",
    { android: { usesCleartextTraffic: true } },
  ]);
}

const config: ExpoConfig = {
  name: "UniPilot",
  /* The EAS project the founder provisioned (id in `extra.eas`) carries the
     slug "areeb"; the slug must match it to link and build. Display name,
     package id and scheme remain UniPilot identifiers. Revisit: rename the
     Expo project (dashboard) or create a product-named project, then update
     this slug and `extra.eas.projectId` together. */
  slug: "areeb",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "unipilot",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.unipilot.app",
    icon: "./assets/expo.icon",
  },
  android: {
    package: "com.unipilot.app",
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins,
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: {
      projectId: "4e5aa54b-747b-42e0-9ef1-a9ab205d98de",
    },
  },
};

export default config;
