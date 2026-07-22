import type { ContentUnitType, Dashboard } from "@modo/contracts";
import type { ContentObjective } from "@modo/contracts/content";
import type { QuickStartOutcome, QuickStartSourceKind } from "@modo/contracts/source";
import { useRef, useState } from "react";
import {
  generateCreativePlan,
  getCreativeProfile,
  saveCreativeProfile,
} from "./director-api";
import { extractSource } from "./source-api";

interface PreparedContent {
  contentType: ContentUnitType;
  objective: ContentObjective;
  channel: string;
  brief: string;
}

interface Props {
  dashboard: Dashboard;
  brandId: string;
  onPrepared: (value: PreparedContent) => void;
}

const sourceOptions: Array<{ id: QuickStartSourceKind; title: string; copy: string }> = [
  { id: "ideas", title: "Preciso de ideias", copy: "A MODO começa pela realidade da marca." },
  { id: "topic", title: "Tenho um tema", copy: "Uma dúvida, assunto, oferta ou oportunidade." },
  { id: "url", title: "Tenho um link", copy: "Artigo, notícia, blog ou página de serviço." },
  { id: "text", title: "Tenho um texto", copy: "Rascunho, documento leve, case ou anotação." },
  { id: "transcript", title: "Tenho uma transcrição", copy: "Reunião, vídeo, entrevista ou áudio transcrito." },
  { id: "voice", title: "Quero ditar uma ideia", copy: "Fale livremente. A MODO organiza depois." },
];

const outcomeOptions: Array<{ id: QuickStartOutcome; title: string; copy: string }> = [
  { id: "decide", title: "A MODO decide", copy: "Formato e canal recomendados automaticamente." },
  { id: "post", title: "Uma publicação", copy: "Post completo para revisar e publicar." },
  { id: "carousel", title: "Um carrossel", copy: "Narrativa em páginas com direção visual." },
  { id: "video", title: "Um vídeo", copy: "Roteiro, abertura, cenas e orientação de gravação." },
  { id: "linkedin", title: "Conteúdo para LinkedIn", copy: "Autoridade profissional ou empresarial." },
  { id: "week", title: "Minha semana", copy: "Plano com ações pequenas e executáveis." },
  { id: "campaign", title: "Uma campanha", copy: "Movimentos coordenados para um objetivo." },
];

const objectiveOptions: Array<{ id: ContentObjective; label: string }> = [
  { id: "autoridade", label: "Construir autoridade" },
  { id: "demanda", label: "Gerar oportunidades" },
  { id: "conversao", label: "Apresentar uma oferta" },
  { id: "educacao", label: "Educar o público" },
  { id: "relacionamento", label: "Humanizar e aproximar" },
];

function normalizeUrl(value: string) {
  return /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
}

function fileText(file: File) {
  if (file.size > 250_000) throw new Error("Use um arquivo de texto com até 250 KB.");
  const allowed = ["text/plain", "text/markdown", "text/csv", "application/json"];
  if (file.type && !allowed.includes(file.type)) {
    throw new Error("Nesta versão, envie TXT, Markdown, CSV, JSON ou cole a transcrição.");
  }
  return file.text();
}

export default function QuickStart({ dashboard, brandId, onPrepared }: Props) {
  const [sourceKind, setSourceKind] = useState<QuickStartSourceKind>("ideas");
  const [outcome, setOutcome] = useState<QuickStartOutcome>("decide");
  const [objective, setObjective] = useState<ContentObjective>("autoridade");
  const [sourceValue, setSourceValue] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const brand = dashboard.brands.find((item) => item.id === brandId);

  async function resolveSource() {
    if (sourceKind === "ideas") {
      return "O cliente ainda não possui uma ideia definida. Use a memória da marca, as prioridades e o histórico para propor uma direção concreta, simples e relevante.";
    }
    if (sourceKind === "url") {
      if (!sourceValue.trim()) throw new Error("Cole o link que será usado como ponto de partida.");
      const extracted = await extractSource(normalizeUrl(sourceValue));
      setSourceTitle(extracted.title);
      return `FONTE: ${extracted.title}\nURL: ${extracted.sourceUrl}\n\nCONTEÚDO EXTRAÍDO:\n${extracted.text}`;
    }
    if (sourceValue.trim().length < 10) {
      throw new Error("Inclua um pouco mais de contexto para a MODO trabalhar.");
    }
    return sourceValue.trim();
  }

  function preparedFormat(source: string): PreparedContent {
    let contentType: ContentUnitType = "static_post";
    let channel = "Instagram";
    if (outcome === "carousel") contentType = "carousel";
    if (outcome === "video") contentType = "short_video_script";
    if (outcome === "linkedin") channel = "LinkedIn";
    if (outcome === "decide") {
      if (["url", "text", "transcript"].includes(sourceKind)) contentType = "carousel";
      if (sourceKind === "voice") contentType = "short_video_script";
      if (brand?.niche === "servicos_profissionais" || brand?.niche === "creator") channel = "LinkedIn";
    }

    const outcomeLabel = outcomeOptions.find((item) => item.id === outcome)?.title || "Uma publicação";
    const sourceLabel = sourceOptions.find((item) => item.id === sourceKind)?.title || "Contexto";
    return {
      contentType,
      objective,
      channel,
      brief: [
        "PEDIDO CRIADO PELO MODO QUICK START",
        `Marca: ${brand?.name || "Marca"}`,
        `Ponto de partida: ${sourceLabel}`,
        `Resultado desejado: ${outcomeLabel}`,
        `Objetivo: ${objectiveOptions.find((item) => item.id === objective)?.label}`,
        "",
        "MATÉRIA-PRIMA:",
        source,
        "",
        "DIREÇÃO:",
        outcome === "decide"
          ? "Atue como Diretor de Criação. Escolha um ângulo forte, evite conteúdo genérico e explique a mensagem de forma prática. Use o formato informado como melhor aproximação para a primeira entrega."
          : "Transforme a matéria-prima em uma entrega clara, específica e pronta para revisão. Preserve fatos reais e não invente números, clientes ou resultados.",
      ].join("\n").slice(0, 2000),
    };
  }

  async function prepare() {
    if (!brandId) return;
    setLoading(true);
    setError("");
    try {
      const source = await resolveSource();
      if (["week", "campaign"].includes(outcome)) {
        const profile = await getCreativeProfile(brandId);
        const label = outcome === "week" ? "Plano semanal" : "Campanha coordenada";
        await saveCreativeProfile({
          brandId,
          peopleAvailable: profile.peopleAvailable,
          comfortableOnCamera: profile.comfortableOnCamera,
          weeklyMinutesAvailable: profile.weeklyMinutesAvailable,
          locations: profile.locations,
          productsOrServicesToShow: profile.productsOrServicesToShow,
          proofAvailable: profile.proofAvailable,
          recurringQuestions: profile.recurringQuestions,
          currentPriorities: [
            label,
            objectiveOptions.find((item) => item.id === objective)?.label || "Presença digital",
          ],
          prohibitedTopics: profile.prohibitedTopics,
          preferredChannels: profile.preferredChannels,
          notes: `${profile.notes}\n\nQUICK START — ${label}:\n${source}`.trim().slice(0, 3000),
        });
        await generateCreativePlan(brandId);
        window.location.href = "/app/director";
        return;
      }
      onPrepared(preparedFormat(source));
      document.querySelector(".workspace-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível preparar esta fonte.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(file?: File) {
    if (!file) return;
    setError("");
    try {
      setSourceValue(await fileText(file));
      setSourceTitle(file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível ler o arquivo.");
    }
  }

  function startVoice() {
    const SpeechRecognition = (window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("O ditado não está disponível neste navegador. Use Chrome ou cole uma transcrição.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setError("Não conseguimos ouvir. Verifique a permissão do microfone.");
    };
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setSourceValue((current) => `${current} ${transcript}`.trim());
    };
    recognition.start();
  }

  return (
    <section className="quick-start">
      <div className="quick-start-heading">
        <div><small>MODO QUICK START</small><h2>Comece com o que você já tem.</h2><p>Você não precisa escrever um prompt. Entregue uma matéria-prima — ou peça ideias — e escolha o resultado.</p></div>
        <span>Resultado em poucos passos</span>
      </div>

      <div className="quick-start-step"><strong>1. O que você tem agora?</strong><div className="quick-source-grid">{sourceOptions.map((item) => <button type="button" className={sourceKind === item.id ? "selected" : ""} key={item.id} onClick={() => { setSourceKind(item.id); setSourceValue(""); setSourceTitle(""); setError(""); }}><b>{item.title}</b><span>{item.copy}</span></button>)}</div></div>

      {sourceKind !== "ideas" && (
        <div className="quick-source-input">
          {sourceKind === "url" ? (
            <label>Link da fonte<input value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder="https://..." /></label>
          ) : (
            <label>{sourceKind === "voice" ? "Sua ideia ditada" : sourceKind === "transcript" ? "Transcrição" : sourceKind === "topic" ? "Tema ou oportunidade" : "Texto ou conteúdo"}<textarea value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder={sourceKind === "voice" ? "Clique no microfone e fale naturalmente..." : "Cole ou escreva aqui..."} /></label>
          )}
          <div className="quick-source-tools">
            {["text", "transcript"].includes(sourceKind) && <><input ref={fileRef} hidden type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" onChange={(event) => void handleFile(event.target.files?.[0])} /><button type="button" onClick={() => fileRef.current?.click()}>Importar arquivo leve</button></>}
            {sourceKind === "voice" && <button type="button" className={listening ? "listening" : ""} onClick={startVoice}>{listening ? "● Ouvindo..." : "🎙 Ditar ideia"}</button>}
            {sourceTitle && <span>✓ {sourceTitle}</span>}
          </div>
        </div>
      )}

      <div className="quick-start-step"><strong>2. O que você quer receber?</strong><div className="quick-outcome-grid">{outcomeOptions.map((item) => <button type="button" className={outcome === item.id ? "selected" : ""} key={item.id} onClick={() => setOutcome(item.id)}><b>{item.title}</b><span>{item.copy}</span></button>)}</div></div>

      <div className="quick-start-step"><strong>3. Qual resultado importa mais?</strong><div className="quick-objectives">{objectiveOptions.map((item) => <button type="button" className={objective === item.id ? "selected" : ""} key={item.id} onClick={() => setObjective(item.id)}>{item.label}</button>)}</div></div>

      {error && <div className="portal-error">{error}</div>}
      <button type="button" className="button button-primary button-full" disabled={loading || !brandId} onClick={() => void prepare()}>{loading ? "A MODO está organizando..." : ["week", "campaign"].includes(outcome) ? "Criar plano com a MODO" : "Preparar meu conteúdo"}</button>
      <small className="quick-start-note">Links: artigos, blogs, notícias e páginas públicas. Para áudio ou vídeo, use o ditado ou cole uma transcrição nesta versão.</small>
    </section>
  );
}
