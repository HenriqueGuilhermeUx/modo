import type { ContentUnitType } from "@modo/contracts";
import type { ContentObjective } from "@modo/contracts/content";
import { useEffect, useMemo, useState } from "react";

interface CreativeDirectorProps {
  brandName: string;
  contentType: ContentUnitType;
  objective: ContentObjective;
  value: string;
  onChange: (value: string) => void;
  onObjectiveChange: (objective: ContentObjective) => void;
}

type Preset = {
  id: string;
  icon: string;
  title: string;
  description: string;
  objective: ContentObjective;
  direction: string;
};

const presets: Preset[] = [
  {
    id: "authority",
    icon: "✦",
    title: "Construir autoridade",
    description: "Ensinar algo importante e posicionar a marca como referência.",
    objective: "autoridade",
    direction: "Crie um conteúdo que demonstre conhecimento prático, revele um ponto pouco compreendido pelo público e posicione a marca como uma referência confiável.",
  },
  {
    id: "demand",
    icon: "↗",
    title: "Atrair clientes",
    description: "Gerar interesse e aproximar pessoas com potencial de compra.",
    objective: "demanda",
    direction: "Crie um conteúdo que faça o público reconhecer uma necessidade, enxergar o custo de não agir e considerar a solução oferecida pela marca.",
  },
  {
    id: "offer",
    icon: "◎",
    title: "Apresentar uma oferta",
    description: "Explicar um produto, serviço, condição ou novidade.",
    objective: "conversao",
    direction: "Apresente a oferta com clareza, conecte problema, benefício e diferencial, reduza esforço de entendimento e conduza para uma próxima ação concreta.",
  },
  {
    id: "objection",
    icon: "◇",
    title: "Quebrar uma objeção",
    description: "Responder uma dúvida que impede o cliente de avançar.",
    objective: "conversao",
    direction: "Trabalhe uma objeção real do público sem tom defensivo. Mostre contexto, evidência e uma forma segura de avançar na decisão.",
  },
  {
    id: "education",
    icon: "◫",
    title: "Educar o público",
    description: "Simplificar um tema e entregar valor prático.",
    objective: "educacao",
    direction: "Explique um tema relevante de forma simples, útil e aplicável. Organize a mensagem em passos, critérios ou erros comuns que o público possa reconhecer.",
  },
  {
    id: "proof",
    icon: "✓",
    title: "Mostrar resultado",
    description: "Transformar caso, prova ou conquista em confiança.",
    objective: "conversao",
    direction: "Mostre um resultado, transformação ou evidência concreta. Contextualize o ponto de partida, as decisões tomadas e o valor percebido, sem promessas exageradas.",
  },
  {
    id: "human",
    icon: "♡",
    title: "Humanizar a marca",
    description: "Mostrar bastidores, pessoas, cultura ou processo.",
    objective: "relacionamento",
    direction: "Aproxime a marca do público mostrando pessoas, escolhas, bastidores ou valores reais. Priorize familiaridade, verdade e conexão.",
  },
  {
    id: "free",
    icon: "+",
    title: "Direção personalizada",
    description: "Escrever uma orientação própria quando necessário.",
    objective: "autoridade",
    direction: "",
  },
];

const formatLabels: Record<ContentUnitType, string> = {
  static_post: "post estático",
  story: "sequência de stories",
  carousel: "carrossel",
  short_video_script: "roteiro de vídeo curto",
  channel_adaptation: "adaptação para outro canal",
};

const tones = ["Direto", "Profissional", "Didático", "Humano", "Inspirador"] as const;
const actions = [
  "Conhecer melhor a solução",
  "Falar com a marca",
  "Pedir orçamento",
  "Salvar ou compartilhar",
  "Comentar ou responder",
] as const;

export default function CreativeDirector({
  brandName,
  contentType,
  objective,
  value,
  onChange,
  onObjectiveChange,
}: CreativeDirectorProps) {
  const [presetId, setPresetId] = useState("authority");
  const [tone, setTone] = useState<(typeof tones)[number]>("Profissional");
  const [desiredAction, setDesiredAction] = useState<(typeof actions)[number]>("Conhecer melhor a solução");
  const [details, setDetails] = useState("");

  const preset = useMemo(
    () => presets.find((item) => item.id === presetId) ?? presets[0],
    [presetId],
  );

  useEffect(() => {
    if (preset.id === "free") return;
    const finalBrief = [
      `DIREÇÃO DO DIRETOR DE CRIAÇÃO: ${preset.direction}`,
      `MARCA: ${brandName || "marca selecionada"}.`,
      `FORMATO: ${formatLabels[contentType]}.`,
      `TOM: ${tone.toLowerCase()}.`,
      `AÇÃO DESEJADA: ${desiredAction}.`,
      details.trim() ? `INFORMAÇÕES IMPORTANTES: ${details.trim()}` : "Use o contexto já conhecido da marca para escolher o melhor ângulo.",
      "Entregue uma ideia específica, sem clichês, com gancho forte, mensagem central clara e chamada para ação coerente.",
    ].join("\n");
    onChange(finalBrief);
  }, [brandName, contentType, desiredAction, details, onChange, preset, tone]);

  function selectPreset(next: Preset) {
    setPresetId(next.id);
    if (next.id !== "free") onObjectiveChange(next.objective);
    if (next.id === "free") onChange("");
  }

  return (
    <section className="creative-director">
      <div className="creative-director-head">
        <div className="creative-director-avatar">CD</div>
        <div>
          <small>DIRETOR DE CRIAÇÃO MODO</small>
          <strong>O que este conteúdo precisa fazer?</strong>
          <p>Escolha uma intenção. A MODO transforma a decisão em briefing profissional.</p>
        </div>
      </div>

      <div className="creative-preset-grid">
        {presets.map((item) => (
          <button
            className={presetId === item.id ? "creative-preset active" : "creative-preset"}
            key={item.id}
            type="button"
            onClick={() => selectPreset(item)}
          >
            <span>{item.icon}</span>
            <div><strong>{item.title}</strong><small>{item.description}</small></div>
          </button>
        ))}
      </div>

      {preset.id === "free" ? (
        <label className="creative-free-field">
          Sua direção personalizada
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Ex.: anuncie a abertura da nova unidade, destaque o atendimento personalizado e convide para agendar uma visita."
            minLength={10}
            maxLength={2000}
            required
          />
        </label>
      ) : (
        <>
          <div className="creative-options">
            <label>Tom da mensagem<select value={tone} onChange={(event) => setTone(event.target.value as (typeof tones)[number])}>{tones.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Próxima ação<select value={desiredAction} onChange={(event) => setDesiredAction(event.target.value as (typeof actions)[number])}>{actions.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <label className="creative-details-field">
            O que o Diretor precisa saber? <span>(opcional)</span>
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Ex.: produto principal, promoção, diferencial, dúvida frequente, resultado obtido ou informação que não pode faltar."
              maxLength={900}
            />
          </label>
          <div className="creative-director-note">
            <span>✓</span>
            <p><strong>Briefing pronto.</strong> Objetivo definido como {objective}. A MODO escolherá o ângulo, o gancho, a estrutura e a chamada para ação.</p>
          </div>
        </>
      )}
    </section>
  );
}
