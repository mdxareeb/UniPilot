import { useCallback, useState } from "react";
import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { AppButton } from "@/components/ui/AppButton";
import { Input } from "@/components/Input";
import { Notice } from "@/components/Notice";
import { useTheme } from "@/theme/ThemeProvider";

import { PHONE_REJECTION_COPY, sanitizePhone } from "./phone";
import type { ActionResult } from "./useGroupSync";

type PhoneLinkFormProps = {
  onSubmit: (digits: string) => Promise<ActionResult>;
  /** Why the last attempt failed (sanitized server copy), if it did. */
  lastError: string | null;
};

/**
 * Start a pairing-code link. The number is cleaned to digits-only E.164 here
 * for instant feedback; the server cleans and validates it again. It is sent
 * once, over HTTPS, and the app does not keep it afterwards.
 */
export function PhoneLinkForm({ onSubmit, lastError }: PhoneLinkFormProps) {
  const theme = useTheme();
  const [phone, setPhone] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (busy) return;
    setSubmitError(null);
    const result = sanitizePhone(phone);
    if (!result.ok) {
      setFieldError(PHONE_REJECTION_COPY[result.reason]);
      return;
    }
    setFieldError(null);
    setBusy(true);
    const outcome = await onSubmit(result.digits);
    setBusy(false);
    if (outcome.error !== null) setSubmitError(outcome.error);
    else setPhone("");
  }, [busy, onSubmit, phone]);

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Input
        label="WhatsApp number"
        value={phone}
        onChangeText={(value) => {
          setPhone(value);
          if (fieldError !== null) setFieldError(null);
        }}
        placeholder="+91 98765 43210"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        editable={!busy}
        error={fieldError}
        testID="whatsapp-phone-input"
      />
      <AppText variant="mono" color={theme.colors.mutedForeground}>
        Include the country code. Spaces, dashes and a leading + are fine.
      </AppText>
      <AppButton
        label={busy ? "Requesting…" : "Get pairing code"}
        onPress={() => void submit()}
        disabled={busy}
        style={{ alignSelf: "stretch" }}
      />
      {submitError !== null ? <Notice tone="error">{submitError}</Notice> : null}
      {submitError === null && lastError !== null ? (
        <Notice tone="error">{lastError}</Notice>
      ) : null}
    </View>
  );
}
