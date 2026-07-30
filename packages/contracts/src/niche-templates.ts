import type { Niche } from "./index.js";

export interface NicheTemplate {
  contentPillars: string[];
  commonAngles: string[];
  toneGuidance: string;
  wordsToAvoid: string[];
  provenHooks: string[];
}

/**
 * Direções editoriais de referência por segmento.
 * Não representam evidência estatística própria da MODO e nunca substituem
 * o briefing, a Base Estratégica, as restrições ou os aprendizados reais da marca.
 */
export const nicheTemplates: Record<Niche, NicheTemplate> = {
  saude_estetica: {
    contentPillars: [
      "Resultados reais apresentados com contexto, consentimento e limites claros",
      "Segurança, indicação, contraindicação e cuidados antes e depois do procedimento",
      "Bastidores humanizados da equipe, estrutura e rotina de atendimento",
      "Educação sobre o problema, o tratamento e as expectativas realistas",
      "Dúvidas frequentes que reduzem medo e ajudam o paciente a decidir com consciência",
    ],
    commonAngles: [
      "Antes e depois com explicação do caso e sem prometer repetição do resultado",
      "Mito ou verdade sobre o procedimento",
      "O que acontece em cada etapa da avaliação ao pós-atendimento",
      "Sinais de que é hora de procurar orientação profissional",
    ],
    toneGuidance: "Acolhedor, responsável e técnico na medida certa. Explicar sem alarmismo, evitar diagnóstico remoto e nunca prometer resultado garantido.",
    wordsToAvoid: ["milagroso", "sem dor nenhuma", "100% garantido", "resultado perfeito", "cura definitiva"],
    provenHooks: [
      "Você já ouviu isso sobre este procedimento e acreditou?",
      "3 coisas que ninguém deveria esconder antes de um tratamento",
      "O que muda quando a avaliação é feita com calma e critério",
      "Antes de decidir, observe estes sinais",
    ],
  },
  servicos_profissionais: {
    contentPillars: [
      "Explicação prática de problemas que o cliente enfrenta no dia a dia",
      "Método de trabalho, etapas, critérios e bastidores da prestação do serviço",
      "Casos anonimizados, aprendizados e provas autorizadas",
      "Erros comuns que geram custo, atraso, risco ou retrabalho",
      "Perguntas frequentes que antecipam objeções e melhoram a decisão",
    ],
    commonAngles: [
      "Diagnóstico de um erro que parece pequeno, mas custa caro",
      "Passo a passo do que acontece depois da contratação",
      "Comparação entre improviso e processo profissional",
      "Checklist para o cliente saber quando precisa de ajuda especializada",
    ],
    toneGuidance: "Consultivo, claro e seguro. Demonstrar domínio sem juridiquês ou superioridade. Priorizar orientação útil, transparência de escopo e responsabilidade.",
    wordsToAvoid: ["resultado garantido", "somos os melhores", "sem risco", "solução definitiva", "sucesso certo"],
    provenHooks: [
      "O erro mais caro costuma acontecer antes de você perceber",
      "Antes de contratar, faça estas perguntas",
      "O que um bom processo evita nos bastidores",
      "3 sinais de que o problema já passou do improviso",
    ],
  },
  imoveis: {
    contentPillars: [
      "Tour do imóvel conectado a situações reais de vida",
      "Educação sobre financiamento, documentação e custos da compra",
      "Bairro, mobilidade, serviços e rotina da região",
      "Prova social e histórias de clientes com autorização",
      "Comparação transparente entre perfis de imóvel e necessidades",
    ],
    commonAngles: [
      "Um dia de visita com os pontos que realmente importam",
      "Erro comum na hora de comprar ou alugar",
      "Comparação de bairros para perfis diferentes",
      "O custo que costuma ficar fora da conta inicial",
    ],
    toneGuidance: "Consultivo e objetivo, sem pressão artificial. Ajudar o cliente a tomar uma decisão informada e contextualizar condições, disponibilidade e custos.",
    wordsToAvoid: ["oportunidade única", "última unidade", "correria", "garantia de valorização", "imperdível"],
    provenHooks: [
      "Antes de assinar, veja isso",
      "O que ninguém te conta sobre financiar um imóvel",
      "Este detalhe muda completamente a rotina neste bairro",
      "O imóvel parece ideal, mas confira estes custos primeiro",
    ],
  },
  varejo: {
    contentPillars: [
      "Demonstração do produto em uso e resolução de problemas reais",
      "Comparações honestas entre versões, tamanhos, materiais ou aplicações",
      "Prova social, avaliações, conteúdo de clientes e pós-venda",
      "Bastidores de seleção, produção, embalagem e atendimento",
      "Ofertas transparentes com condição, prazo e estoque verdadeiros",
    ],
    commonAngles: [
      "Teste prático do produto em uma situação cotidiana",
      "Qual versão faz sentido para cada perfil",
      "O detalhe que diferencia qualidade de aparência",
      "Como escolher sem gastar com algo inadequado",
    ],
    toneGuidance: "Direto, visual e útil. Mostrar benefício concreto antes do preço. Informar condições com precisão e evitar urgência falsa ou superlativos sem prova.",
    wordsToAvoid: ["últimas unidades" , "corre", "o melhor do mercado", "preço inacreditável", "garantido"],
    provenHooks: [
      "Antes de comprar, veja a diferença na prática",
      "Este detalhe evita escolher o modelo errado",
      "Para quem este produto realmente vale a pena?",
      "3 formas de usar que pouca gente percebe",
    ],
  },
  educacao: {
    contentPillars: [
      "Aulas curtas que resolvem uma dúvida específica",
      "Demonstração do método, materiais e experiência de aprendizagem",
      "Jornada do aluno com expectativas e esforço realistas",
      "Erros comuns, exercícios práticos e feedback",
      "Histórias e resultados de alunos com contexto e autorização",
    ],
    commonAngles: [
      "Mini aula com aplicação imediata",
      "Erro de estudo ou execução que trava o progresso",
      "Antes e depois do entendimento, não apenas do resultado",
      "Como o método organiza uma habilidade complexa",
    ],
    toneGuidance: "Didático, encorajador e específico. Valorizar processo, prática e acompanhamento. Não prometer domínio instantâneo, aprovação ou emprego garantido.",
    wordsToAvoid: ["aprenda sem esforço", "domine em poucos dias", "garantia de emprego", "resultado certo", "fórmula secreta"],
    provenHooks: [
      "Você não precisa decorar isto para entender",
      "O erro que faz muita gente estudar mais e aprender menos",
      "Experimente este exercício antes da próxima aula",
      "Em 1 minuto, entenda a lógica por trás de...",
    ],
  },
  creator: {
    contentPillars: [
      "Ponto de vista original sobre o tema central da marca pessoal",
      "Bastidores de criação, decisões, testes e aprendizados",
      "Histórias pessoais conectadas a uma lição útil para a audiência",
      "Demonstração de repertório, processo e resultados autorizados",
      "Conversas com a comunidade, perguntas e construção pública",
    ],
    commonAngles: [
      "Opinião fundamentada que contrasta com o senso comum",
      "O que mudou depois de testar uma abordagem",
      "Bastidor de uma decisão criativa ou profissional",
      "História curta que leva a um princípio aplicável",
    ],
    toneGuidance: "Humano, reconhecível e coerente com a personalidade real. Evitar personagem artificial, exagero de autoridade e fórmulas de viralização sem contexto.",
    wordsToAvoid: ["segredo", "hack infalível", "viral garantido", "ninguém te conta", "fórmula perfeita"],
    provenHooks: [
      "Eu mudei de opinião sobre isso",
      "O bastidor que quase nunca aparece no resultado final",
      "O que eu faria diferente se começasse hoje",
      "Esta decisão simples mudou a forma como eu trabalho",
    ],
  },
  outro: {
    contentPillars: [
      "Problemas e situações reais vividas pelo público prioritário",
      "Explicação do processo, método ou funcionamento da solução",
      "Demonstrações, exemplos e provas autorizadas",
      "Perguntas frequentes, objeções e critérios de escolha",
      "Bastidores, pessoas e valores que tornam a marca reconhecível",
    ],
    commonAngles: [
      "Problema invisível que merece atenção",
      "Demonstração de como funciona na prática",
      "Erro comum e alternativa mais segura",
      "História de transformação sem promessas exageradas",
    ],
    toneGuidance: "Claro, específico e orientado ao contexto real da marca. Quando o segmento for amplo, priorizar o briefing e evitar preencher lacunas com clichês.",
    wordsToAvoid: ["revolucionário", "inovador" , "líder de mercado", "solução completa", "resultado garantido"],
    provenHooks: [
      "O problema não começa onde parece",
      "Veja como isso funciona na prática",
      "Antes de escolher, compare estes critérios",
      "Uma mudança simples pode evitar este retrabalho",
    ],
  },
};
