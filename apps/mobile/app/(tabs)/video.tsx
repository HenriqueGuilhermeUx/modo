import { contentCreditCost } from "@modo/contracts";
import type { ContentObjective, ContentRequest } from "@modo/contracts/content";
import type { NativeConnection, NativePublisherProvider } from "@modo/contracts/native-publisher";
import type { VideoDurationSeconds, VideoProject, VideoScene } from "@modo/contracts/video";
import {
  evaluateVideoFirstCut,
  explicitVideoCreativeProfile,
  inferVideoCreativeProfile,
  videoAutoSceneSignature,
  videoCreativeProfileSignature,
  type VideoCreativeProfile,
  type VideoCreativeProfileChoice,
} from "@modo/contracts/video-first-cut";
import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { approveContent, createContent, getContent, listContent } from "../../src/api";
import {
  createPublisherPublication,
  listPublisherConnections,
  startPublisherConnection,
} from "../../src/publisher";
import { useSession } from "../../src/session";
import { colors, radii, spacing } from "../../src/theme";
import { BrandMark, Button, Card, ErrorNotice, Field, Pill, Screen, SectionHeading, typography } from "../../src/ui";
import {
  approveVideoProject,
  approveVideoScene,
  createVideoProject,
  getLatestVideoProject,
  getVideoProject,
  regenerateVideoScene,
  retryVideoProject,
  updateVideoScene,
} from "../../src/video";

const durations: VideoDurationSeconds[] = [15, 30, 45];
const objectives: Array<{ id: ContentObjective; label: string }> = [
  { id: "autoridade", label: "Autoridade" },
  { id: "demanda", label: "Oportunidades" },
  { id: "conversao", label: "Oferta" },
  { id: "educacao", label: "Educar" },
  { id: "relacionamento", label: "Presença" },
];
const profiles: Array<{ id: VideoCreativeProfile; label: string; copy: string }> = [
  { id: "editorial", label: "Editorial", copy: "Claro e equilibrado" },
  { id: "premium", label: "Premium", copy: "Mais respiro" },
  { id: "human", label: "Humano", copy: "Mais proximidade" },
  { id: "dynamic", label: "Dinâmico", copy: "Mais energia" },
];
const providers: Array<{ id: NativePublisherProvider; label: string }> = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
];

function statusLabel(project: VideoProject) {
  if (project.status === "queued") return "Na fila";
  if (project.status === "rendering") return "Montando Reel";
  if (project.status === "ready") return "Reel pronto";
  if (project.status === "failed") return "Render interrompido";
  return "Cancelado";
}

function contentStatusLabel(request: ContentRequest) {
  if (request.status === "queued") return "Preparando estratégia";
  if (request.status === "processing") return "Criando roteiro";
  if (request.status === "ready") return "Roteiro pronto";
  if (request.status === "approved") return "Roteiro aprovado";
  if (request.status === "failed") return "Criação interrompida";
  return "Em revisão";
}

function visualLabel(scene: VideoScene) {
  if (scene.visualType === "broll_video") return "B-roll";
  if (scene.visualType === "generated_image") return "Imagem IA";
  if (scene.visualType === "brand_asset") return "Marca";
  if (scene.visualType === "interface") return "Interface";
  if (scene.visualType === "data_card") return "Data card";
  return "Texto cinético";
}

export default function VideoScreen() {
  const { token, dashboard, updateDashboard } = useSession();
  const [brandId, setBrandId] = useState(dashboard?.brands[0]?.id || "");
  const [brief, setBrief] = useState("");
  const [objective, setObjective] = useState<ContentObjective>("demanda");
  const [duration, setDuration] = useState<VideoDurationSeconds>(30);
  const [captions, setCaptions] = useState(true);
  const [voiceover, setVoiceover] = useState(true);
  const [request, setRequest] = useState<ContentRequest | null>(null);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [working, setWorking] = useState(false);
  const [workingScene, setWorkingScene] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [provider, setProvider] = useState<NativePublisherProvider>("instagram");
  const [connections, setConnections] = useState<NativeConnection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);

  useEffect(() => {
    if (!brandId && dashboard?.brands[0]) setBrandId(dashboard.brands[0].id);
  }, [brandId, dashboard]);

  const loadLatest = useCallback(async () => {
    if (!token) return;
    try {
      const items = await listContent(token);
      const latest = items.find((item) => item.contentType === "short_video_script") || null;
      setRequest((current) => current || latest);
      if (latest) {
        const latestProject = await getLatestVideoProject(token, latest.id).catch(() => null);
        setProject((current) => current || latestProject);
      }
    } catch {
      // A aba continua utilizável para uma nova criação mesmo sem histórico.
    }
  }, [token]);

  useFocusEffect(useCallback(() => {
    void loadLatest();
  }, [loadLatest]));

  useEffect(() => {
    if (!request || !token || !["queued", "processing", "revision_requested"].includes(request.status)) return;
    const timer = setInterval(() => {
      getContent(token, request.id).then(setRequest).catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [request?.id, request?.status, token]);

  useEffect(() => {
    if (!project || !token || !["queued", "rendering"].includes(project.status)) return;
    const timer = setInterval(() => {
      getVideoProject(token, project.id).then(setProject).catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [project?.id, project?.status, token]);

  const quality = useMemo(() => project ? evaluateVideoFirstCut(project.scenes) : null, [project]);
  const explicitProfile = useMemo(() => project ? explicitVideoCreativeProfile(project.scenes[0]) : null, [project]);
  const inferredProfile = useMemo(() => project ? inferVideoCreativeProfile(project.scenes) : "editorial", [project]);
  const approvedSceneCount = project?.review?.scenes.filter((item) => item.status === "approved").length || 0;
  const allScenesApproved = Boolean(project && project.scenes.length > 0 && approvedSceneCount === project.scenes.length);
  const finalApproved = project?.review?.approvalStatus === "approved";
  const anyApproved = Boolean(project?.review?.scenes.some((scene) => scene.status === "approved") || finalApproved);
  const cost = contentCreditCost.short_video_script;
  const canCreate = Boolean(brandId && brief.trim().length >= 10 && (dashboard?.usage.creditsRemaining || 0) >= cost);

  if (dashboard && dashboard.brands.length === 0) return <Redirect href="/setup" />;
  if (!dashboard) return <Screen><Text style={typography.body}>Sincronizando sua operação...</Text></Screen>;

  function resetFlow() {
    setBrief("");
    setRequest(null);
    setProject(null);
    setConnections([]);
    setError("");
    setMessage("");
  }

  async function createScript() {
    if (!token || !canCreate) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const result = await createContent(token, {
        brandId,
        channel: "Instagram",
        objective,
        contentType: "short_video_script",
        brief: `Crie um roteiro de vídeo vertical 9:16 pensado para Reel. Objetivo principal: ${brief.trim()}`,
      });
      setRequest(result.request);
      setProject(null);
      updateDashboard({ ...dashboard!, usage: result.usage });
      setMessage("A MODO está transformando seu objetivo em roteiro e direção visual.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível iniciar o vídeo.");
    } finally {
      setWorking(false);
    }
  }

  async function approveScript() {
    if (!token || !request) return;
    setWorking(true);
    setError("");
    try {
      setRequest(await approveContent(token, request.id));
      setMessage("Roteiro aprovado. Agora a MODO pode montar o primeiro corte.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível aprovar o roteiro.");
    } finally {
      setWorking(false);
    }
  }

  async function buildVideo() {
    if (!token || !request) return;
    setWorking(true);
    setError("");
    try {
      setProject(await createVideoProject(token, {
        contentRequestId: request.id,
        durationSeconds: duration,
        captions,
        voiceover,
      }));
      setMessage("Primeiro corte iniciado. Você pode sair desta aba e voltar depois.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível montar o Reel.");
    } finally {
      setWorking(false);
    }
  }

  async function applyProfile(choice: VideoCreativeProfileChoice) {
    if (!token || !project || anyApproved || ["queued", "rendering"].includes(project.status)) return;
    const first = project.scenes[0];
    if (!first) return;
    setWorking(true);
    setError("");
    try {
      const signature = choice === "auto" ? videoAutoSceneSignature(first) : videoCreativeProfileSignature(choice);
      setProject(await updateVideoScene(token, project.id, first.index, signature));
      setMessage("Direção estética atualizada sem gerar nova mídia.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível trocar a direção estética.");
    } finally {
      setWorking(false);
    }
  }

  async function regenerate(sceneIndex: number) {
    if (!token || !project) return;
    setWorkingScene(sceneIndex);
    setError("");
    try {
      setProject(await regenerateVideoScene(token, project.id, sceneIndex));
      setMessage(`Cena ${sceneIndex}: a MODO está buscando uma nova alternativa visual.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível trocar esta cena.");
    } finally {
      setWorkingScene(null);
    }
  }

  async function approveScene(sceneIndex: number) {
    if (!token || !project) return;
    setWorkingScene(sceneIndex);
    setError("");
    try {
      setProject(await approveVideoScene(token, project.id, sceneIndex));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível aprovar esta cena.");
    } finally {
      setWorkingScene(null);
    }
  }

  async function approveFinal() {
    if (!token || !project) return;
    setWorking(true);
    setError("");
    try {
      setProject(await approveVideoProject(token, project.id));
      setMessage("Reel aprovado. Agora ele está liberado para o Publisher.");
      await refreshConnections();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível aprovar o Reel final.");
    } finally {
      setWorking(false);
    }
  }

  async function retryRender() {
    if (!token || !project) return;
    setWorking(true);
    setError("");
    try {
      setProject(await retryVideoProject(token, project.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível tentar o render novamente.");
    } finally {
      setWorking(false);
    }
  }

  async function refreshConnections() {
    if (!token || !brandId) return;
    setLoadingConnections(true);
    setError("");
    try {
      setConnections(await listPublisherConnections(token, brandId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar suas redes.");
    } finally {
      setLoadingConnections(false);
    }
  }

  async function connect() {
    if (!token || !brandId) return;
    setWorking(true);
    setError("");
    try {
      const url = await startPublisherConnection(token, provider, brandId);
      await Linking.openURL(url);
      setMessage("Conclua a autorização e volte ao app. Depois toque em Atualizar contas.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir a conexão social.");
    } finally {
      setWorking(false);
    }
  }

  async function publish() {
    if (!token || !project || !request || !finalApproved) return;
    const connection = connections.find((item) => item.provider === provider && item.connected && item.canPublish);
    if (!connection) {
      setError(`Conecte uma conta de ${provider === "instagram" ? "Instagram" : "Facebook"} antes de publicar.`);
      return;
    }
    setWorking(true);
    setError("");
    try {
      const publication = await createPublisherPublication(token, {
        contentRequestId: request.id,
        brandId: request.brandId,
        provider,
        connectionId: connection.id,
        videoProjectId: project.id,
        mode: "now",
        idempotencyKey: `mobile-video-${project.id}-${provider}`,
      });
      setMessage(publication.status === "published" ? "Publicado com sucesso." : "Publicação enviada ao Publisher. A MODO acompanha a entrega.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível publicar o Reel.");
    } finally {
      setWorking(false);
    }
  }

  const eligibleConnections = connections.filter((item) => item.provider === provider && item.connected && item.canPublish);

  return (
    <Screen>
      <View style={styles.header}>
        <BrandMark />
        <Pill tone="purple">MODO VIDEO</Pill>
      </View>

      <SectionHeading
        eyebrow="DO OBJETIVO AO REEL"
        title="Seu primeiro corte já chega montado."
        copy="Estratégia, roteiro, cenas, B-roll e imagens, narração, trilha, legendas, ritmo e transições. Você revisa só o que quiser mudar."
      />

      {error ? <ErrorNotice message={error} /> : null}
      {message ? <Card style={styles.messageCard}><Text style={styles.message}>{message}</Text></Card> : null}

      {!request ? (
        <Card style={styles.stack}>
          <Text style={typography.h2}>1. O que este Reel precisa fazer?</Text>
          <Field
            label="Objetivo em linguagem simples"
            placeholder="Ex.: apresentar a MODO para empresários que perdem tempo editando conteúdo."
            value={brief}
            onChangeText={setBrief}
            multiline
            maxLength={1700}
            hint={`Vídeo curto usa ${cost} crédito(s). A MODO usa o contexto da sua marca para completar a direção.`}
          />
          <Text style={styles.label}>Resultado principal</Text>
          <View style={styles.optionGrid}>
            {objectives.map((item) => (
              <Pressable key={item.id} onPress={() => setObjective(item.id)} style={[styles.option, objective === item.id && styles.optionSelected]}>
                <Text style={[styles.optionText, objective === item.id && styles.optionTextSelected]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <Button onPress={() => void createScript()} disabled={!canCreate} loading={working}>Criar roteiro com a MODO</Button>
        </Card>
      ) : (
        <Card style={styles.stack}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}><Text style={typography.h2}>2. Estratégia e roteiro</Text><Text style={typography.small}>{contentStatusLabel(request)}</Text></View>
            <Pill tone={request.status === "approved" ? "green" : "blue"}>{request.status === "approved" ? "APROVADO" : "EM PRODUÇÃO"}</Pill>
          </View>
          <Text style={typography.h3}>{request.output?.title || request.brief}</Text>
          {request.output?.hook ? <Text style={styles.quote}>“{request.output.hook}”</Text> : <Text style={typography.body}>A MODO está escrevendo o gancho, a sequência de cenas e a chamada final.</Text>}
          {request.status === "ready" ? <Button onPress={() => void approveScript()} loading={working}>Aprovar roteiro</Button> : null}
          {request.status === "failed" ? <ErrorNotice message={request.error || "Não foi possível concluir o roteiro."} /> : null}
          <Button variant="ghost" onPress={resetFlow}>Começar outro vídeo</Button>
        </Card>
      )}

      {request?.status === "approved" && !project ? (
        <Card style={styles.stack}>
          <Text style={typography.h2}>3. Monte o primeiro corte</Text>
          <Text style={typography.body}>A direção criativa já está definida. Escolha apenas duração, legenda e voz.</Text>
          <View style={styles.durationRow}>
            {durations.map((item) => (
              <Pressable key={item} onPress={() => setDuration(item)} style={[styles.duration, duration === item && styles.durationSelected]}>
                <Text style={[styles.durationValue, duration === item && styles.durationValueSelected]}>{item}s</Text>
                <Text style={styles.durationCopy}>{item === 15 ? "Direto" : item === 30 ? "Equilibrado" : "Mais contexto"}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.toggleRow}><View style={styles.flex}><Text style={styles.label}>Legendas no vídeo</Text><Text style={typography.small}>Prontas para consumo sem som.</Text></View><Switch value={captions} onValueChange={setCaptions} trackColor={{ true: colors.blue }} /></View>
          <View style={styles.toggleRow}><View style={styles.flex}><Text style={styles.label}>Narração PT-BR</Text><Text style={typography.small}>Voz por IA sincronizada com as cenas.</Text></View><Switch value={voiceover} onValueChange={setVoiceover} trackColor={{ true: colors.blue }} /></View>
          <Button onPress={() => void buildVideo()} loading={working}>Gerar Reel</Button>
        </Card>
      ) : null}

      {project ? (
        <>
          <Card style={styles.stack}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}><Text style={typography.h2}>Primeiro corte</Text><Text style={typography.small}>{statusLabel(project)} · {project.durationSeconds}s · 9:16</Text></View>
              <Pill tone={project.status === "ready" ? "green" : project.status === "failed" ? "warning" : "purple"}>{project.status.toUpperCase()}</Pill>
            </View>
            {project.status === "failed" ? <Button onPress={() => void retryRender()} loading={working}>Tentar render novamente</Button> : null}
            {project.outputUrl ? <Button variant="secondary" onPress={() => void Linking.openURL(project.outputUrl!)}>Assistir MP4</Button> : null}
          </Card>

          {project.status === "ready" && quality ? (
            <Card style={styles.stack}>
              <View style={styles.qualityHead}>
                <View style={styles.flex}><Text style={styles.eyebrow}>FIRST CUT · QUALITY GATE</Text><Text style={typography.h2}>A MODO já fez a primeira edição.</Text></View>
                <View style={styles.score}><Text style={styles.scoreValue}>{quality.score}</Text><Text style={styles.scoreUnit}>/100</Text></View>
              </View>
              <Text style={typography.body}>{quality.summary}</Text>
              <Text style={styles.label}>Direção estética</Text>
              <View style={styles.profileGrid}>
                <Pressable disabled={anyApproved || working} onPress={() => void applyProfile("auto")} style={[styles.profile, !explicitProfile && styles.profileSelected]}>
                  <Text style={styles.profileTitle}>MODO decide</Text><Text style={styles.profileCopy}>Atual: {inferredProfile}</Text>
                </Pressable>
                {profiles.map((item) => (
                  <Pressable key={item.id} disabled={anyApproved || working} onPress={() => void applyProfile(item.id)} style={[styles.profile, explicitProfile === item.id && styles.profileSelected]}>
                    <Text style={styles.profileTitle}>{item.label}</Text><Text style={styles.profileCopy}>{item.copy}</Text>
                  </Pressable>
                ))}
              </View>
              {quality.checks.filter((item) => item.status === "warn").map((check) => <Text key={check.key} style={styles.warning}>! {check.label}: {check.detail}</Text>)}
              {anyApproved ? <Text style={styles.lock}>Direção global protegida após a primeira aprovação.</Text> : null}
            </Card>
          ) : null}

          {project.status === "ready" ? (
            <View style={styles.stack}>
              <SectionHeading eyebrow="STORYBOARD" title="Aprove cena por cena" copy="Se uma cena não estiver boa, troque só ela. O restante do Reel fica preservado." />
              {project.scenes.map((scene) => {
                const review = project.review?.scenes.find((item) => item.sceneIndex === scene.index);
                const approved = review?.status === "approved";
                return (
                  <Card key={scene.index} style={styles.sceneCard}>
                    <View style={styles.rowBetween}>
                      <Pill tone={approved ? "green" : "neutral"}>CENA {scene.index}</Pill>
                      <Text style={styles.sceneType}>{visualLabel(scene)}</Text>
                    </View>
                    <Text style={typography.h3}>{scene.headline}</Text>
                    <Text style={typography.body}>{scene.caption}</Text>
                    <View style={styles.sceneActions}>
                      {!approved ? <Button variant="ghost" onPress={() => void regenerate(scene.index)} loading={workingScene === scene.index}>Outro visual</Button> : null}
                      {!approved ? <Button onPress={() => void approveScene(scene.index)} loading={workingScene === scene.index}>Aprovar cena</Button> : <Text style={styles.approvedText}>✓ Cena aprovada</Text>}
                    </View>
                  </Card>
                );
              })}
            </View>
          ) : null}

          {project.status === "ready" ? (
            <Card style={styles.stack}>
              <Text style={typography.h2}>Aprovação final</Text>
              <Text style={typography.body}>{approvedSceneCount}/{project.scenes.length} cenas aprovadas. A publicação só é liberada depois da sua aprovação final.</Text>
              {!finalApproved ? <Button disabled={!allScenesApproved} onPress={() => void approveFinal()} loading={working}>Aprovar Reel final</Button> : <Pill tone="green">REEL APROVADO</Pill>}
            </Card>
          ) : null}

          {finalApproved ? (
            <Card style={styles.stack}>
              <Text style={typography.h2}>Publicar</Text>
              <Text style={typography.body}>Escolha a rede. A MODO envia o MP4 aprovado pelo Publisher V2.</Text>
              <View style={styles.providerRow}>
                {providers.map((item) => <Pressable key={item.id} onPress={() => setProvider(item.id)} style={[styles.option, provider === item.id && styles.optionSelected]}><Text style={[styles.optionText, provider === item.id && styles.optionTextSelected]}>{item.label}</Text></Pressable>)}
              </View>
              {eligibleConnections.length ? <Text style={styles.connected}>✓ {eligibleConnections[0].displayName} conectada</Text> : <Text style={typography.small}>Nenhuma conta publicável de {provider === "instagram" ? "Instagram" : "Facebook"} carregada.</Text>}
              <Button variant="ghost" onPress={() => void refreshConnections()} loading={loadingConnections}>Atualizar contas</Button>
              {!eligibleConnections.length ? <Button variant="secondary" onPress={() => void connect()} loading={working}>Conectar {provider === "instagram" ? "Instagram" : "Facebook"}</Button> : <Button onPress={() => void publish()} loading={working}>Publicar Reel agora</Button>}
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stack: { gap: spacing.md },
  messageCard: { backgroundColor: colors.greenSoft, borderColor: "#BDEEDC" },
  message: { color: "#087A56", fontSize: 13, lineHeight: 20, fontWeight: "800" },
  label: { color: colors.text, fontSize: 13, fontWeight: "900" },
  eyebrow: { color: colors.purple, fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  optionSelected: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  optionText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  optionTextSelected: { color: colors.blue },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  flex: { flex: 1 },
  quote: { color: colors.navy, fontSize: 18, lineHeight: 26, fontWeight: "800" },
  durationRow: { flexDirection: "row", gap: 8 },
  duration: { flex: 1, minHeight: 82, borderWidth: 1, borderColor: colors.border, borderRadius: radii.medium, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.surface },
  durationSelected: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  durationValue: { color: colors.navy, fontSize: 20, fontWeight: "900" },
  durationValueSelected: { color: colors.blue },
  durationCopy: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 4 },
  qualityHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  score: { width: 82, height: 82, borderRadius: 24, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  scoreValue: { color: colors.surface, fontSize: 27, fontWeight: "900" },
  scoreUnit: { color: "#B8C5E6", fontSize: 11, fontWeight: "800", marginTop: 8 },
  profileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  profile: { width: "48%", flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.medium, padding: spacing.md, backgroundColor: colors.surface },
  profileSelected: { borderColor: colors.purple, backgroundColor: colors.purpleSoft },
  profileTitle: { color: colors.navy, fontSize: 13, fontWeight: "900" },
  profileCopy: { color: colors.muted, fontSize: 11, marginTop: 3 },
  warning: { color: colors.warning, backgroundColor: colors.warningSoft, borderRadius: radii.small, padding: 10, fontSize: 11, lineHeight: 17, fontWeight: "700" },
  lock: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  sceneCard: { gap: spacing.md },
  sceneType: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  sceneActions: { gap: 8 },
  approvedText: { color: "#087A56", fontSize: 13, fontWeight: "900", paddingVertical: 10 },
  providerRow: { flexDirection: "row", gap: 8 },
  connected: { color: "#087A56", fontSize: 13, fontWeight: "900" },
});
