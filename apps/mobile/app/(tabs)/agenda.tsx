import type { ContentRequest } from "@modo/contracts/content";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { listContent } from "../../src/api";
import { useSession } from "../../src/session";
import { Card, EmptyState, ErrorNotice, Pill, Screen, SectionHeading, typography } from "../../src/ui";
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
  const { token } = useSession();
  const [items, setItems] = useState<ContentRequest[]>([]);
  const [filter, setFilter] = useState<Filter>("active");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setItems(await listContent(token));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar sua agenda.");
    }
  }, [token]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const visible = useMemo(() => items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "approved") return item.status === "approved";
    return ["queued", "processing", "ready", "revision_requested"].includes(item.status);
  }), [filter, items]);

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

  return (
    <Screen refreshing={refreshing} onRefresh={() => void pull()}>
      <SectionHeading
        eyebrow="AGENDA E PRODUÇÃO"
        title="Tudo o que está em movimento."
        copy="Acompanhe entregas em produção, itens prontos para revisão e conteúdos já aprovados. A data de publicação continua sob seu controle."
      />

      <View style={styles.filters}>
        <FilterButton label="Em andamento" selected={filter === "active"} onPress={() => setFilter("active")} />
        <FilterButton label="Aprovados" selected={filter === "approved"} onPress={() => setFilter("approved")} />
        <FilterButton label="Todos" selected={filter === "all"} onPress={() => setFilter("all")} />
      </View>

      {error ? <ErrorNotice message={error} /> : null}

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
          copy="Crie uma entrega e acompanhe cada etapa até a aprovação."
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
