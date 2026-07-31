type GuideMode = "public" | "portal";

interface Props {
  mode: GuideMode;
}

const paths = [
  {
    key: "scan",
    number: "01",
    name: "MODO Scan",
    question: "Não sei onde minha comunicação perde força.",
    description: "Analisa a própria marca, o site ou a página profissional para encontrar um problema concreto de percepção e uma oportunidade inicial.",
    when: "Use no começo, ao reposicionar a marca ou quando a divulgação não gera resposta.",
    result: "Descoberta, consequência comercial e primeiro movimento recomendado.",
  },
  {
    key: "movement",
    number: "02",
    name: "Meu próximo movimento",
    question: "Conheço minha marca, mas não sei o que fazer agora.",
    description: "Organiza contexto, prioridades, canais e capacidade real para indicar a ação mais útil do próximo ciclo.",
    when: "Use toda semana ou sempre que houver muitas ideias e pouca clareza de prioridade.",
    result: "Plano executável com objetivo, esforço, canal e resultado esperado.",
  },
  {
    key: "intelligence",
    number: "03",
    name: "Inteligência de mercado",
    question: "Preciso entender o que acontece fora da minha marca.",
    description: "Pesquisa concorrentes, reputação, ofertas, empresas, sinais de demanda e preços em fontes públicas ou autorizadas.",
    when: "Use quando uma decisão depende de evidências do mercado, e não apenas da comunicação da marca.",
    result: "Missões de pesquisa, resultados verificáveis e sinais para orientar decisões.",
  },
] as const;

function pathHref(mode: GuideMode, key: (typeof paths)[number]["key"]) {
  if (key === "scan") return mode === "public" ? "#diagnostico" : "/#diagnostico";
  if (key === "movement") return "/app/director";
  return mode === "public" ? "#inteligencia" : "/app/inteligencia";
}

function actionLabel(key: (typeof paths)[number]["key"]) {
  if (key === "scan") return "Analisar minha marca";
  if (key === "movement") return "Ver meu próximo movimento";
  return "Criar missão de inteligência";
}

export default function ProductPathGuide({ mode }: Props) {
  return (
    <section className={`product-path-guide product-path-guide-${mode}`} id={mode === "public" ? "caminhos-modo" : "caminhos-modo-painel"}>
      <div className="product-path-guide-inner">
        <header className="product-path-guide-heading">
          <div>
            <small>POR ONDE COMEÇAR</small>
            <h2>Qual ajuda você precisa agora?</h2>
          </div>
          <p>Não são três nomes para a mesma coisa. Cada módulo responde a uma dúvida diferente, e a Modo mostra quando vale a pena usar cada um.</p>
        </header>

        <div className="product-path-decision">
          <span><b>Olhar para dentro</b> MODO Scan</span>
          <i>→</i>
          <span><b>Escolher a próxima ação</b> Meu próximo movimento</span>
          <i>→</i>
          <span><b>Olhar para fora</b> Inteligência de mercado</span>
        </div>

        <div className="product-path-grid">
          {paths.map((item) => (
            <article key={item.key} className={`product-path-card product-path-${item.key}`}>
              <div className="product-path-card-top"><span>{item.number}</span><strong>{item.name}</strong></div>
              <h3>“{item.question}”</h3>
              <p>{item.description}</p>
              <dl>
                <div><dt>Quando usar</dt><dd>{item.when}</dd></div>
                <div><dt>O que você recebe</dt><dd>{item.result}</dd></div>
              </dl>
              <a href={pathHref(mode, item.key)}>{actionLabel(item.key)} <span>↗</span></a>
            </article>
          ))}
        </div>

        <p className="product-path-note"><strong>Você não precisa escolher sozinho.</strong> A Modo pode indicar o caminho mais adequado conforme a dúvida, o estágio da marca e o resultado que você quer alcançar.</p>
      </div>
    </section>
  );
}
