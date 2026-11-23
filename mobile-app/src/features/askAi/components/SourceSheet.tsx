import { useRef, useState } from "react";
import { View } from "react-native";
import { ExternalLink } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Notice } from "@/components/Notice";
import { AppButton } from "@/components/ui/AppButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useTheme } from "@/theme/ThemeProvider";
import { citationWhereLabel, type CitationGroup } from "../citations";
import { CHAT_COPY } from "../chatValues";
import { openCitedDocument } from "../queries";

/** One citation's verbatim excerpt, page/section label and open action. */
export function SourceSheet({
  group,
  onClose,
}: {
  group: CitationGroup | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const visible = group !== null;

  const close = () => {
    request.current += 1;
    setOpening(false);
    setError(null);
    onClose();
  };

  const openDocument = async () => {
    if (group === null || opening) return;
    const mine = ++request.current;
    setOpening(true);
    setError(null);
    const result = await openCitedDocument(group.documentId);
    if (mine !== request.current) return;
    setOpening(false);
    if (result.error !== null) setError(result.error);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={group?.documentName ?? "Source"}
      subtitle={
        group === null
          ? undefined
          : `${citationWhereLabel(group)} · ${CHAT_COPY.SOURCE}`
      }
    >
      {group !== null ? (
        <>
          <View
            style={{
              gap: theme.spacing.sm,
              padding: theme.spacing.md,
              borderRadius: theme.radii.nested,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.muted,
            }}
          >
            <AppText variant="caps" color={theme.colors.mutedForeground}>
              Excerpt
            </AppText>
            <AppText variant="bodyMd" selectable>
              {group.snippet}
            </AppText>
          </View>

          {error !== null ? <Notice tone="error">{error}</Notice> : null}

          <AppButton
            label={opening ? "Opening…" : CHAT_COPY.OPEN_DOCUMENT}
            variant="primary"
            loading={opening}
            disabled={opening}
            onPress={() => void openDocument()}
            accessibilityLabel={`Open ${group.documentName}`}
            leading={<ExternalLink size={15} color={theme.colors.onPrimary} />}
            fullWidth
          />
        </>
      ) : null}
    </BottomSheet>
  );
}
