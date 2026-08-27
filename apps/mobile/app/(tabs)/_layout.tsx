import { Redirect, Tabs } from "expo-router";
import { StyleSheet, Text } from "react-native";
import { useSession } from "../../src/session";
import { colors } from "../../src/theme";

const icons: Record<string, string> = {
  index: "⌂",
  create: "+",
  video: "▶",
  agenda: "✓",
  account: "●",
};

export default function TabsLayout() {
  const { token, loading } = useSession();
  if (!loading && !token) return <Redirect href="/auth" />;

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.muted,
        tabBarHideOnKeyboard: true,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        tabBarIcon: ({ color, focused }) => (
          <Text style={[styles.icon, { color }, focused && styles.iconActive]}>{icons[route.name] || "•"}</Text>
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Início" }} />
      <Tabs.Screen name="create" options={{ title: "Criar" }} />
      <Tabs.Screen name="video" options={{ title: "Vídeo" }} />
      <Tabs.Screen name="agenda" options={{ title: "Agenda" }} />
      <Tabs.Screen name="account" options={{ title: "Conta" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { height: 72, paddingTop: 7, paddingBottom: 9, backgroundColor: colors.surface, borderTopColor: colors.border },
  label: { fontSize: 10, fontWeight: "800" },
  icon: { fontSize: 19, fontWeight: "800", height: 24 },
  iconActive: { transform: [{ scale: 1.08 }] },
});
