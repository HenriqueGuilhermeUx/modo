import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../src/session";
import { BrandMark, Button, Card, ErrorNotice, Field, Pill, Screen, typography } from "../src/ui";
import { colors, radii, spacing } from "../src/theme";

type Mode = "login" | "register";

export default function AuthScreen() {
  const { token, loading, signIn, signUp } = useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!loading && token) return <Redirect href="/(tabs)" />;

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      if (mode === "login") {
        await signIn({ email, password });
      } else {
        await signUp({ name, organizationName, email, password });
      }
      router.replace("/(tabs)");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível entrar na MODO.");
    } finally {
      setSubmitting(false);
    }
  }

  const ready = mode === "login"
    ? email.trim().length > 4 && password.length > 0
    : name.trim().length >= 2 && organizationName.trim().length >= 2 && email.trim().length > 4 && password.length >= 8;

  return (
    <Screen>
      <View style={styles.top}><BrandMark /><Pill tone="green">APP NATIVO</Pill></View>
      <View style={styles.intro}>
        <Text style={typography.hero}>{mode === "login" ? "Sua presença continua aqui." : "Comece com contexto, não com prompts."}</Text>
        <Text style={typography.body}>Acesse sua operação, crie conteúdo e acompanhe o que está em produção com segurança.</Text>
      </View>

      <Card style={styles.card}>
        <View style={styles.tabs}>
          <Pressable accessibilityRole="tab" onPress={() => setMode("login")} style={[styles.tab, mode === "login" && styles.tabActive]}>
            <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Entrar</Text>
          </Pressable>
          <Pressable accessibilityRole="tab" onPress={() => setMode("register")} style={[styles.tab, mode === "register" && styles.tabActive]}>
            <Text style={[styles.tabText, mode === "register" && styles.tabTextActive]}>Criar conta</Text>
          </Pressable>
        </View>

        {mode === "register" ? (
          <>
            <Field label="Seu nome" value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" />
            <Field label="Empresa, marca ou operação" value={organizationName} onChangeText={setOrganizationName} autoCapitalize="words" />
          </>
        ) : null}
        <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" />
        <Field
          label="Senha"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType={mode === "login" ? "password" : "newPassword"}
          hint={mode === "register" ? "Use pelo menos 8 caracteres, com uma letra e um número." : undefined}
        />
        {error ? <ErrorNotice message={error} /> : null}
        <Button onPress={() => void submit()} disabled={!ready} loading={submitting}>
          {mode === "login" ? "Entrar na MODO" : "Criar conta gratuita"}
        </Button>
        <Text style={styles.terms}>Ao continuar, você concorda com os termos e a política de privacidade da MODO. Nenhuma publicação acontece sem sua aprovação.</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  intro: { gap: spacing.md, paddingTop: spacing.lg },
  card: { gap: spacing.md },
  tabs: { flexDirection: "row", backgroundColor: colors.background, borderRadius: radii.medium, padding: 4, marginBottom: 4 },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  tabActive: { backgroundColor: colors.surface },
  tabText: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  tabTextActive: { color: colors.navy },
  terms: { color: colors.subtle, fontSize: 11, lineHeight: 17, textAlign: "center" },
});
