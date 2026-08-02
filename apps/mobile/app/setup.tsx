import { nicheLabels, type Niche } from "@modo/contracts";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { createBrand } from "../src/api";
import { useSession } from "../src/session";
import { BrandMark, Button, Card, ErrorNotice, Field, Pill, Screen, SectionHeading, typography } from "../src/ui";
import { colors, radii, spacing } from "../src/theme";

const suggestedNiches: Niche[] = [
  "servicos_profissionais",
  "saude_estetica",
  "imoveis",
  "varejo",
  "educacao",
  "creator",
  "outro",
];

function normalizeUrl(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
}

export default function SetupScreen() {
  const { token, refresh } = useSession();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [niche, setNiche] = useState<Niche>("servicos_profissionais");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSave = useMemo(() => name.trim().length >= 2, [name]);

  async function save() {
    if (!token || !canSave) return;
    setSaving(true);
    setError("");
    try {
      await createBrand(token, {
        name: name.trim(),
        websiteUrl: normalizeUrl(website),
        instagramHandle: instagram.trim(),
        niche,
      });
      await refresh();
      router.replace("/(tabs)");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível configurar sua marca.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={styles.top}><BrandMark /><Pill>PRIMEIRO CONTEXTO</Pill></View>
      <SectionHeading
        eyebrow="COMECE PELO QUE JÁ EXISTE"
        title="O que a MODO vai acompanhar?"
        copy="Informe o básico agora. Depois você poderá enriquecer o contexto com links, materiais, textos e outras referências."
      />
      <Card style={styles.form}>
        <Field label="Nome da empresa, marca, perfil ou projeto" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Site ou página principal" value={website} onChangeText={setWebsite} autoCapitalize="none" keyboardType="url" placeholder="exemplo.com.br" hint="Opcional. A MODO usará esse endereço como uma das fontes de contexto." />
        <Field label="Instagram" value={instagram} onChangeText={setInstagram} autoCapitalize="none" placeholder="@perfil" />
        <View style={styles.segment}>
          <Text style={typography.label}>Área principal</Text>
          <View style={styles.chips}>
            {suggestedNiches.map((item) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: niche === item }}
                key={item}
                onPress={() => setNiche(item)}
                style={[styles.chip, niche === item && styles.chipSelected]}
              >
                <Text style={[styles.chipText, niche === item && styles.chipTextSelected]}>{nicheLabels[item]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {error ? <ErrorNotice message={error} /> : null}
        <Button onPress={() => void save()} disabled={!canSave} loading={saving}>Confirmar contexto inicial</Button>
      </Card>
      <Text style={styles.note}>Você poderá revisar essas informações antes de cada criação. A MODO não publica nada automaticamente.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  form: { gap: spacing.lg },
  segment: { gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  chip: { minHeight: 42, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { backgroundColor: colors.blueSoft, borderColor: colors.blue },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  chipTextSelected: { color: colors.blue },
  note: { ...typography.small, textAlign: "center", paddingHorizontal: spacing.lg },
});
