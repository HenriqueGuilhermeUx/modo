import type { ContentRequest } from "@modo/contracts/content";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { listContent } from "../../src/api";
import { useSession } from "../../src/session";
import { BrandMark, Card, EmptyState, ErrorNotice, Pill, Screen, typography } from "../../src/ui";
import { colors, radii, spacing } from "../../src/theme";

const planLabels = {
  trial: "Teste gratuito",
  start: "MODO Começar",
  presenca: "MODO Presença",
  pro: "MODO Crescer",
  business: "MODO Business",
} as const;

const statusLabels: Record<ContentRequest["status"], string> = {
  queued: "Na fila",
  processing: "Em produção",
  ready: "Pronto para revisar",
  approved: "Aprovado",
  revision_requested: "Em revisão",
  failed: "Falhou",
  cancelled: "Cancelado",
};

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "você";
}

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const { token, dashboard, refresh } = useSession();
  const [recent, setRecent] = useState<ContentRequest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [, content] = await Promise.all([refresh(), listContent(token)]);
      setRecent(content.slice(0, 3));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar sua operação.");
    }
  }, [refresh, token]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  if (dashboard && dashboard.brands.length === 0) return <Redirect href="/setup" />;
  if (!dashboard) return <Screen><EmptyState title="Carregando sua operação" copy="Estamos sincronizando seu contexto e seus direitos de uso." /></Screen>;

  const twoColumns = width >= 680;
  const activeBrand = dashboard.brands[0];

  async function pull() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openCreate(channel: "Instagram" | "LinkedIn") {
    router.push({ pathname: "/(tabs)/create", params: { channel } });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => void pull()}>
      <View style={styles.header}>
        <BrandMark />
        <View style={styles.headerRight}>
          <Text style={styles.balance}>{dashboard.usage.creditsRemaining}</Text>
          <Text style={styles.balanceLabel}>créditos</Text>
        </View>
      </View>

      <View style={styles.hero}>
        <Pill tone="green">{planLabels[dashboard.usage.plan]}</Pill>
        <Text style={typography.hero}>Olá, {firstName(dashboard.user.name)}.</Text>
        <Text style={typography.body}>A MODO já conhece <Text style={styles.strong}>{activeBrand.name}</Text>. Escolha o resultado que você precisa agora.</Text>
      </View>

      {error ? <ErrorNotice message={error} /> : null}

      <View style={[styles.modules, twoColumns && styles.modulesWide]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Criar conteúdo para Instagram ou Facebook"
          onPress={() => openCreate("Instagram")}
          style={({ pressed }) => [styles.module, styles.social, twoColumns && styles.moduleWide, pressed && styles.pressed]}
        >
          <Pill>INSTAGRAM E FACEBOOK</Pill>
          <Text style={styles.moduleSymbol}>◎</Text>
          <Text style={styles.moduleTitle}>Crie presença visual.</Text>
          <Text style={styles.moduleCopy}>Posts, imagens, carrosséis, stories e campanhas construídos com o contexto da sua marca.</Text>
          <Text style={styles.moduleAction}>Começar criação →</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Criar conteúdo para LinkedIn"
          onPress={() => openCreate("LinkedIn")}
          style={({ pressed }) => [styles.module, styles.linkedin, twoColumns && styles.moduleWide, pressed && styles.pressed]}
        >
          <Pill tone="green">LINKEDIN</Pill>
          <Text style={styles.moduleSymbol}>in</Text>
          <Text style={styles.moduleTitle}>Transforme intenção em autoridade.</Text>
          <Text style={styles.moduleCopy}>Posts, artigos, documentos e ideias profissionais alinhados ao seu posicionamento.</Text>
          <Text style={styles.moduleAction}>Criar para LinkedIn →</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Conhecer demonstração de inteligência"
          onPress={() => Alert.alert(
            "Inteligência MODO",
            "A demonstração guiada de concorrentes, leads e sinais de mercado será liberada progressivamente no aplicativo. Suas pesquisas avançadas permanecem sincronizadas com a plataforma MODO.",
          )}
          style={({ pressed }) => [styles.module, styles.intelligence, twoColumns && styles.moduleFull, pressed && styles.pressed]}
        >
          <Pill tone="purple">DEMONSTRAÇÃO</Pill>
          <Text style={styles.moduleSymbol}>✦</Text>
          <Text style={styles.moduleTitle}>Descubra sinais antes de decidir.</Text>
          <Text style={styles.moduleCopy}>Uma prévia controlada de concorrentes, oportunidades e potenciais leads, sem ações automáticas.</Text>
          <Text style={[styles.moduleAction, { color: colors.purple }]}>Entender a inteligência →</Text>
        </Pressable>
      </View>

      <View style={styles.sectionTop}>
        <View><Text style={styles.eyebrow}>PRODUÇÃO RECENTE</Text><Text style={typography.h2}>Continue de onde parou</Text></View>
        <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/agenda")}><Text style={styles.link}>Ver agenda</Text></Pressable>
      </View>

      {recent.length ? recent.map((item) => (
        <Card key={item.id} style={styles.recentCard}>
          <View style={styles.recentHead}>
            <Pill tone={item.status === "approved" ? "green" : item.status === "failed" ? "warning" : "neutral"}>{statusLabels[item.status]}</Pill>
            <Text style={styles.recentChannel}>{item.channel}</Text>
          </View>
          <Text numberOfLines={2} style={typography.h3}>{item.output?.title || item.brief}</Text>
          <Text numberOfLines={2} style={typography.small}>{item.output?.caption || "A MODO está preparando texto e direção visual."}</Text>
        </Card>
      )) : (
        <EmptyState
          title="Sua primeira criação começa aqui"
          copy="Conte o objetivo. A MODO recomenda o formato e prepara uma entrega para sua revisão."
          action={<Pressable onPress={() => openCreate("Instagram")}><Text style={styles.link}>Criar agora</Text></Pressable>}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerRight: { alignItems: "flex-end" },
  balance: { color: colors.navy, fontSize: 20, fontWeight: "900" },
  balanceLabel: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  hero: { gap: spacing.sm, paddingVertical: spacing.md },
  strong: { color: colors.navy, fontWeight: "900" },
  modules: { gap: spacing.md },
  modulesWide: { flexDirection: "row", flexWrap: "wrap" },
  module: { minHeight: 250, borderRadius: radii.large, padding: spacing.lg, gap: spacing.sm, borderWidth: 1 },
  moduleWide: { width: "48.7%", flexGrow: 1 },
  moduleFull: { width: "100%", minHeight: 210 },
  social: { backgroundColor: "#F3F7FF", borderColor: "#CFDCFF" },
  linkedin: { backgroundColor: colors.greenSoft, borderColor: "#BDEEDC" },
  intelligence: { backgroundColor: colors.purpleSoft, borderColor: "#DCD4FF" },
  pressed: { transform: [{ scale: 0.988 }], opacity: 0.94 },
  moduleSymbol: { color: colors.navy, fontSize: 30, fontWeight: "900", marginTop: spacing.sm },
  moduleTitle: { ...typography.h2 },
  moduleCopy: { ...typography.body, flexGrow: 1 },
  moduleAction: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  sectionTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: spacing.md },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 5 },
  link: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  recentCard: { gap: spacing.sm },
  recentHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recentChannel: { color: colors.muted, fontSize: 11, fontWeight: "800" },
});
