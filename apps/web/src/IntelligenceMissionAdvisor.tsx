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

interface IntentPreset {
  label: string;
  description: string;
  name: string;
  objective: string;
  keywords: string[];
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
      description: "Escolha o tipo de empresa que procura e defina uma única cidade ou região. A Modo transforma isso em uma busca comercial utilizável.",
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
      description: "Escolha primeiro o que quer descobrir. Depois informe a região e, quando tiver, nomes ou URLs reais de concorrentes para dar mais contexto.",
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
    description: "Escolha o tipo de comparação e cadastre URLs exatas de produtos equivalentes. Comece pelos itens mais importantes, não pelo catálogo inteiro.",
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

function intentPresets(playbook: IntelligencePlaybook, ideas: NicheIdeas, brandName: string): IntentPreset[] {
  if (playbook === "market_radar") {
    return [
      {
        label: "Novos concorrentes",
        description: "Descobrir quem disputa atenção na região.",
        name: `Concorrentes de ${ideas.label}`,
        objective: `Identificar negócios concorrentes ou semelhantes à ${brandName}, comparar presença, categoria e reputação e encontrar espaços de posicionamento na região escolhida.`,
        keywords: ideas.activities.slice(0, 2),
      },
      {
        label: "Reputação e avaliações",
        description: "Entender elogios, volume e sinais de confiança.",
        name: `Reputação do mercado · ${ideas.label}`,
        objective: `Mapear empresas de ${ideas.label.toLocaleLowerCase("pt-BR")} e comparar avaliações, volume de comentários e sinais públicos de confiança relevantes para a ${brandName}.`,
        keywords: [ideas.activities[0], "reputação no Google"],
      },
      {
        label: "Ofertas e serviços",
        description: "Ver como empresas semelhantes se apresentam.",
        name: `Ofertas do mercado · ${ideas.label}`,
        objective: `Observar ofertas, serviços, categorias e formas de apresentação usadas por empresas do segmento da ${brandName} na região definida.`,
        keywords: [...ideas.activities.slice(0, 2), ideas.radar[0]],
      },
      {
        label: "Dores e reclamações",
        description: "Encontrar problemas que podem virar oportunidade.",
        name: `Dores do público · ${ideas.label}`,
        objective: `Encontrar sinais públicos de insatisfação, baixa reputação e necessidades mal atendidas no mercado da ${brandName}, sem inventar conclusões além dos dados coletados.`,
        keywords: [ideas.activities[0], "avaliações negativas", ideas.interests[0]],
      },
      {
        label: "Tendências",
        description: "Observar temas e movimentos emergentes.",
        name: `Tendências de ${ideas.label}`,
        objective: `Mapear temas, serviços e movimentos que estão ganhando presença no segmento da ${brandName} e indicar sinais que merecem acompanhamento.`,
        keywords: ideas.radar.slice(0, 3),
      },
      {
        label: "Parceiros e fornecedores",
        description: "Explorar o ecossistema ao redor da atividade.",
        name: `Ecossistema de ${ideas.label}`,
        objective: `Identificar parceiros, fornecedores e atividades complementares que possam ampliar alcance, distribuição ou capacidade comercial da ${brandName}.`,
        keywords: ideas.partners.slice(0, 3),
      },
    ];
  }

  if (playbook === "b2b_prospecting") {
    return [
      {
        label: "Clientes locais",
        description: "Encontrar empresas próximas com perfil comprador.",
        name: `Clientes locais · ${ideas.label}`,
        objective: `Encontrar empresas locais compatíveis com a oferta da ${brandName}, com presença pública suficiente para uma validação comercial manual.`,
        keywords: ideas.audiences.slice(0, 2),
      },
      {
        label: "Setores compradores",
        description: "Pesquisar atividades específicas que podem comprar.",
        name: `Setores compradores · ${ideas.label}`,
        objective: `Mapear empresas de atividades selecionadas que possam se beneficiar da oferta da ${brandName} e organizar uma lista inicial para qualificação humana.`,
        keywords: ideas.activities.slice(0, 3),
      },
      {
        label: "Parceiros comerciais",
        description: "Encontrar quem pode indicar ou complementar a oferta.",
        name: `Parceiros comerciais · ${ideas.label}`,
        objective: `Encontrar organizações e profissionais complementares à ${brandName} para avaliar parcerias, indicações ou distribuição, sem contato automático.`,
        keywords: ideas.partners.slice(0, 3),
      },
      {
        label: "Sinais de demanda",
        description: "Procurar empresas associadas a uma necessidade concreta.",
        name: `Sinais de demanda · ${ideas.label}`,
        objective: `Encontrar empresas ligadas a necessidades como ${ideas.interests.slice(0, 2).join(" e ")}, para posterior validação comercial pela ${brandName}.`,
        keywords: [...ideas.audiences.slice(0, 1), ...ideas.interests.slice(0, 2)],
      },
    ];
  }

  return [
    {
      label: "Comparar preço",
      description: "Ver diferença entre produtos equivalentes.",
      name: "Comparação de preços prioritários",
      objective: `Comparar preços atuais de produtos prioritários da ${brandName} com páginas equivalentes informadas pelo cliente.`,
      keywords: ["preço atual", "produto campeão de vendas"],
    },
    {
      label: "Acompanhar promoções",
      description: "Observar descontos, combos e parcelamento.",
      name: "Monitoramento de promoções",
      objective: `Acompanhar promoções, descontos, combos e condições de pagamento dos produtos informados pela ${brandName}.`,
      keywords: ["preço promocional", "combo promocional", "parcelamento"],
    },
    {
      label: "Disponibilidade e frete",
      description: "Checar estoque, prazo e custo de entrega.",
      name: "Disponibilidade e frete",
      objective: `Comparar disponibilidade, frete e condições de entrega dos produtos prioritários informados pela ${brandName}.`,
      keywords: ["disponibilidade", "frete", "loja oficial"],
    },
  ];
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
  const presets = intentPresets(playbook, ideas, brandName || "marca");
  const keywordCount = lines(keywords).length;
  const regionCount = lines(regions).length;
  const validProductUrls = productUrls(products);

  const checks = playbook === "b2b_prospecting"
    ? [
        { ok: objective.trim().length >= 35, label: "Objetivo comercial definido" },
        { ok: keywordCount >= 1, label: "Público ou atividade selecionado" },
        { ok: regionCount === 1, label: "Uma única cidade ou região" },
        { ok: keywordCount <= 6, label: "Busca focada, sem termos demais" },
      ]
    : playbook === "market_radar"
      ? [
          { ok: objective.trim().length >= 35, label: "Pergunta de mercado definida" },
          { ok: keywordCount >= 1, label: "Tema ou atividade selecionado" },
          { ok: regionCount >= 1, label: "Área de pesquisa informada" },
          { ok: keywordCount <= 6, label: "Radar com escopo controlado" },
        ]
      : [
          { ok: objective.trim().length >= 35, label: "Objetivo de comparação definido" },
          { ok: lines(products).length >= 1, label: "Ao menos um produto cadastrado" },
          { ok: validProductUrls >= 1, label: "URL real de produto informada" },
          { ok: lines(products).length <= 20, label: "Lista inicial enxuta" },
        ];

  const completed = checks.filter((item) => item.ok).length;
  const score = Math.round((completed / checks.length) * 100);
  const qualityLabel = score === 100 ? "Pronta para pesquisar" : score >= 50 ? "Quase pronta" : "Vamos completar juntos";

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

  function applyPreset(preset: IntentPreset) {
    onApply({
      name: preset.name,
      objective: preset.objective,
      keywords: appendUnique("", preset.keywords),
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

      <div className="advisor-presets">
        <div><small>PRIMEIRO, ESCOLHA O QUE VOCÊ QUER DESCOBRIR</small><p>A Modo preenche o objetivo e os termos iniciais. Você só confirma a região e os dados reais.</p></div>
        <div className="advisor-preset-grid">
          {presets.map((preset) => (
            <button type="button" key={preset.label} onClick={() => applyPreset(preset)}>
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>
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
            <p className="advisor-tip"><b>Área primeiro:</b> informe uma cidade ou região. Concorrentes conhecidos são opcionais e ajudam apenas a contextualizar a análise.</p>
          )}
          {playbook === "price_monitoring" && (
            <p className="advisor-tip"><b>Produtos:</b> use o formato “Nome | SKU | URL”. O endereço deve apontar diretamente para a página do produto.</p>
          )}
        </div>

        <aside className={`advisor-quality quality-${score === 100 ? "ready" : score >= 50 ? "medium" : "low"}`}>
          <div><small>PREPARAÇÃO DA MISSÃO</small><strong>{score}%</strong><span>{qualityLabel}</span></div>
          <ul>
            {checks.map((item) => <li key={item.label} className={item.ok ? "done" : "pending"}><span>{item.ok ? "✓" : "·"}</span>{item.label}</li>)}
          </ul>
          <p>Complete os itens pendentes antes de confirmar. A franquia só é consumida quando a missão é criada.</p>
        </aside>
      </div>

      <style>{`.mission-advisor{border:1px solid #d7e2f1;background:linear-gradient(135deg,#f7faff,#eef4ff);border-radius:18px;padding:18px;margin:15px 0}.mission-advisor-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.mission-advisor-head small{font-size:8px;letter-spacing:.12em;color:#1f5eff;font-weight:900}.mission-advisor-head h3{font:800 20px Sora,sans-serif;margin:6px 0}.mission-advisor-head p{font-size:11px;line-height:1.5;color:#5f6d84;margin:0;max-width:650px}.mission-advisor-head>button{border:0;border-radius:10px;padding:10px 12px;background:#1f5eff;color:#fff;font-size:9px;font-weight:900;cursor:pointer;white-space:nowrap}.advisor-presets{margin-top:15px;background:#fff;border:1px solid #dbe5f4;border-radius:14px;padding:13px}.advisor-presets>div:first-child small{display:block;color:#1f5eff;font-size:8px;letter-spacing:.1em;font-weight:900}.advisor-presets>div:first-child p{margin:5px 0 10px;color:#66748b;font-size:9px}.advisor-preset-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.advisor-preset-grid button{display:grid;gap:4px;text-align:left;border:1px solid #dce5f2;border-radius:10px;padding:10px;background:#f8faff;color:#0d1b3e;cursor:pointer}.advisor-preset-grid button:hover{border-color:#1f5eff;background:#eef3ff}.advisor-preset-grid strong{font-size:9px}.advisor-preset-grid span{color:#69768c;font-size:8px;line-height:1.35}.mission-advisor-grid{display:grid;grid-template-columns:1fr 245px;gap:13px;margin-top:15px}.advisor-ideas{display:grid;gap:10px}.advisor-ideas article{display:grid;gap:6px}.advisor-ideas article>strong{font-size:9px;color:#34425d}.advisor-ideas article>div{display:flex;flex-wrap:wrap;gap:6px}.advisor-ideas article button{border:1px solid #d7e1f0;border-radius:999px;padding:6px 8px;background:#fff;color:#27416f;font-size:8px;font-weight:800;cursor:pointer}.advisor-ideas article button:hover{border-color:#1f5eff;color:#1f5eff}.advisor-tip{background:#fff;border-radius:10px;padding:10px;margin:0;color:#63718a;font-size:9px;line-height:1.45}.advisor-quality{background:#0d1b3e;color:#fff;border-radius:14px;padding:14px}.advisor-quality>div{display:grid;gap:3px}.advisor-quality small{font-size:7px;letter-spacing:.12em;color:#9fb4d9;font-weight:900}.advisor-quality strong{font:800 28px Sora,sans-serif}.advisor-quality>div>span{font-size:9px;color:#d8e3f5}.advisor-quality ul{list-style:none;padding:0;margin:12px 0;display:grid;gap:6px}.advisor-quality li{display:flex;gap:7px;align-items:center;font-size:8px;color:#aebbd1}.advisor-quality li span{display:grid;place-items:center;width:16px;height:16px;border-radius:50%;background:#233457;font-weight:900}.advisor-quality li.done{color:#fff}.advisor-quality li.done span{background:#1d9f72}.advisor-quality>p{font-size:8px;line-height:1.45;color:#9fb0ca;margin:0}.advisor-quality.quality-ready{box-shadow:inset 0 3px 0 #2ed19a}.advisor-quality.quality-medium{box-shadow:inset 0 3px 0 #f1b847}.advisor-quality.quality-low{box-shadow:inset 0 3px 0 #6f91d8}@media(max-width:850px){.mission-advisor-head{flex-direction:column}.mission-advisor-head>button{width:100%}.advisor-preset-grid{grid-template-columns:1fr}.mission-advisor-grid{grid-template-columns:1fr}}`}</style>
    </section>
  );
}
