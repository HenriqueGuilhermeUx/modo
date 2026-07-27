import type { IntelligencePlaybook } from "@modo/contracts/intelligence";

export type IntelligenceNiche =
  | "saude_estetica"
  | "servicos_profissionais"
  | "imoveis"
  | "varejo"
  | "educacao"
  | "creator"
  | "outro";

export interface MissionAdvisorDraft {
  name: string;
  objective: string;
  regions: string;
  keywords: string;
  competitors: string;
  products: string;
}

interface Props extends MissionAdvisorDraft {
  playbook: IntelligencePlaybook;
  niche: IntelligenceNiche;
  brandName: string;
  onApply: (patch: Partial<MissionAdvisorDraft>) => void;
}

interface NicheIdeas {
  label: string;
  audiences: string[];
  activities: string[];
  interests: string[];
  partners: string[];
  radar: string[];
}

const nicheIdeas: Record<IntelligenceNiche, NicheIdeas> = {
  saude_estetica: {
    label: "Saúde e estética",
    audiences: ["clínicas de estética", "consultórios odontológicos", "dermatologistas", "salões de beleza", "academias e studios"],
    activities: ["estética avançada", "harmonização facial", "depilação a laser", "bem-estar", "saúde preventiva"],
    interests: ["captação de pacientes", "agenda ociosa", "reputação no Google", "tratamentos premium", "fidelização"],
    partners: ["laboratórios", "farmácias de manipulação", "distribuidores de cosméticos", "influenciadores locais"],
    radar: ["novos tratamentos", "promoções de procedimentos", "avaliações negativas", "antes e depois", "tendências de autocuidado"],
  },
  servicos_profissionais: {
    label: "Serviços profissionais",
    audiences: ["escritórios de advocacia", "contabilidades", "consultorias", "agências", "empresas de tecnologia"],
    activities: ["serviços jurídicos", "BPO financeiro", "consultoria empresarial", "compliance", "transformação digital"],
    interests: ["geração de demanda", "redução de custos", "automação", "produtividade", "aquisição de clientes"],
    partners: ["associações empresariais", "coworkings", "software houses", "consultores independentes"],
    radar: ["novas ofertas de consultoria", "conteúdo de autoridade", "posicionamento premium", "nichos atendidos", "provas sociais"],
  },
  imoveis: {
    label: "Imóveis",
    audiences: ["imobiliárias", "corretores autônomos", "construtoras", "administradoras de condomínios", "investidores imobiliários"],
    activities: ["lançamentos imobiliários", "locação", "venda de imóveis", "condomínios", "investimento imobiliário"],
    interests: ["imóveis em lançamento", "alto padrão", "renda com aluguel", "financiamento", "valorização regional"],
    partners: ["arquitetos", "engenheiros", "correspondentes bancários", "empresas de mudança"],
    radar: ["novos lançamentos", "preço por metro quadrado", "bairros em valorização", "campanhas de imobiliárias", "condições de financiamento"],
  },
  varejo: {
    label: "Varejo e e-commerce",
    audiences: ["lojas de bairro", "e-commerces", "distribuidores", "franquias", "marketplaces regionais"],
    activities: ["moda", "beleza", "casa e decoração", "eletrônicos", "alimentos e bebidas"],
    interests: ["aumentar ticket médio", "giro de estoque", "promoções", "frete", "recorrência de compra"],
    partners: ["influenciadores", "fornecedores", "operadores logísticos", "shopping centers"],
    radar: ["produtos mais vendidos", "campanhas promocionais", "combos", "frete grátis", "avaliações de produto"],
  },
  educacao: {
    label: "Educação",
    audiences: ["escolas particulares", "cursos livres", "faculdades", "professores independentes", "empresas de treinamento"],
    activities: ["educação infantil", "idiomas", "cursos profissionalizantes", "treinamento corporativo", "ensino online"],
    interests: ["novas matrículas", "evasão", "empregabilidade", "certificação", "aprendizado prático"],
    partners: ["empresas locais", "associações de pais", "plataformas educacionais", "recrutadores"],
    radar: ["campanhas de matrícula", "novos cursos", "bolsas e descontos", "avaliações de alunos", "tendências de carreira"],
  },
  creator: {
    label: "Creator e marca pessoal",
    audiences: ["criadores de conteúdo", "especialistas", "infoprodutores", "palestrantes", "comunidades digitais"],
    activities: ["produção de conteúdo", "mentoria", "cursos online", "eventos", "comunidades pagas"],
    interests: ["crescimento de audiência", "monetização", "engajamento", "autoridade", "parcerias de marca"],
    partners: ["agências de influência", "marcas patrocinadoras", "produtoras", "gestores de tráfego"],
    radar: ["formatos virais", "lançamentos", "collabs", "assuntos emergentes", "ofertas de mentoria"],
  },
  outro: {
    label: "Seu segmento",
    audiences: ["empresas locais", "pequenas empresas", "profissionais autônomos", "redes e franquias", "compradores corporativos"],
    activities: ["serviços especializados", "comércio local", "indústria", "tecnologia", "atendimento ao consumidor"],
    interests: ["aquisição de clientes", "redução de custos", "crescimento", "reputação", "digitalização"],
    partners: ["associações comerciais", "fornecedores", "consultores", "influenciadores do setor"],
    radar: ["novos concorrentes", "ofertas", "reclamações", "tendências", "mudanças de comportamento"],
  },
};

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function appendUnique(current: string, values: string[]) {
  const seen = new Set(lines(current).map((item) => item.toLocaleLowerCase("pt-BR")));
  const next = [...lines(current)];
  for (const value of values) {
    const normalized = value.toLocaleLowerCase("pt-BR");
    if (!seen.has(normalized)) {
      next.push(value);
      seen.add(normalized);
    }
  }
  return next.join("\n");
}

function productUrls(value: string) {
  return lines(value).filter((line) => {
    const parts = line.split("|").map((item) => item.trim());
    return /^https?:\/\//i.test(parts[2] || "");
  }).length;
}

function guidance(playbook: IntelligencePlaybook, ideas: NicheIdeas, brandName: string) {
  if (playbook === "b2b_prospecting") {
    return {
      eyebrow: "QUEM PODE COMPRAR DE VOCÊ?",
      title: "Monte uma busca comercial com foco.",
      description: "Escolha públicos, atividades e sinais de oportunidade. Depois defina uma única cidade ou região para não desperdiçar a missão.",
      strategyName: `Prospecção recomendada · ${ideas.label}`,
      objective: `Encontrar empresas de ${ideas.label.toLocaleLowerCase("pt-BR")} com contato comercial público, presença digital e sinais de necessidade compatíveis com a oferta da ${brandName}.`,
      groups: [
        { label: "Públicos sugeridos", values: ideas.audiences, target: "keywords" as const },
        { label: "Atividades e setores", values: ideas.activities, target: "keywords" as const },
        { label: "Sinais de oportunidade", values: ideas.interests, target: "keywords" as const },
        { label: "Parceiros possíveis", values: ideas.partners, target: "keywords" as const },
      ],
      recommended: [...ideas.audiences.slice(0, 2), ...ideas.activities.slice(0, 1)],
    };
  }

  if (playbook === "market_radar") {
    return {
      eyebrow: "O QUE VALE A PENA OBSERVAR?",
      title: "Transforme curiosidade em sinais de mercado.",
      description: "Combine concorrência, atividade, dores e interesses do público. Inclua nomes ou URLs de concorrentes conhecidos para deixar o radar mais preciso.",
      strategyName: `Radar recomendado · ${ideas.label}`,
      objective: `Mapear concorrentes, ofertas, reputação, interesses do público e oportunidades de posicionamento para a ${brandName} no segmento de ${ideas.label.toLocaleLowerCase("pt-BR")}.`,
      groups: [
        { label: "Temas de mercado", values: ideas.radar, target: "keywords" as const },
        { label: "Interesses do público", values: ideas.interests, target: "keywords" as const },
        { label: "Atividades relacionadas", values: ideas.activities, target: "keywords" as const },
        { label: "Ecossistema e parceiros", values: ideas.partners, target: "keywords" as const },
      ],
      recommended: [...ideas.radar.slice(0, 2), ...ideas.interests.slice(0, 2)],
    };
  }

  return {
    eyebrow: "O QUE PRECISA SER COMPARADO?",
    title: "Monitore preços que mudam decisões.",
    description: "Cadastre URLs exatas de produtos equivalentes. Priorize itens campeões de venda, produtos de entrada e linhas premium — não o catálogo inteiro.",
    strategyName: `Preços recomendados · ${ideas.label}`,
    objective: `Comparar preço, disponibilidade, promoção e posicionamento dos produtos prioritários da ${brandName} com concorrentes diretos.`,
    groups: [
      { label: "Linhas prioritárias", values: ["produto campeão de vendas", "produto de entrada", "linha premium", "combo promocional", "produto com maior margem"], target: "keywords" as const },
      { label: "Sinais para comparar", values: ["preço atual", "preço promocional", "disponibilidade", "frete", "vendedor", "parcelamento"], target: "keywords" as const },
      { label: "Canais relevantes", values: ["site do concorrente", "marketplace", "loja oficial", "revendedor autorizado"], target: "competitors" as const },
    ],
    recommended: ["produto campeão de vendas", "preço atual", "disponibilidade"],
  };
}

export default function IntelligenceMissionAdvisor({
  playbook,
  niche,
  brandName,
  name,
  objective,
  regions,
  keywords,
  competitors,
  products,
  onApply,
}: Props) {
  const ideas = nicheIdeas[niche] || nicheIdeas.outro;
  const guide = guidance(playbook, ideas, brandName || "marca");
  const keywordCount = lines(keywords).length;
  const regionCount = lines(regions).length;
  const competitorCount = lines(competitors).length;
  const validProductUrls = productUrls(products);

  const checks = playbook === "b2b_prospecting"
    ? [
        { ok: objective.trim().length >= 35, label: "Objetivo comercial específico" },
        { ok: keywordCount >= 2, label: "Pelo menos dois públicos ou setores" },
        { ok: regionCount === 1, label: "Uma única cidade ou região" },
        { ok: keywordCount <= 8, label: "Busca focada, sem termos demais" },
      ]
    : playbook === "market_radar"
      ? [
          { ok: objective.trim().length >= 35, label: "Pergunta de mercado clara" },
          { ok: keywordCount >= 2, label: "Temas, dores ou interesses definidos" },
          { ok: competitorCount >= 1, label: "Ao menos um concorrente ou referência" },
          { ok: keywordCount <= 10, label: "Radar com escopo controlado" },
        ]
      : [
          { ok: objective.trim().length >= 35, label: "Objetivo de comparação claro" },
          { ok: lines(products).length >= 1, label: "Ao menos um produto cadastrado" },
          { ok: validProductUrls >= 1, label: "URL real de produto informada" },
          { ok: lines(products).length <= 20, label: "Lista inicial enxuta" },
        ];

  const completed = checks.filter((item) => item.ok).length;
  const score = Math.round((completed / checks.length) * 100);
  const qualityLabel = score === 100 ? "Pronta para pesquisar" : score >= 50 ? "Pode melhorar" : "Muito ampla";

  function add(target: "keywords" | "competitors", value: string) {
    onApply({ [target]: appendUnique(target === "keywords" ? keywords : competitors, [value]) });
  }

  function applyRecommended() {
    onApply({
      name: name.trim().length > 3 ? name : guide.strategyName,
      objective: guide.objective,
      keywords: appendUnique(keywords, guide.recommended),
    });
  }

  return (
    <section className="mission-advisor">
      <div className="mission-advisor-head">
        <div>
          <small>MODO RECOMENDA · {guide.eyebrow}</small>
          <h3>{guide.title}</h3>
          <p>{guide.description}</p>
        </div>
        <button type="button" onClick={applyRecommended}>Usar estratégia recomendada</button>
      </div>

      <div className="mission-advisor-grid">
        <div className="advisor-ideas">
          {guide.groups.map((group) => (
            <article key={group.label}>
              <strong>{group.label}</strong>
              <div>
                {group.values.map((value) => (
                  <button type="button" key={value} onClick={() => add(group.target, value)}>+ {value}</button>
                ))}
              </div>
            </article>
          ))}
          {playbook === "b2b_prospecting" && (
            <p className="advisor-tip"><b>Área:</b> use uma praça concreta, como “Campinas, SP”. Buscar várias cidades na mesma missão dilui o resultado e aumenta o custo.</p>
          )}
          {playbook === "market_radar" && (
            <p className="advisor-tip"><b>Concorrência:</b> informe nomes, perfis ou URLs reais. A Modo combina essas referências com atividades e interesses do seu nicho.</p>
          )}
          {playbook === "price_monitoring" && (
            <p className="advisor-tip"><b>Produtos:</b> use o formato “Nome | SKU | URL”. O endereço deve apontar diretamente para a página do produto.</p>
          )}
        </div>

        <aside className={`advisor-quality quality-${score === 100 ? "ready" : score >= 50 ? "medium" : "low"}`}>
          <div><small>QUALIDADE DA MISSÃO</small><strong>{score}%</strong><span>{qualityLabel}</span></div>
          <ul>
            {checks.map((item) => <li key={item.label} className={item.ok ? "done" : "pending"}><span>{item.ok ? "✓" : "·"}</span>{item.label}</li>)}
          </ul>
          <p>A franquia só é consumida ao criar a missão. Revise estes pontos antes de pesquisar.</p>
        </aside>
      </div>

      <style>{`.mission-advisor{border:1px solid #d7e2f1;background:linear-gradient(135deg,#f7faff,#eef4ff);border-radius:18px;padding:18px;margin:15px 0}.mission-advisor-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.mission-advisor-head small{font-size:8px;letter-spacing:.12em;color:#1f5eff;font-weight:900}.mission-advisor-head h3{font:800 20px Sora,sans-serif;margin:6px 0}.mission-advisor-head p{font-size:11px;line-height:1.5;color:#5f6d84;margin:0;max-width:650px}.mission-advisor-head>button{border:0;border-radius:10px;padding:10px 12px;background:#1f5eff;color:#fff;font-size:9px;font-weight:900;cursor:pointer;white-space:nowrap}.mission-advisor-grid{display:grid;grid-template-columns:1fr 245px;gap:13px;margin-top:15px}.advisor-ideas{display:grid;gap:10px}.advisor-ideas article{display:grid;gap:6px}.advisor-ideas article>strong{font-size:9px;color:#34425d}.advisor-ideas article>div{display:flex;flex-wrap:wrap;gap:6px}.advisor-ideas article button{border:1px solid #d7e1f0;border-radius:999px;padding:6px 8px;background:#fff;color:#27416f;font-size:8px;font-weight:800;cursor:pointer}.advisor-ideas article button:hover{border-color:#1f5eff;color:#1f5eff}.advisor-tip{background:#fff;border-radius:10px;padding:10px;margin:0;color:#63718a;font-size:9px;line-height:1.45}.advisor-quality{background:#0d1b3e;color:#fff;border-radius:14px;padding:14px}.advisor-quality>div{display:grid;gap:3px}.advisor-quality small{font-size:7px;letter-spacing:.12em;color:#9fb4d9;font-weight:900}.advisor-quality strong{font:800 28px Sora,sans-serif}.advisor-quality>div>span{font-size:9px;color:#d8e3f5}.advisor-quality ul{list-style:none;padding:0;margin:12px 0;display:grid;gap:6px}.advisor-quality li{display:flex;gap:7px;align-items:center;font-size:8px;color:#aebbd1}.advisor-quality li span{display:grid;place-items:center;width:16px;height:16px;border-radius:50%;background:#233457;font-weight:900}.advisor-quality li.done{color:#fff}.advisor-quality li.done span{background:#1d9f72}.advisor-quality>p{font-size:8px;line-height:1.45;color:#9fb0ca;margin:0}.advisor-quality.quality-ready{box-shadow:inset 0 3px 0 #2ed19a}.advisor-quality.quality-medium{box-shadow:inset 0 3px 0 #f1b847}.advisor-quality.quality-low{box-shadow:inset 0 3px 0 #ed6a6a}@media(max-width:850px){.mission-advisor-head{flex-direction:column}.mission-advisor-head>button{width:100%}.mission-advisor-grid{grid-template-columns:1fr}}`}</style>
    </section>
  );
}
