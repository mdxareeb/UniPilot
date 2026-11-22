import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { AppButton } from "@/components/ui/AppButton";
import { Notice } from "@/components/Notice";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/theme/ThemeProvider";

import {
  copyPairingCode,
  displayCode,
  formatCountdown,
  secondsLeft,
  type CopyResult,
} from "./pairing";

type PairingCodeCardProps = {
  pairing: { code: string; expiresAt: string };
};

const COPY_MESSAGES: Record<Exclude<CopyResult, "copied">, string> = {
  failed: "Couldn't copy the code. Type it in by hand.",
  expired: "That code has expired. Cancel and get a new one.",
};

/**
 * The 8-character pairing code with its countdown and a one-tap Copy Code, so
 * the student can paste it into WhatsApp > Linked devices > Link with phone
 * number before it expires. The code is shown in the mono face with wide
 * spacing; it is never logged.
 */
export function PairingCodeCard({ pairing }: PairingCodeCardProps) {
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  const left = secondsLeft(pairing.expiresAt, now);
  const expired = left <= 0;

  const onCopy = useCallback(async () => {
    const result = await copyPairingCode(
      pairing,
      (text) => Clipboard.setStringAsync(text),
      Date.now(),
    );
    if (result === "copied") {
      setCopyError(null);
      setCopied(true);
      AccessibilityInfo.announceForAccessibility("Code copied");
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2500);
    } else {
      setCopied(false);
      setCopyError(COPY_MESSAGES[result]);
    }
  }, [pairing]);

  return (
    <Surface
      fill="solid"
      elevation="raised"
      radius="card"
      padding={theme.spacing.xl}
      style={{ gap: theme.spacing.lg, alignItems: "center" }}
    >
      <AppText
        variant="caps"
        color={theme.colors.mutedForeground}
        accessibilityLiveRegion="none"
      >
        Your pairing code
      </AppText>
      <AppText
        variant="mono"
        accessibilityLabel={`Pairing code ${pairing.code.split("").join(" ")}`}
        selectable
        style={{ fontSize: 32, lineHeight: 40, letterSpacing: 4, textAlign: "center" }}
        color={expired ? theme.colors.mutedForeground : theme.colors.foreground}
      >
        {displayCode(pairing.code)}
      </AppText>
      <AppText variant="mono" color={theme.colors.mutedForeground}>
        {expired ? "Expired" : `Expires in ${formatCountdown(left)}`}
      </AppText>
      <AppButton
        label={copied ? "Copied" : "Copy Code"}
        accessibilityLabel={copied ? "Code copied" : "Copy pairing code"}
        variant={copied ? "secondary" : "primary"}
        disabled={expired}
        onPress={() => void onCopy()}
        leading={
          copied ? (
            <Check size={16} color={theme.colors.foreground} />
          ) : (
            <Copy size={16} color={theme.colors.onPrimary} />
          )
        }
        style={{ alignSelf: "stretch" }}
      />
      {copyError !== null ? (
        <View style={{ alignSelf: "stretch" }}>
          <Notice tone="error">{copyError}</Notice>
        </View>
      ) : null}
    </Surface>
  );
}
