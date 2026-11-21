import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { getPendingAccountDeletion, requestAccountDeletion } from "../../src/api";
import { useSession } from "../../src/session";
import { BrandMark, Button, Card, Pill, Screen, SectionHeading, typography } from "../../src/ui";
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

function directPlanLabel(plan: string) {
  return planLabels[plan as keyof typeof planLabels] || "MODO";
}

const statusLabels = {
  active: "Ativa",
  retrying: "Em atualização",
  suspended: "Suspensa",
  canceled: "Cancelada",
} as const;

export default function AccountScreen() {
  const { dashboard, signOut, token } = useSession();
  const [submittingDeletion, setSubmittingDeletion] = useState(false);
  const [deletionTicket, setDeletionTicket] = useState("");
  const [requestError, setRequestError] = useState("");
  useEffect(() => {
    let live = true;
    if (!token) return;
    getPendingAccountDeletion(token)
      .then(({ request }) => { if (live) setDeletionTicket(request?.requestId ?? ""); })
      .catch(() => { /* Status readback failure does not imply no pending request. */ });
    return () => { live = false; };
  }, [token]);


  if (!dashboard) return <Screen><Text style={typography.body}>Sincronizando sua conta...</Text></Screen>;
  const accountEmail = dashboard.user.email;

  function confirmDeletion() {
    Alert.alert(
      "Iniciar exclusão da conta?",
      "A MODO registrará um pedido associado à sua sessão e apresentará um protocolo. Isso inicia a análise; não apaga dados automaticamente. Confirme para continuar.",
      [
        { text: "Voltar", style: "cancel" },
        { text: "Continuar", style: "destructive", onPress: () => void openDeletionRequest() },
      ],
    );
  }

  async function openDeletionRequest() {
    setRequestError("");
    if (!token) {
      setRequestError("Entre novamente na MODO para solicitar a exclusão.");
      return;
    }
    setSubmittingDeletion(true);
    try {
      const ticket = await requestAccountDeletion(token);
      setDeletionTicket(ticket.requestId);
    } catch {
      // No false success: the API must acknowledge and persist the request.
      setRequestError("Não conseguimos registrar o pedido agora. Sua conta não foi alterada. Use as instruções públicas ou fale com o suporte.");
    } finally {
      setSubmittingDeletion(false);
    }
  }

  return (
    <Screen>
      <View style={styles.top}><BrandMark /><Pill tone="neutral">VERSÃO 1.0.2</Pill></View>
      <SectionHeading eyebrow="SUA CONTA" title={dashboard.user.name} copy={accountEmail} />

      <Card style={styles.planCard}>
        <View style={styles.planTop}>
          <View><Text style={styles.planLabel}>PLANO SINCRONIZADO</Text><Text style={styles.planTitle}>{directPlanLabel(dashboard.usage.plan)}</Text></View>
          <Pill tone={dashboard.usage.status === "active" ? "green" : "warning"}>{statusLabels[dashboard.usage.status]}</Pill>
        </View>
        <View style={styles.usage}>
          <View><Text style={styles.number}>{dashboard.usage.creditsRemaining}</Text><Text style={styles.muted}>créditos disponíveis</Text></View>
          <View><Text style={styles.number}>{dashboard.brands.length}</Text><Text style={styles.muted}>contextos ativos</Text></View>
        </View>
        <Text style={styles.planCopy}>Sua assinatura e seus direitos de uso são sincronizados com a conta MODO. O aplicativo Android não abre checkout externo.</Text>
      </Card>

      <Card style={styles.menuCard}>
        <Text style={styles.label}>PRIVACIDADE E SUPORTE</Text>
        <MenuItem title="Política de privacidade" copy="Entenda quais dados são usados e por quê." onPress={() => void Linking.openURL(PRIVACY_URL)} />
        <MenuItem title="Instruções de exclusão" copy="Veja dados envolvidos, confirmação e prazo." onPress={() => void Linking.openURL(DELETION_URL)} />
        <MenuItem title="Falar com o suporte" copy={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Suporte%20MODO`)} />
      </Card>

      <Card style={styles.safetyCard}>
        <Text style={styles.label}>CONTROLE DA CONTA</Text>
        <Text style={typography.body}>Você pode registrar uma solicitação autenticada neste aplicativo. Receberá um protocolo; a análise e a exclusão efetiva são etapas separadas, sujeitas à verificação e à retenção legal.</Text>
        {deletionTicket ? <View style={styles.success}><Text style={styles.successText}>Solicitação registrada. Protocolo: {deletionTicket}. A conta ainda não foi excluída; aguarde a análise e confirmação do suporte.</Text></View> : null}
        {requestError ? <Text accessibilityRole="alert" style={styles.errorText}>{requestError}</Text> : null}
        <Button variant="danger" onPress={confirmDeletion} loading={submittingDeletion} disabled={submittingDeletion || Boolean(deletionTicket)}>Solicitar exclusão da conta</Button>
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
  planLabel: { color: "#72A0FF", fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 6 },
  planTitle: { color: colors.surface, fontSize: 22, lineHeight: 28, fontWeight: "900" },
  planCopy: { color: "#AEBBD4", fontSize: 12, lineHeight: 19 },
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
  successText: { color: "#087A56", fontSize: 13, lineHeight: 20, fontWeight: "900" },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  footer: { color: colors.subtle, fontSize: 10, lineHeight: 16, textAlign: "center", paddingHorizontal: spacing.lg },
});