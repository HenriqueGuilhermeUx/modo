import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { BrandMark } from "../src/ui";
import { useSession } from "../src/session";
import { colors, spacing } from "../src/theme";

export default function EntryScreen() {
  const { loading, token } = useSession();
  if (!loading) return <Redirect href={token ? "/(tabs)" : "/auth"} />;

  return (
    <View style={styles.screen}>
      <BrandMark />
      <ActivityIndicator size="large" color={colors.blue} />
      <Text style={styles.copy}>Preparando sua presença...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, backgroundColor: colors.background },
  copy: { color: colors.muted, fontSize: 14, fontWeight: "700" },
});
