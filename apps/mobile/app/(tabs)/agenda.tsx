import type { ContentRequest } from "@modo/contracts/content";
import type { NativePublication } from "@modo/contracts/native-publisher";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Image, Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { listContent } from "../../src/api";
import { cancelPublisherPublication, listPublisherPublications } from "../../src/publisher";
import { useSession } from "../../src/session";
import { Button, Card, EmptyState, ErrorNotice, Pill, Screen, SectionHeading, typography } from "../../src/ui";
import { colors, radii, spacing } from "../../src/theme";

type Filter = "active" | "approved" | "all";

const statusLabels: Record<ContentRequest["status"], string> = {
  queued: "Na fila",
  processing: "Em produção",
  ready: "Pronto para revisar",
  approved: "Aprovado",
  revision_requested: "Em revisão",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const publicationLabels: Record<NativePublication["status"], string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  retrying: "Nova tentativa",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const providerLabels = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  threads: "Threads",
} as const;

const typeLabels = {
  static_post: "Post",
  story: "Stories",
  carousel: "Carrossel",
  short_video_script: "Roteiro",
  channel_adaptation: "Texto longo",
} as const;

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function AgendaScreen() {
  const { token, dashboard } = useSession();
  const [items, setItems] = useState<ContentRequest[]>([]);
  const [publications, setPublications] = useState<NativePublication[]>([]);
  const [filter, setFilter] = useState<Filter>("active");
  const [refreshing, setRefreshing] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [content, publicationGroups] = await Promise.all([
        listContent(token),
        Promise.all((dashboard?.brands || []).map((brand) => listPublisherPublications(token, brand.id).catch(() => []))),
      ]);
      setItems(content);
      setPublications(publicationGroups.flat());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar sua agenda.");
    }
  }, [dashboard?.brands, token]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const visible = useMemo(() => items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "approved") return item.status === "approved";
    return ["queued", "processing", "ready", "revision_requested"].includes(item.status);
  }), [filter, items]);

  const publicationTimeline = useMemo(
    () => publications
      .filter((item) => ["scheduled", "publishing", "published", "retrying", "failed"].includes(item.status))
      .sort((a, b) => {
        const aDate = new Date(a.scheduledFor || a.publishedAt || a.updatedAt).getTime();
        const bDate = new Date(b.scheduledFor || b.publishedAt || b.updatedAt).getTime();
        return bDate - aDate;
      }),
    [publications],
  );

  async function pull() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function share(item: ContentRequest) {
    if (!item.output) return;
    await Share.share({
      title: item.output.title,
      message: [item.output.caption, item.output.cta, item.output.hashtags.join(" ")].filter(Boolean).join("\n\n"),
    });
  }

  async function cancel(publication: NativePublication) {
    if (!token) return;
    setWorkingId(publication.id);
    setError("");
    try {
      await cancelPublisherPublication(token, publication.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível cancelar o agendamento.");
    } finally {
      setWorkingId("");
    }
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => void pull()}>
      <SectionHeading
        eyebrow="AGENDA E PUBLICAÇÃO"
        title="Tudo o que está em movimento."
        copy="Acompanhe criação, aprovação, agendamentos e o que já foi publicado diretamente pela MODO."
      />

      {error ? <ErrorNotice message={error} /> : null}

      {publicationTimeline.length ? (
        <View style={styles.publicationSection}>
          <View><Text style={styles.eyebrow}>PUBLICAÇÕES</Text><Text style={typography.h2}>Programadas e recentes</Text></View>
          {publicationTimeline.map((publication) => {
            const content = items.find((item) => item.id === publication.contentRequestId);
            const when = publication.publishedAt || publication.scheduledFor || publication.updatedAt;
            return (
              <Card key={publication.id} style={styles.publicationCard}>
                <View style={styles.topline}>
                  <Pill tone={publication.status === "published" ? "green" : publication.status === "failed" ? "warning" : "blue"}>{publicationLabels[publication.status]}</Pill>
                  <Text style={styles.date}>{dateLabel(when)}</Text>
                </View>
                <Text style={styles.meta}>{providerLabels[publication.provider].toUpperCase()}</Text>
                <Text numberOfLines={2} style={typography.h3}>{content?.output?.title || content?.brief || "Publicação MODO"}</Text>
                {publication.lastError ? <ErrorNotice message={publication.lastError} /> : null}
                {publication.permalink ? <Button variant="ghost" onPress={() => void Linking.openURL(publication.permalink!)}>Abrir publicação</Button> : null}
                {publication.status === "scheduled" ? <Button variant="ghost" onPress={() => void cancel(publication)} loading={workingId === publication.id}>Cancelar agendamento</Button> : null}
              </Card>
            );
          })}
        </View>
      ) : null}

      <View style={styles.productionHeading}><Text style={styles.eyebrow}>CRIAÇÃO E APROVAÇÃO</Text><Text style={typography.h2}>Produção</Text></View>

      <View style={styles.filters}>
        <FilterButton label="Em andamento" selected={filter === "active"} onPress={() => setFilter("active")} />
        <FilterButton label="Aprovados" selected={filter === "approved"} onPress={() => setFilter("approved")} />
        <FilterButton label="Todos" selected={filter === "all"} onPress={() => setFilter("all")} />
      </View>

      {visible.length ? visible.map((item) => (
        <Card key={item.id} style={styles.item}>
          <View style={styles.topline}>
            <Pill tone={item.status === "approved" ? "green" : item.status === "failed" ? "warning" : "blue"}>{statusLabels[item.status]}</Pill>
            <Text style={styles.date}>{dateLabel(item.createdAt)}</Text>
          </View>
          <View style={styles.contentRow}>
            {item.output?.imageUrl ? <Image source={{ uri: item.output.imageUrl }} style={styles.thumb} accessibilityLabel={item.output.imageAlt || "Imagem criada pela MODO"} /> : (
              <View style={styles.thumbPlaceholder}><Text style={styles.thumbMark}>✦</Text></View>
            )}
            <View style={styles.itemCopy}>
              <Text style={styles.meta}>{item.channel.toUpperCase()} · {typeLabels[item.contentType]}</Text>
              <Text numberOfLines={2} style={typography.h3}>{item.output?.title || item.brief}</Text>
              <Text numberOfLines={2} style={typography.small}>{item.output?.caption || "Texto e visual em preparação."}</Text>
            </View>
          </View>
          {item.status === "approved" && item.output ? (
            <Pressable accessibilityRole="button" onPress={() => void share(item)} style={styles.share}>
              <Text style={styles.shareText}>Compartilhar texto aprovado</Text>
            </Pressable>
          ) : null}
        </Card>
      )) : (
        <EmptyState
          title={filter === "active" ? "Nenhuma produção em andamento" : filter === "approved" ? "Nenhum conteúdo aprovado ainda" : "Seu histórico aparecerá aqui"}
          copy="Crie uma entrega, aprove e publique ou agende diretamente pela MODO."
        />
      )}
    </Screen>
  );
}

function FilterButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.filter, selected && styles.filterSelected]}>
      <Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  publicationSection: { gap: spacing.md },
  productionHeading: { gap: 4, marginTop: spacing.md },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  publicationCard: { gap: spacing.sm, borderColor: "#C9D6FF" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: { minHeight: 42, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterSelected: { borderColor: colors.blue, backgroundColor: colors.blueSoft },
  filterText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  filterTextSelected: { color: colors.blue },
  item: { gap: spacing.md },
  topline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  date: { color: colors.subtle, fontSize: 10, fontWeight: "700" },
  contentRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  thumb: { width: 86, height: 86, borderRadius: radii.medium, backgroundColor: colors.background },
  thumbPlaceholder: { width: 86, height: 86, borderRadius: radii.medium, backgroundColor: colors.blueSoft, alignItems: "center", justifyContent: "center" },
  thumbMark: { color: colors.blue, fontSize: 27 },
  itemCopy: { flex: 1, gap: 5 },
  meta: { color: colors.blue, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  share: { minHeight: 44, borderRadius: radii.medium, backgroundColor: colors.greenSoft, alignItems: "center", justifyContent: "center" },
  shareText: { color: "#087A56", fontSize: 12, fontWeight: "900" },
});
