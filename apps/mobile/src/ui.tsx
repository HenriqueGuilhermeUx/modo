import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radii, shadow, spacing } from "./theme";

export function Screen({
  children,
  refreshing = false,
  onRefresh,
  padded = true,
}: PropsWithChildren<{ refreshing?: boolean; onRefresh?: () => void; padded?: boolean }>) {
  const { width } = useWindowDimensions();
  const horizontal = width >= 720 ? 32 : 18;
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} /> : undefined}
          contentContainerStyle={[
            styles.scroll,
            padded && { paddingHorizontal: horizontal },
          ]}
        >
          <View style={[styles.container, { maxWidth: width >= 900 ? 820 : 720 }]}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.brandRow} accessibilityRole="header">
      <View style={[styles.brandIcon, compact && styles.brandIconCompact]}>
        <Text style={[styles.brandM, compact && styles.brandMCompact]}>M</Text>
        <View style={styles.brandDot} />
      </View>
      {!compact && <Text style={styles.brandName}>MODO</Text>}
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle | ViewStyle[] }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  children,
  onPress,
  disabled,
  variant = "primary",
  loading = false,
  accessibilityLabel,
}: PropsWithChildren<{
  onPress?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  accessibilityLabel?: string;
}>) {
  const blocked = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        pressed && !blocked && styles.buttonPressed,
        blocked && styles.buttonDisabled,
      ]}
    >
      {loading ? <ActivityIndicator color={variant === "secondary" ? colors.navy : colors.surface} /> : (
        <Text style={[styles.buttonText, styles[`buttonText_${variant}`]]}>{children}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.subtle}
        style={[styles.field, props.multiline && styles.fieldMultiline, props.style]}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function Pill({ children, tone = "blue" }: PropsWithChildren<{ tone?: "blue" | "green" | "purple" | "neutral" | "warning" }>) {
  return (
    <View style={[styles.pill, styles[`pill_${tone}`]]}>
      <Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{children}</Text>
    </View>
  );
}

export function EmptyState({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return (
    <Card style={styles.empty}>
      <Text style={styles.emptySymbol}>✦</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyCopy}>{copy}</Text>
      {action}
    </Card>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <View accessibilityRole="alert" style={styles.errorNotice}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function SectionHeading({ eyebrow, title, copy }: { eyebrow?: string; title: string; copy?: string }) {
  return (
    <View style={styles.sectionHeading}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.sectionTitle}>{title}</Text>
      {copy ? <Text style={styles.sectionCopy}>{copy}</Text> : null}
    </View>
  );
}

export const typography = StyleSheet.create({
  hero: { color: colors.text, fontSize: 36, lineHeight: 40, fontWeight: "900", letterSpacing: -1.4 },
  h1: { color: colors.text, fontSize: 29, lineHeight: 34, fontWeight: "900", letterSpacing: -0.9 },
  h2: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: "900", letterSpacing: -0.4 },
  h3: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "800" },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  scroll: { flexGrow: 1, paddingTop: spacing.md, paddingBottom: 120 },
  container: { width: "100%", alignSelf: "center", gap: spacing.lg },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  brandIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" },
  brandIconCompact: { width: 34, height: 34, borderRadius: 11 },
  brandM: { color: colors.surface, fontSize: 21, fontWeight: "900", letterSpacing: -2 },
  brandMCompact: { fontSize: 17 },
  brandDot: { position: "absolute", width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green, right: 6, top: 6 },
  brandName: { color: colors.navy, fontSize: 19, fontWeight: "900", letterSpacing: 2.2 },
  card: { backgroundColor: colors.surface, borderRadius: radii.large, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, ...shadow },
  button: { minHeight: 52, borderRadius: radii.medium, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  button_primary: { backgroundColor: colors.blue },
  button_secondary: { backgroundColor: colors.green },
  button_ghost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  button_danger: { backgroundColor: colors.danger },
  buttonPressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
  buttonDisabled: { opacity: 0.48 },
  buttonText: { fontSize: 15, fontWeight: "900" },
  buttonText_primary: { color: colors.surface },
  buttonText_secondary: { color: colors.navy },
  buttonText_ghost: { color: colors.navy },
  buttonText_danger: { color: colors.surface },
  fieldWrap: { gap: 7 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "800" },
  field: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radii.medium, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 16, fontSize: 16 },
  fieldMultiline: { minHeight: 120, paddingTop: 14, textAlignVertical: "top" },
  fieldHint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  pill: { alignSelf: "flex-start", borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  pill_blue: { backgroundColor: colors.blueSoft },
  pill_green: { backgroundColor: colors.greenSoft },
  pill_purple: { backgroundColor: colors.purpleSoft },
  pill_neutral: { backgroundColor: colors.background },
  pill_warning: { backgroundColor: colors.warningSoft },
  pillText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.4 },
  pillText_blue: { color: colors.blue },
  pillText_green: { color: "#087A56" },
  pillText_purple: { color: colors.purple },
  pillText_neutral: { color: colors.muted },
  pillText_warning: { color: colors.warning },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
  emptySymbol: { color: colors.blue, fontSize: 32 },
  emptyTitle: { ...typography.h2, textAlign: "center" },
  emptyCopy: { ...typography.body, textAlign: "center", maxWidth: 480 },
  errorNotice: { borderRadius: radii.medium, borderWidth: 1, borderColor: "#FECDCA", backgroundColor: colors.dangerSoft, padding: spacing.md },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 20, fontWeight: "700" },
  sectionHeading: { gap: 7 },
  eyebrow: { color: colors.blue, fontSize: 11, fontWeight: "900", letterSpacing: 1.3 },
  sectionTitle: { ...typography.h1 },
  sectionCopy: { ...typography.body, maxWidth: 620 },
});
