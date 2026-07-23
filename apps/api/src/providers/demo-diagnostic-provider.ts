import { nicheLabels, type DiagnosticCreateRequest, type DiagnosticResult } from "@modo/contracts";
import { extractPublicSite } from "../services/source-extractor.js";
import type { DiagnosticProvider } from "./diagnostic-provider.js";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type Vertical =
  | "legal_ai"
  | "crypto_fintech"
  | "union_tech"
  | "content_ai"
  | "health"
  | "real_estate"
  | "retail"
  | "education"
  | "creator"
  | "professional_services"
  | "general";

type PageSignals = {
  vertical: Vertical;
  verticalLabel: string;
  clauses: string[];
  normalized: string;
  channels: string[];
  evidence: string;
  offer: string;
  proof: string;
  hasProof: boolean;
  hasDemo: boolean;
  hasPricing: boolean;
  hasTrial: boolean;
  hasProcess: boolean;
  hasSpecificCta: boolean;
  sourceRead: boolean;
};

const verticalLabels: Record<Vertical, string> = {
  legal_ai: "Inteligência artificial para trabalho jurídico",
  crypto_fintech: "Fintech de dólar digital, Pix e ativos digitais",
  union_tech: "Tecnologia e inteligência artificial para gestão sindical",
  content_ai: "Inteligência criativa e produção de conteúdo",
  health: "Saúde, cuidado e bem-estar",
  real_estate: "Imóveis e decisão imobiliária",
  retail: "Varejo, produtos e comércio digital",
  education: "Educação e desenvolvimento profissional",
  creator: "Marca pessoal e conhecimento profissional",
  professional_services: "Serviços profissionais especializados",
  general: "Solução digital especializada",
};

const verticalKeywords: Record<Vertical, string[]> = {
  legal_ai: ["advogado", "advocacia", "jurídic", "processo", "petição", "contrato", "jurisprud", "precedente", "cnj", "tribunal", "juiz", "legal brain", "war room"],
  crypto_fintech: ["usdc", "pix", "dólar digital", "dolar digital", "cripto", "blockchain", "carteira", "iof", "spread", "kyc", "aml", "rendimento em dólar", "rendimento em dolar"],
  union_tech: ["sindicato", "sindical", "associado", "filiado", "assembleia", "convenção coletiva", "convencao coletiva", "dissídio", "dissidio", "categoria", "diretoria sindical", "ata"],
  content_ai: ["conteúdo", "conteudo", "carrossel", "post", "linkedin", "instagram", "diretor de criação", "diretor de criacao", "presença digital", "presenca digital", "campanha"],
  health: ["saúde", "saude", "clínica", "clinica", "paciente", "tratamento", "terapia", "estética", "estetica", "médico", "medico"],
  real_estate: ["imóvel", "imovel", "imobiliária", "imobiliaria", "corretor", "apartamento", "casa", "locação", "locacao", "condomínio", "condominio"],
  retail: ["loja", "produto", "comprar", "e-commerce", "ecommerce", "catálogo", "catalogo", "frete", "carrinho", "pedido"],
  education: ["curso", "aluno", "aula", "formação", "formacao", "aprenda", "certificado", "educação", "educacao", "treinamento"],
  creator: ["criador", "creator", "marca pessoal", "mentoria", "especialista", "palestrante", "consultor", "conteúdo autoral", "conteudo autoral"],
  professional_services: ["consultoria", "serviço", "servico", "solução", "solucao", "especialista", "empresa", "profissional"],
  general: [],
};

function brandNameFromUrl(rawUrl: string): string {
  const hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
  const firstPart = hostname.split(".")[0] ?? "Sua marca";
  return firstPart
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function cleanBrandName(title: string, fallback: string) {
  const candidate = title.split(/\s+[|–—-]\s+/)[0]?.trim() || "";
  if (candidate.length < 2 || candidate.length > 60) return fallback;
  return candidate;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function clauses(text: string) {
  return text
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.replace(/\s+/g, " ").replace(/^[-–—•\s]+/, "").trim())
    .filter((item) => item.length >= 18 && item.length <= 260)
    .filter((item) => !/^(início|inicio|menu|produto|empresa|legal|contato|saiba mais)$/i.test(item));
}

function short(value: string, limit = 180) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= limit) return cleaned;
  const sliced = cleaned.slice(0, limit);
  return `${sliced.slice(0, Math.max(sliced.lastIndexOf(" "), limit - 24)).trim()}…`;
}

function containsAny(text: string, tokens: string[]) {
  return tokens.some((token) => text.includes(token));
}

function scoreClause(clause: string, keywords: string[], extra: string[] = []) {
  const normalized = normalize(clause);
  let score = 0;
  for (const keyword of keywords) if (normalized.includes(keyword)) score += 4;
  for (const keyword of extra) if (normalized.includes(keyword)) score += 2;
  if (/\b(ajuda|transforma|analisa|organiza|cria|permite|oferece|converte|protege|automatiza|envie|receba|comece)\b/i.test(clause)) score += 2;
  if (/\b(para|sem|em poucos|minutos|segundos|resultado|risco|estratégia|estrategia|cliente|usuário|usuario)\b/i.test(clause)) score += 1;
  if (clause.length >= 45 && clause.length <= 190) score += 2;
  return score;
}

function bestClause(items: string[], keywords: string[], extra: string[] = []) {
  return [...items]
    .map((clause) => ({ clause, score: scoreClause(clause, keywords, extra) }))
    .sort((a, b) => b.score - a.score || a.clause.length - b.clause.length)[0]?.clause ?? "";
}

function detectedChannels(text: string) {
  const normalized = normalize(text);
  const channels = [
    ["LinkedIn", "linkedin"],
    ["Instagram", "instagram"],
    ["Facebook", "facebook"],
    ["WhatsApp", "whatsapp"],
    ["TikTok", "tiktok"],
    ["YouTube", "youtube"],
  ] as const;
  return channels.filter(([, token]) => normalized.includes(token)).map(([label]) => label);
}

function verticalScore(text: string, hostname: string, vertical: Vertical) {
  let score = verticalKeywords[vertical].reduce((total, keyword) => total + (text.includes(keyword) ? 2 : 0), 0);
  if (vertical === "legal_ai" && /(jud|legal|adv)/i.test(hostname)) score += 7;
  if (vertical === "union_tech" && /(sind|union)/i.test(hostname)) score += 7;
  if (vertical === "crypto_fintech" && /(crypto|cripto|coin|wallet|dollar|dolar)/i.test(hostname)) score += 5;
  return score;
}

function fallbackVertical(niche: DiagnosticCreateRequest["niche"]): Vertical {
  const map: Record<DiagnosticCreateRequest["niche"], Vertical> = {
    saude_estetica: "health",
    servicos_profissionais: "professional_services",
    imoveis: "real_estate",
    varejo: "retail",
    educacao: "education",
    creator: "creator",
    outro: "general",
  };
  return map[niche];
}

function detectVertical(input: DiagnosticCreateRequest, text: string) {
  const hostname = new URL(input.websiteUrl).hostname;
  const candidates = (Object.keys(verticalKeywords) as Vertical[])
    .filter((vertical) => vertical !== "general")
    .map((vertical) => ({ vertical, score: verticalScore(text, hostname, vertical) }))
    .sort((a, b) => b.score - a.score);
  if ((candidates[0]?.score ?? 0) >= 4) return candidates[0].vertical;
  return fallbackVertical(input.niche);
}

function audienceFor(vertical: Vertical) {
  const audiences: Record<Vertical, string> = {
    legal_ai: "Advogados e escritórios que precisam analisar documentos, organizar riscos e produzir estratégia com rastreabilidade",
    crypto_fintech: "Pessoas que querem dolarizar parte do dinheiro e continuar usando Pix sem enfrentar a complexidade cripto",
    union_tech: "Dirigentes, equipes e associados que precisam consultar documentos, comunicar decisões e organizar a rotina sindical",
    content_ai: "Profissionais e pequenos negócios que precisam aparecer, vender e manter uma rotina de conteúdo sem equipe própria",
    health: "Pessoas que precisam confiar no cuidado, entender o processo e tomar uma decisão segura",
    real_estate: "Compradores, proprietários e interessados que precisam comparar opções e avançar com segurança",
    retail: "Consumidores que precisam perceber valor, confiança e um motivo claro para comprar agora",
    education: "Pessoas que buscam uma transformação prática por meio de formação ou acompanhamento",
    creator: "Pessoas interessadas no conhecimento, experiência e oferta profissional do criador",
    professional_services: "Pessoas e empresas com um problema específico que precisam confiar antes de contratar",
    general: "Pessoas que precisam entender rapidamente o que muda ao escolher esta solução",
  };
  return audiences[vertical];
}

function buildSignals(input: DiagnosticCreateRequest, pageText: string, sourceRead: boolean): PageSignals {
  const normalized = normalize(pageText);
  const vertical = detectVertical(input, normalized);
  const items = clauses(pageText);
  const verticalTokens = verticalKeywords[vertical];
  const offer = bestClause(items, verticalTokens, ["ajuda", "transforma", "analisa", "organiza", "cria", "plataforma", "solução", "serviço"]);
  const evidence = bestClause(items, verticalTokens, ["envie", "receba", "comece", "pix", "documento", "associado", "cliente", "resultado"]);
  const proof = bestClause(items, ["depoimento", "case", "resultado", "clientes", "economiz", "volume", "transações", "taxa de sucesso", "anos", "%"]);
  return {
    vertical,
    verticalLabel: verticalLabels[vertical],
    clauses: items,
    normalized,
    channels: detectedChannels(pageText),
    evidence: short(evidence || offer || pageText, 180),
    offer: short(offer || evidence || `Solução de ${verticalLabels[vertical].toLowerCase()}`, 180),
    proof: short(proof, 160),
    hasProof: /(depoimento|case|resultado|clientes|mais de\s+\d|\d+[.,]?\d*%|economiz|volume transacionado|transações processadas|taxa de sucesso)/i.test(pageText),
    hasDemo: /(demonstração|demo|exemplo|antes e depois|veja como|resultado pronto|conhecer o app|como funciona|envie documento|deposite r\$|passo 1)/i.test(pageText),
    hasPricing: /(r\$\s?\d|preço|preco|mensal|plano|assinatura|taxa)/i.test(pageText),
    hasTrial: /(trial|teste grátis|teste gratis|sem cartão|sem cartao|experimente)/i.test(pageText),
    hasProcess: /(como funciona|passo|1\s|2\s|3\s|envie|receba|deposite|escaneie|analisa|organiza)/i.test(pageText),
    hasSpecificCta: /(começar trial|comecar trial|experimentar em|agendar demonstração|agendar demonstracao|enviar documento|criar conta|começar agora|comecar agora)/i.test(pageText),
    sourceRead,
  };
}

function evidenceStrength(signals: PageSignals) {
  if (!signals.sourceRead) {
    return "Não foi possível ler conteúdo público suficiente para sustentar uma análise confiável desta página.";
  }
  const channelNote = signals.channels.length ? ` A página também cita ${signals.channels.join(", ")}.` : "";
  return `Encontramos esta mensagem no site: “${signals.evidence}”.${channelNote}`;
}

function diagnosticFor(name: string, signals: PageSignals) {
  const strength = evidenceStrength(signals);
  if (!signals.sourceRead) {
    return {
      strength,
      opportunity: `${name} ainda não pôde ser analisada com segurança pela MODO.`,
      impact: "Quando o conteúdo principal não fica disponível no HTML público, mecanismos de busca, ferramentas de acessibilidade e análises automáticas também podem compreender menos da proposta.",
      recommendation: "Disponibilizar título, proposta de valor, oferta e uma demonstração principal no HTML inicial da página; depois executar uma nova análise.",
    };
  }

  switch (signals.vertical) {
    case "legal_ai":
      return {
        strength,
        opportunity: `${name} promete sair do documento para a estratégia, mas ainda não mostra uma resposta jurídica auditável antes do cadastro.`,
        impact: "Em IA jurídica, velocidade chama atenção, mas confiança decide. Citar jurisprudência, precedentes e capacidades é diferente de mostrar como fatos, fontes, riscos e limites aparecem em uma resposta real revisada por advogado.",
        recommendation: "Abrir um caso anonimizado completo: documento enviado, fatos extraídos, fontes consultadas, riscos identificados, estratégia sugerida, peça gerada e pontos que exigem validação humana.",
      };
    case "crypto_fintech": {
      const claims = [
        signals.normalized.includes("rendimento") ? "rendimento" : "",
        signals.normalized.includes("iof") ? "IOF" : "",
        signals.normalized.includes("pix") ? "uso via Pix" : "",
        signals.normalized.includes("usdc") ? "USDC" : "",
      ].filter(Boolean).join(", ");
      return {
        strength,
        opportunity: `${name} reúne promessas financeiras fortes${claims ? ` — ${claims}` : ""} — antes de tornar totalmente visível o caminho do dinheiro e do risco.`,
        impact: "Em produtos financeiros, uma promessa atraente aumenta atenção e desconfiança ao mesmo tempo. O visitante precisa visualizar conversão, custódia, spread, liquidez, rendimento, risco e retorno ao Pix antes de decidir experimentar.",
        recommendation: "Criar uma simulação real de R$ 10: valor enviado por Pix, valor convertido, custos, onde o saldo fica, como varia, como é resgatado e quais riscos continuam existindo.",
      };
    }
    case "union_tech":
      return {
        strength,
        opportunity: `${name} apresenta tecnologia para sindicatos, mas ainda precisa transformar a IA em uma rotina sindical reconhecível no primeiro contato.`,
        impact: "Dirigentes e equipes não compram inteligência artificial abstrata. Eles compram menos tempo procurando convenções, atas e históricos, respostas mais rápidas ao associado e mais segurança para comunicar decisões da categoria.",
        recommendation: "Demonstrar um fluxo real: enviar uma convenção ou ata, fazer uma pergunta de associado, localizar a base documental, gerar uma resposta e transformar a decisão em comunicado para a categoria.",
      };
    case "content_ai":
      return {
        strength,
        opportunity: `${name} oferece muitas capacidades criativas, mas o visitante ainda precisa enxergar uma transformação completa antes de conhecer todos os módulos.`,
        impact: "Quem não sabe criar conteúdo não quer montar mentalmente um fluxo de ferramentas. Quer reconhecer a própria situação, ver o que entrega, o que recebe e o que fará amanhã.",
        recommendation: "Mostrar uma matéria-prima real virando plano, post, carrossel, roteiro, tarefa semanal e sinal de resultado — tudo na primeira rolagem.",
      };
    case "health":
      return {
        strength,
        opportunity: `${name} pode reduzir melhor a ansiedade que existe antes da primeira decisão de cuidado.`,
        impact: "Em saúde e estética, a pessoa não avalia apenas benefícios. Ela procura indicação, segurança, etapas, profissional responsável, limites e o que acontecerá antes, durante e depois do atendimento.",
        recommendation: "Apresentar uma jornada real e responsável: situação inicial, avaliação, indicação, etapas, cuidados, limites, acompanhamento e resultado esperado sem promessas absolutas.",
      };
    case "real_estate":
      return {
        strength,
        opportunity: `${name} pode sair da apresentação geral e ajudar o visitante a tomar uma primeira decisão imobiliária concreta.`,
        impact: "Listar opções informa, mas não reduz sozinho a insegurança sobre preço, localização, documentação, financiamento e adequação à realidade de quem procura.",
        recommendation: "Abrir uma comparação guiada entre três cenários reais, explicando para quem cada imóvel serve, custo total, pontos de atenção e próximo passo.",
      };
    case "retail":
      return {
        strength,
        opportunity: `${name} apresenta o que vende, mas pode tornar o motivo de compra mais evidente em uma situação real de uso.`,
        impact: "Benefícios genéricos competem com preço e comparação. Demonstração, prova, detalhe e contexto de uso ajudam o consumidor a imaginar o produto na própria rotina.",
        recommendation: "Transformar um produto principal em uma demonstração completa: problema, uso, detalhe, comparação, prova de cliente e chamada direta para comprar ou conversar.",
      };
    case "education":
      return {
        strength,
        opportunity: `${name} pode tornar a transformação educacional mais concreta antes de apresentar toda a estrutura do curso.`,
        impact: "O aluno quer entender de onde parte, o que conseguirá fazer, quanto esforço será necessário e como será acompanhado — não apenas conhecer módulos e carga horária.",
        recommendation: "Mostrar uma trilha de um aluno real: dificuldade inicial, primeira atividade, evolução observável, projeto produzido e próximo nível alcançado.",
      };
    case "creator":
      return {
        strength,
        opportunity: `${name} já comunica conhecimento, mas pode criar uma ponte mais direta entre autoridade e contratação.`,
        impact: "A audiência pode admirar conteúdo e ainda não entender qual problema é resolvido, para quem a oferta serve e como começar uma conversa comercial sem pressão.",
        recommendation: "Publicar um caso ou diagnóstico comentado que conecte experiência, método, transformação e uma chamada específica para o serviço principal.",
      };
    case "professional_services":
      return {
        strength,
        opportunity: `${name} explica sua oferta, mas ainda não mostra com clareza a situação concreta que leva alguém a contratar.`,
        impact: "Serviços especializados são difíceis de avaliar antes da compra. Sem um caso, diagnóstico ou amostra do método, o visitante compara promessas e preço em vez de perceber diferença.",
        recommendation: `Usar a mensagem “${short(signals.offer, 110)}” como ponto de partida para um caso real: contexto, decisão, método, entrega e resultado observável.`,
      };
    default:
      return {
        strength,
        opportunity: `${name} ainda exige que o visitante interprete sozinho o que muda depois da contratação.`,
        impact: "Quando oferta, público e resultado não se conectam em uma situação reconhecível, a pessoa pode até entender o tema, mas não percebe urgência nem um próximo passo seguro.",
        recommendation: `Transformar “${short(signals.offer, 110)}” em uma demonstração de antes e depois, com entrada, processo, entrega e chamada específica.`,
      };
  }
}

function campaignsFor(name: string, signals: PageSignals): DiagnosticResult["campaigns"] {
  const commonHuman = {
    id: "human-01",
    objective: "conexao" as const,
    eyebrow: "Conexão humana",
    hashtags: ["#bastidores", "#historiademarca", "#autoridade"],
  };

  switch (signals.vertical) {
    case "legal_ai":
      return [
        {
          id: "legal-proof-01",
          objective: "autoridade",
          eyebrow: "Caso jurídico auditável",
          title: "Do documento à estratégia: veja o que a IA encontrou e o advogado validou",
          visualDirection: "Documento ou carrossel com trechos anonimizados: fato, fonte, risco, hipótese, decisão humana e resultado final.",
          caption: `${name} pode demonstrar valor sem prometer substituir o advogado. Um caso anonimizado mostra como documentos viram contexto, como fontes sustentam a análise e onde a validação profissional continua indispensável.`,
          hashtags: ["#iajuridica", "#advocacia", "#estrategiajuridica"],
          cta: "Envie um documento e veja como a análise é estruturada.",
        },
        {
          id: "legal-demand-01",
          objective: "leads",
          eyebrow: "Geração de demanda",
          title: "3 momentos em que um escritório perde horas antes mesmo de começar a estratégia",
          visualDirection: "Carrossel com documento disperso, fatos sem cronologia, pesquisa fragmentada e a reorganização do fluxo.",
          caption: "O problema nem sempre é falta de conhecimento jurídico. Muitas vezes é o tempo perdido para encontrar fatos, conectar documentos, verificar fontes e organizar riscos antes da decisão.",
          hashtags: ["#produtividadejuridica", "#legaltech", "#advogados"],
          cta: "Qual etapa mais consome tempo hoje no seu escritório?",
        },
        {
          ...commonHuman,
          title: `O que a ${name} nunca deve decidir no lugar do advogado`,
          visualDirection: "Vídeo curto de fundador ou especialista explicando limites, responsabilidade e o papel da revisão humana.",
          caption: "Confiança em tecnologia jurídica nasce quando a empresa explica não apenas o que a IA faz, mas também o que ela não deve fazer sozinha.",
          cta: "Que limite você considera indispensável em uma IA jurídica?",
        },
      ];
    case "crypto_fintech":
      return [
        {
          id: "crypto-proof-01",
          objective: "autoridade",
          eyebrow: "Dinheiro em movimento",
          title: "O caminho real de R$ 10: do Pix ao dólar digital e de volta ao Pix",
          visualDirection: "Sequência visual com valores reais em cada etapa: depósito, conversão, spread, saldo, rendimento, pagamento e resgate.",
          caption: `${name} pode transformar uma promessa financeira em uma experiência verificável. Mostrar cada etapa, custo e risco ajuda o visitante a entender o produto antes de confiar dinheiro a ele.`,
          hashtags: ["#dolardigital", "#pix", "#usdc"],
          cta: "Simule agora quanto chega ao seu saldo com R$ 10.",
        },
        {
          id: "crypto-demand-01",
          objective: "leads",
          eyebrow: "Comparação líquida",
          title: "Cartão, conta global ou dólar digital: quanto realmente sobra depois dos custos?",
          visualDirection: "Tabela simples com IOF, spread, prazo, liquidez, rendimento e riscos, sempre com fonte e data.",
          caption: "Comparações financeiras só geram confiança quando mostram custos líquidos, condições e riscos — não apenas o número mais atraente de cada alternativa.",
          hashtags: ["#educacaofinanceira", "#cambio", "#fintech"],
          cta: "Compare o cenário que mais se parece com o seu uso.",
        },
        {
          ...commonHuman,
          title: `Por que a ${name} escolheu começar pelo Pix — e não pela linguagem cripto`,
          visualDirection: "Vídeo de fundador com um Pix real como objeto de cena, explicando a decisão de simplificar a entrada.",
          caption: "Uma fintech fica mais próxima quando explica a decisão humana por trás do produto: qual complexidade queria remover e que comportamento cotidiano escolheu preservar.",
          cta: "Qual parte do dólar digital ainda parece complicada para você?",
        },
      ];
    case "union_tech":
      return [
        {
          id: "union-proof-01",
          objective: "autoridade",
          eyebrow: "Rotina sindical real",
          title: "Da convenção à resposta do associado: um fluxo completo em poucos minutos",
          visualDirection: "Documento com cinco quadros: arquivo enviado, pergunta, trecho localizado, resposta revisada e comunicado final.",
          caption: `${name} pode mostrar a tecnologia dentro de uma situação que qualquer dirigente reconhece: localizar a regra certa, responder com segurança e comunicar a categoria sem começar do zero.`,
          hashtags: ["#gestaosindical", "#sindicato", "#inteligenciaartificial"],
          cta: "Qual documento mais demora para ser encontrado hoje?",
        },
        {
          id: "union-demand-01",
          objective: "leads",
          eyebrow: "Gargalos invisíveis",
          title: "3 tarefas que consomem a diretoria sindical sem fortalecer a representação",
          visualDirection: "Carrossel com busca em pastas, respostas repetidas, atas dispersas e o tempo recuperado com organização.",
          caption: "A tecnologia faz sentido quando devolve tempo para negociação, escuta e representação — não quando apenas adiciona mais uma tela à rotina.",
          hashtags: ["#liderancasindical", "#associados", "#transformacaodigital"],
          cta: "Qual tarefa administrativa mais afasta sua equipe dos associados?",
        },
        {
          ...commonHuman,
          title: `Um dia na diretoria: o problema que levou à criação da ${name}`,
          visualDirection: "Vídeo com dirigente ou fundador contando uma situação real, o conflito, a decisão e o que mudou.",
          caption: "A transformação sindical se torna concreta quando a história começa em uma dor real da diretoria e termina em mais capacidade de servir a categoria.",
          cta: "Que situação da rotina sindical deveria ser resolvida primeiro?",
        },
      ];
    case "content_ai":
      return [
        {
          id: "content-proof-01",
          objective: "autoridade",
          eyebrow: "Transformação completa",
          title: "De uma ideia falada a uma semana inteira de presença",
          visualDirection: "Antes e depois com áudio bruto, direção escolhida, post, carrossel, roteiro, agenda e sinal de resultado.",
          caption: `${name} demonstra seu valor quando mostra o caminho completo — não apenas a peça final. A matéria-prima do cliente vira decisão, criação, tarefa e aprendizado.`,
          hashtags: ["#conteudocomia", "#presencadigital", "#marketing"],
          cta: "Conte o que você vende e receba seu primeiro próximo passo.",
        },
        {
          id: "content-demand-01",
          objective: "leads",
          eyebrow: "Sem tela em branco",
          title: "Você não precisa de mais ideias. Precisa saber qual publicar primeiro.",
          visualDirection: "Carrossel que contrasta excesso de ideias com uma semana guiada de três ações.",
          caption: "O bloqueio não é apenas criatividade. É decidir o que importa, transformar em conteúdo e encaixar a produção na realidade da empresa.",
          hashtags: ["#criacaodeconteudo", "#pequenosnegocios", "#vendasonline"],
          cta: "A MODO decide o primeiro movimento com você.",
        },
        {
          ...commonHuman,
          title: `O conteúdo que a ${name} não pode criar sem você`,
          visualDirection: "Vídeo com fundador mostrando por que histórias, rosto, bastidores e experiência real continuam humanos.",
          caption: "Inteligência artificial pode organizar e produzir. Mas a matéria-prima que diferencia uma marca continua vindo de suas decisões, pessoas, clientes e histórias.",
          cta: "Qual história da sua empresa ainda não virou conteúdo?",
        },
      ];
    default: {
      const subject = short(signals.offer || signals.evidence, 110);
      return [
        {
          id: "specific-proof-01",
          objective: "autoridade",
          eyebrow: "Prova aplicada",
          title: `Mostre ${subject.toLowerCase()} funcionando em uma situação real`,
          visualDirection: "Caso em quatro momentos: problema reconhecível, método aplicado, entrega visível e resultado observável.",
          caption: `${name} pode transformar a mensagem “${subject}” em algo que o visitante consiga avaliar antes de contratar.`,
          hashtags: ["#provadevalor", "#posicionamento", "#negocios"],
          cta: "Veja como esse processo funcionaria na sua realidade.",
        },
        {
          id: "specific-demand-01",
          objective: "leads",
          eyebrow: "Problema reconhecível",
          title: `3 sinais de que chegou a hora de buscar ${signals.verticalLabel.toLowerCase()}`,
          visualDirection: "Carrossel com sintomas específicos, consequência, primeiro passo e convite para diagnóstico.",
          caption: "A demanda começa quando o público reconhece a própria situação antes de receber a oferta. Sintomas concretos geram mais identificação do que uma lista de serviços.",
          hashtags: ["#geracaodedemanda", "#conteudoestrategico", "#clientes"],
          cta: "Qual desses sinais aparece hoje na sua rotina?",
        },
        {
          ...commonHuman,
          title: `A decisão que levou a ${name} a trabalhar desta forma`,
          visualDirection: "Vídeo curto de fundador ou especialista com conflito, escolha, método e aprendizado.",
          caption: "Uma história real ajuda o público a entender por que a empresa existe, como pensa e em que acredita antes de avaliar uma proposta comercial.",
          cta: "Que decisão mudou a forma como sua empresa trabalha?",
        },
      ];
    }
  }
}

export function buildDiagnosticFromPage(
  input: DiagnosticCreateRequest,
  pageTitle: string,
  pageText: string,
  sourceRead = true,
): DiagnosticResult {
  const fallbackName = brandNameFromUrl(input.websiteUrl);
  const name = cleanBrandName(pageTitle, fallbackName);
  const signals = buildSignals(input, pageText, sourceRead);
  const diagnosis = diagnosticFor(name, signals);
  return {
    brandSummary: {
      name,
      segment: signals.verticalLabel,
      primaryOffer: signals.offer,
      audience: audienceFor(signals.vertical),
      positioning: diagnosis.opportunity,
    },
    diagnosis,
    campaigns: campaignsFor(name, signals),
  };
}

export class DemoDiagnosticProvider implements DiagnosticProvider {
  constructor(private readonly delayMs = 2600) {}

  async generate(input: DiagnosticCreateRequest): Promise<DiagnosticResult> {
    await sleep(this.delayMs);
    const fallbackName = brandNameFromUrl(input.websiteUrl);
    let pageTitle = fallbackName;
    let pageText = `${nicheLabels[input.niche]} ${input.instagramHandle || ""}`;
    let sourceRead = false;

    try {
      const source = await extractPublicSite(input.websiteUrl);
      pageTitle = source.title;
      pageText = source.text;
      sourceRead = true;
    } catch {
      // A resposta deixa explícito quando não foi possível ler a fonte.
    }

    return buildDiagnosticFromPage(input, pageTitle, pageText, sourceRead);
  }
}
