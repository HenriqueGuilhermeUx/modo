import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
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

const statusLabels = {
  active: "Ativa",
  retrying: "Em atualização",
  suspended: "Suspensa",
  canceled: "Cancelada",
} as const;

export default function AccountScreen() {
  const { dashboard, signOut } = useSession();
  const [requestOpened, setRequestOpened] = useState(false);

  if (!dashboard) return <Screen><Text style={typography.body}>Sincronizando sua conta...</Text></Screen>;

  function confirmDeletion() {
    Alert.alert(
      "Iniciar exclusão da conta?",
      "Abriremos um pedido identificado pelo e-mail da sua conta. Você receberá as orientações sobre confirmação, dados envolvidos e prazo de exclusão.",
      [
        { text: "Voltar", style: "cancel" },
        { text: "Continuar", style: "destructive", onPress: () => void openDeletionRequest() },
      ],
    );
  }

  async function openDeletionRequest() {
    const subject = encodeURIComponent("Solicitação de exclusão da conta MODO");
    const body = encodeURIComponent([
      "Solicito a exclusão da minha conta e dos dados vinculados na MODO.",
      "",
      `E-mail da conta: ${dashboard.user.email}`,
      `Organização: ${dashboard.organization.name}`,
      "",
      "Confirmarei a solicitação conforme as orientações de segurança.",
    ].join("\n"));
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    const supported = await Linking.canOpenURL(mailto);
    if (supported) {
      await Linking.openURL(mailto);
    } else {
      await Linking.openURL(DELETION_URL);
    }
    setRequestOpened(true);
  }

  return (
    <Screen>
      <View style={styles.top}><BrandMark /><Pill tone="neutral">VERSÃO 1.0.0</Pill></View>
      <SectionHeading eyebrow="SUA CONTA" title={dashboard.user.name} copy={dashboard.user.email} />

      <Card style={styles.planCard}>
        <View style={styles.planTop}>
          <View><Text style={styles.planLabel}>PLANO SINCRONIZADO</Text><Text style={styles.planTitle}>{planLabels[dashboard.usage.plan]}</Text></View>
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
        <Text style={typography.body}>Você pode iniciar a exclusão pelo aplicativo. O pedido usa o e-mail autenticado e precisa ser confirmado para impedir exclusões indevidas.</Text>
        {requestOpened ? <View style={styles.success}><Text style={styles.successText}>✓ Canal de exclusão aberto. Conclua o envio ou siga as instruções exibidas.</Text></View> : null}
        <Button variant="danger" onPress={confirmDeletion}>Iniciar pedido de exclusão</Button>
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
  footer: { color: colors.subtle, fontSize: 10, lineHeight: 16, textAlign: "center", paddingHorizontal: spacing.lg },
});
