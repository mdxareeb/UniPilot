import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";

import { AppText } from "@/components/AppText";
import { useTheme } from "@/theme/ThemeProvider";
import {
  formatMessage,
  type FormattedBlock,
  type InlineSpan,
} from "../messageFormatter";

function InlineSpans({ spans }: { spans: readonly InlineSpan[] }) {
  const theme = useTheme();
  return (
    <>
      {spans.map((span, index) => (
        <Text
          key={`${index}-${span.bold ? "b" : ""}${span.code ? "c" : ""}`}
          style={
            span.bold
              ? { fontFamily: theme.fontFamily.bodySemiBold }
              : span.code
                ? {
                    fontFamily: theme.fontFamily.monoRegular,
                    fontSize: 13,
                    lineHeight: 20,
                    color: theme.colors.foreground,
                    backgroundColor: theme.colors.muted,
                  }
                : undefined
          }
        >
          {span.text}
        </Text>
      ))}
    </>
  );
}

function CodeBlock({
  block,
}: {
  block: Extract<FormattedBlock, { type: "code" }>;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        borderRadius: theme.radii.nested,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.muted,
        overflow: "hidden",
      }}
    >
      {block.language !== null ? (
        <View
          style={{
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.xs,
          }}
        >
          <AppText variant="caps" color={theme.colors.mutedForeground}>
            {block.language}
          </AppText>
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
        }}
      >
        <Text
          selectable
          style={{
            fontFamily: theme.fontFamily.monoRegular,
            fontSize: 13,
            lineHeight: 20,
            color: theme.colors.foreground,
          }}
        >
          {block.text}
        </Text>
      </ScrollView>
    </View>
  );
}

function Block({ block }: { block: FormattedBlock }) {
  const theme = useTheme();

  if (block.type === "code") return <CodeBlock block={block} />;

  if (block.type === "paragraph") {
    return (
      <AppText variant="bodyMd">
        <InlineSpans spans={block.spans} />
      </AppText>
    );
  }

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {block.items.map((item, index) => (
        <View
          key={`list-${index}`}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ minWidth: 22, paddingTop: 1 }}>
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              {block.ordered ? `${block.start + index}.` : "•"}
            </AppText>
          </View>
          <AppText variant="bodyMd" style={{ flex: 1 }}>
            <InlineSpans spans={item} />
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** Renders the assistant's formatted blocks in the shared editorial type. */
export function FormattedMessage({ content }: { content: string }) {
  const theme = useTheme();
  const blocks = useMemo(() => formatMessage(content), [content]);
  if (blocks.length === 0) return null;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {blocks.map((block, index) => (
        <Block key={`block-${index}`} block={block} />
      ))}
    </View>
  );
}
