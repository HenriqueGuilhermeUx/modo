import { contentCreditCost, type ContentUnitType } from "@modo/contracts";
import type { ContentObjective, ContentRequest } from "@modo/contracts/content";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { approveContent, createContent, getContent } from "../../src/api";
import { useSession } from "../../src/session";
import { Button, Card, ErrorNotice, Field, Pill, Screen, SectionHeading, typography } from "../../src/ui";
import { colors, radii, spacing } from "../../src/theme";

const channels = ["Instagram", "Facebook", "LinkedIn"] as const;
type Channel = typeof channels[number];

const objectives: Array<{ value: ContentObjective; label: string; copy: string }> = [
  { value: "autoridade", label: "Construir autoridade", copy: "Ensinar e fortalecer posicionamento." },
  { value: "demanda", label: "Atrair oportunidades", copy: "Gerar interesse e novas conversas." },
  { value: "conversao", label: "Divulgar uma oferta", copy: "Apresentar valor e orientar a próxima ação." },
  { value: "educacao", label: "Explicar um tema", copy: "Organizar uma ideia de forma útil e clara." },
  { value: "relacionamento", label: "Manter presença", copy: "Criar proximidade e continuidade." },
];

const formats: Array<{ value: ContentUnitType; label: string; channels?: Channel[]; instruction?: string }> = [
  { value: "static_post", label: "Post com imagem" },
  { value: "carousel", label: "Carrossel" },
  { value: "story", label: "Stories", channels: ["Instagram", "Facebook"] },
  { value: "short_video_script", label: "Roteiro curto", channels: ["Instagram", "Facebook", "LinkedIn"] },
  { value: "channel_adaptation", label: "Texto longo", channels: ["LinkedIn"], instruction: "Produza um texto longo para LinkedIn, com estrutura editorial, subtítulos curtos e conclusão prática." },
];

const statusLabels: Record<ContentRequest["status"], string> = {
  queued: "Na fila",
  processing: "Em produção",
  ready: "Pronto para revisar",
  approved: "Aprovado",
  revision_requested: "Em revisão",
  failed: "Falhou",
  cancelled: "Cancelado",
};

function selectedParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function CreateScreen() {
  const params = useLocalSearchParams<{ channel?: string }>();
  const { width } = useWindowDimensions();
  const { token, dashboard, updateDashboard, refresh } = useSession();
  const requestedChannel = selectedParam(params.channel);
  const [brandId, setBrandId] = useState(dashboard?.brands[0]?.id || "");
  const [channel, setChannel] = useState<Channel>(channels.includes(requestedChannel as Channel) ? requestedChannel as Channel : "Instagram");
  const [objective, setObjective] = useState<ContentObjective>("autoridade");
  const [contentType, setContentType] = useState<ContentUnitType>("static_post");
  const [brief, setBrief] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [request, setRequest] = useState<ContentRequest | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!brandId && dashboard?.brands[0]) setBrandId(dashboard.brands[0].id);
  }, [brandId, dashboard]);

  useEffect(() => {
    if (requestedChannel && channels.includes(requestedChannel as Channel)) setChannel(requestedChannel as Channel);
  }, [requestedChannel]);

  useEffect(() => {
    if (!request || !token || !["queued", "processing", "revision_requested"].includes(request.status)) return;
    const timer = setInterval(() => {
      getContent(token, request.id)
        .then(setRequest)
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [request, token]);

  if (dashboard && dashboard.brands.length === 0) return <Redirect href="/setup" />;
  if (!dashboard) return <Screen><Text style={typography.body}>Sincronizando sua conta...</Text></Screen>;

  const availableFormats = formats.filter((item) => !item.channels || item.channels.includes(channel));
  const selectedFormat = formats.find((item) => item.value === contentType);
  const cost = contentCreditCost[contentType];
  const canCreate = Boolean(brandId && brief.trim().length >= 10 && dashboard.usage.creditsRemaining >= cost);
  const compactOptions = width < 390;

  function changeChannel(next: Channel) {
    setChannel(next);
    const valid = formats.some((item) => item.value === contentType && (!item.channels || item.channels.includes(next)));
    if (!valid) setContentType("static_post");
  }

  async function submit() {
    if (!token || !canCreate) return;
    setSubmitting(true);
    setError("");
    setRequest(null);
    try {
      const finalBrief = [selectedFormat?.instruction, brief.trim()].filter(Boolean).join("\n\n");
      const result = await createContent(token, { brandId, channel, objective, contentType, brief: finalBrief });
      setRequest(result.request);
      updateDashboard({ ...dashboard!, usage: result.usage });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar esta criação.");
    } finally {
      setSubmitting(false);
    }
  }

  async function approve() {
    if (!token || !request) return;
    setApproving(true);
    setError("");
    try {
      setRequest(await approveContent(token, request.id));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível aprovar esta entrega.");
    } finally {
      setApproving(false);
    }
  }

  async function shareCopy() {
    if (!request?.output) return;
    const output = request.output;
    await Share.share({
      title: output.title,
      message: [output.caption, output.cta, output.hashtags.join(" ")].filter(Boolean).join("\n\n"),
    });
  }

  const output = request?.output;

  return (
    <Screen>
      <SectionHeading
        eyebrow="MODO CREATE"
        title="O que precisa ganhar forma?"
        copy="Comece pela intenção. A MODO usa o contexto da marca para preparar texto, direção e imagem para sua revisão."
      />

      <Card style={styles.form}>
        {dashboard.brands.length > 1 ? (
          <View style={styles.group}>
            <Text style={typography.label}>Contexto ativo</Text>
            <View style={styles.options}>
              {dashboard.brands.map((brand) => (
                <Option key={brand.id} selected={brandId === brand.id} label={brand.name} onPress={() => setBrandId(brand.id)} compact={compactOptions} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.group}>
          <Text style={typography.label}>Canal</Text>
          <View style={styles.options}>{channels.map((item) => <Option key={item} selected={channel === item} label={item} onPress={() => changeChannel(item)} compact={compactOptions} />)}</View>
        </View>

        <View style={styles.group}>
          <Text style={typography.label}>Resultado desejado</Text>
          <View style={styles.objectives}>
            {objectives.map((item) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: objective === item.value }}
                key={item.value}
                onPress={() => setObjective(item.value)}
                style={[styles.objective, objective === item.value && styles.objectiveSelected]}
              >
                <Text style={[styles.objectiveTitle, objective === item.value && styles.selectedText]}>{item.label}</Text>
                <Text style={styles.objectiveCopy}>{item.copy}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.group}>
          <Text style={typography.label}>Formato recomendado</Text>
          <View style={styles.options}>
            {availableFormats.map((item) => <Option key={item.value} selected={contentType === item.value} label={item.label} onPress={() => setContentType(item.value)} compact={compactOptions} />)}
          </View>
        </View>

        <Field
          label="Conte a intenção, novidade ou material de partida"
          value={brief}
          onChangeText={setBrief}
          multiline
          maxLength={1900}
          placeholder="Ex.: Quero apresentar nosso novo serviço, explicar para quem ele serve e convidar as pessoas para uma conversa."
          hint="Não precisa escrever um prompt. Fatos, objetivo e restrições já são suficientes."
        />

        <View style={styles.costRow}>
          <Text style={typography.small}>Custo desta criação</Text>
          <Pill tone={dashboard.usage.creditsRemaining >= cost ? "green" : "warning"}>{cost} crédito{cost > 1 ? "s" : ""}</Pill>
        </View>
        {dashboard.usage.creditsRemaining < cost ? <ErrorNotice message="Seu saldo atual não cobre este formato. Seus direitos são sincronizados com a conta MODO." /> : null}
        {error ? <ErrorNotice message={error} /> : null}
        <Button onPress={() => void submit()} disabled={!canCreate} loading={submitting}>Criar para revisão</Button>
      </Card>

      {request ? (
        <Card style={styles.result}>
          <View style={styles.resultHead}>
            <View><Text style={styles.eyebrow}>ENTREGA</Text><Text style={typography.h2}>{output?.title || "Produção em andamento"}</Text></View>
            <Pill tone={request.status === "approved" ? "green" : request.status === "failed" ? "warning" : "blue"}>{statusLabels[request.status]}</Pill>
          </View>

          {output?.imageUrl ? (
            <Pressable accessibilityRole="imagebutton" onPress={() => void Linking.openURL(output.imageUrl!)}>
              <Image source={{ uri: output.imageUrl }} resizeMode="cover" style={styles.image} accessibilityLabel={output.imageAlt || "Imagem criada pela MODO"} />
            </Pressable>
          ) : null}

          {output ? (
            <>
              <View style={styles.outputBlock}><Text style={styles.outputLabel}>TEXTO</Text><Text selectable style={styles.outputText}>{output.caption}</Text></View>
              <View style={styles.outputBlock}><Text style={styles.outputLabel}>CHAMADA</Text><Text selectable style={styles.outputText}>{output.cta}</Text></View>
              {output.hashtags.length ? <Text selectable style={styles.hashtags}>{output.hashtags.join(" ")}</Text> : null}
              {request.status === "ready" ? <Button onPress={() => void approve()} loading={approving}>Aprovar entrega</Button> : null}
              {request.status === "approved" ? <Button variant="secondary" onPress={() => void shareCopy()}>Compartilhar texto aprovado</Button> : null}
            </>
          ) : (
            <View style={styles.processing}><Text style={styles.processingMark}>✦</Text><Text style={typography.body}>Texto, direção visual e imagem estão sendo preparados. Você pode continuar usando o aplicativo.</Text></View>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

function Option({ selected, label, onPress, compact }: { selected: boolean; label: string; onPress: () => void; compact: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.option, compact && styles.optionCompact, selected && styles.optionSelected]}
    >
      <Text style={[styles.optionText, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  group: { gap: spacing.sm },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  option: { minHeight: 43, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  optionCompact: { paddingHorizontal: 11 },
  optionSelected: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  optionText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  selectedText: { color: colors.blue },
  objectives: { gap: 9 },
  objective: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.medium, padding: spacing.md, gap: 4 },
  objectiveSelected: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  objectiveTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  objectiveCopy: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  costRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  result: { gap: spacing.lg },
  resultHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 5 },
  image: { width: "100%", aspectRatio: 1, borderRadius: radii.medium, backgroundColor: colors.background },
  outputBlock: { gap: 7 },
  outputLabel: { color: colors.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  outputText: { color: colors.text, fontSize: 15, lineHeight: 24 },
  hashtags: { color: colors.blue, fontSize: 13, lineHeight: 20, fontWeight: "700" },
  processing: { alignItems: "center", paddingVertical: spacing.lg, gap: spacing.sm },
  processingMark: { color: colors.blue, fontSize: 34 },
});
