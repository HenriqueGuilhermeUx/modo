import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../src/session";
import { colors } from "../src/theme";

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" options={{ animation: "fade" }} />
        <Stack.Screen name="setup" options={{ animation: "slide_from_right", gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
      </Stack>
    </SessionProvider>
  );
}
