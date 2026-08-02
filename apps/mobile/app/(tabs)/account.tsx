import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { requestAccountDeletion } from "../../src/api";
import { useSession } from "../../src/session";
import { BrandMark, Button, Card, ErrorNotice, Pill, Screen, SectionHeading, typography } from "../../src/ui";
import { colors, radii, spacing } from "../../src/theme";

const PRIVACY_URL = "https://modo1.netlify.app/politica-de-privacidade";
const DELETION_URL = "https://modo1.netlify.app/exclusao-de-dados";
const SUPPORT_EMAIL = "henriquecampos66@gmail.com";

const planLabels = {
  trial: "Teste gratuito",
  start: "MODO Começar",
  presenca: "MODO Presença",
  pro: "MODO Crescer",
  business: "MODO Business",
} as const;

const statusLabels = {
  active: "Ativa",
  retrying: "Em atualização",
  suspended: "Suspensa",
  canceled: "Cancelada",
} as const;

export default function AccountScreen() {
  const { token, dashboard, signOut } = useSession();
  const [deleting, setDeleting] = useState(false);
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [error, setError] = useState("");

  if (!dashboard) return <Screen><Text style={typography.body}>Sincronizando sua conta...</Text></Screen>;

  function confirmDeletion() {
    Alert.alert(
      "Solicitar exclusão da conta?",
      "A solicitação será registrada para análise e exclusão dos dados vinculados, conforme a política da MODO. Esta ação não é o mesmo que sair do aplicativo.",
      [
        { text: "Voltar", style: "cancel" },
        { text: "Solicitar exclusão", style: "destructive", onPress: () => void submitDeletion() },
      ],
    );
  }

  async function submitDeletion() {
    if (!token) return;
    setDeleting(true);
    setError("");
    try {
      await requestAccountDeletion(token);
      setDeletionRequested(true);
      Alert.alert("Solicitação registrada", "Você receberá orientações pelo e-mail da sua conta. Os detalhes também estão disponíveis na página de exclusão de dados.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível registrar a solicitação.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.top}><BrandMark /><Pill tone="neutral">VERSÃO 1.0.0</Pill></View>
      <SectionHeading eyebrow="SUA CONTA" title={dashboard.user.name} copy={dashboard.user.email} />

      <Card style={styles.planCard}>
        <View style={styles.planTop}>
          <View><Text style={styles.label}>PLANO SINCRONIZADO</Text><Text style={typography.h2}>{planLabels[dashboard.usage.plan]}</Text></View>
          <Pill tone={dashboard.usage.status === "active" ? "green" : "warning"}>{statusLabels[dashboard.usage.status]}</Pill>
        </View>
        <View style={styles.usage}>
          <View><Text style={styles.number}>{dashboard.usage.creditsRemaining}</Text><Text style={styles.muted}>créditos disponíveis</Text></View>
          <View><Text style={styles.number}>{dashboard.brands.length}</Text><Text style={styles.muted}>contextos ativos</Text></View>
        </View>
        <Text style={typography.small}>Sua assinatura e seus direitos de uso são sincronizados com a conta MODO. O aplicativo não realiza cobranças externas.</Text>
      </Card>

      <Card style={styles.menuCard}>
        <Text style={styles.label}>PRIVACIDADE E SUPORTE</Text>
        <MenuItem title="Política de privacidade" copy="Entenda quais dados são usados e por quê." onPress={() => void Linking.openURL(PRIVACY_URL)} />
        <MenuItem title="Instruções de exclusão" copy="Veja prazos, dados envolvidos e canais de contato." onPress={() => void Linking.openURL(DELETION_URL)} />
        <MenuItem title="Falar com o suporte" copy={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Suporte%20MODO`)} />
      </Card>

      <Card style={styles.safetyCard}>
        <Text style={styles.label}>CONTROLE DA CONTA</Text>
        <Text style={typography.body}>Você pode iniciar a exclusão da sua conta diretamente aqui. A solicitação fica vinculada ao usuário autenticado e à organização correta.</Text>
        {deletionRequested ? <View style={styles.success}><Text style={styles.successText}>✓ Solicitação de exclusão registrada.</Text></View> : null}
        {error ? <ErrorNotice message={error} /> : null}
        <Button variant="danger" onPress={confirmDeletion} loading={deleting} disabled={deletionRequested}>Solicitar exclusão da conta</Button>
      </Card>

      <Button variant="ghost" onPress={() => void signOut()}>Sair deste dispositivo</Button>
      <Text style={styles.footer}>MODO · Alternative Ventures · Presença digital com contexto e aprovação.</Text>
    </Screen>
  );
}

function MenuItem({ title, copy, onPress }: { title: string; copy: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
      <View style={styles.menuCopy}><Text style={styles.menuTitle}>{title}</Text><Text style={styles.menuDescription}>{copy}</Text></View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planCard: { gap: spacing.lg, backgroundColor: colors.navy, borderColor: colors.navy },
  planTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  label: { color: colors.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 6 },
  usage: { flexDirection: "row", gap: spacing.xl },
  number: { color: colors.surface, fontSize: 27, fontWeight: "900" },
  muted: { color: "#AEBBD4", fontSize: 11, fontWeight: "700" },
  menuCard: { gap: spacing.sm },
  menuItem: { minHeight: 65, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.md },
  menuCopy: { flex: 1, gap: 3 },
  menuTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  menuDescription: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  arrow: { color: colors.blue, fontSize: 27, fontWeight: "400" },
  pressed: { opacity: 0.62 },
  safetyCard: { gap: spacing.md, borderColor: "#FECDCA" },
  success: { borderRadius: radii.medium, backgroundColor: colors.greenSoft, padding: spacing.md },
  successText: { color: "#087A56", fontSize: 13, fontWeight: "900" },
  footer: { color: colors.subtle, fontSize: 10, lineHeight: 16, textAlign: "center", paddingHorizontal: spacing.lg },
});
