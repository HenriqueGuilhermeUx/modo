const PRIVACY_EMAIL = "henriquecampos66@gmail.com";

function LegalShell({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <a href="/" aria-label="Voltar para a página inicial da MODO">
          <img src="/logo.svg" alt="MODO" />
        </a>
        <nav>
          <a href="/politica-de-privacidade">Privacidade</a>
          <a href="/exclusao-de-dados">Exclusão de dados</a>
          <a href="/app">Entrar</a>
        </nav>
      </header>

      <main className="legal-main">
        <section className="legal-hero">
          <span>{eyebrow}</span>
          <h1>{title}</h1>
          <p>{summary}</p>
          <small>Última atualização: 31 de julho de 2026</small>
        </section>

        <article className="legal-document">{children}</article>
      </main>

      <footer className="legal-footer">
        <img src="/logo.svg" alt="MODO" />
        <div>
          <strong>Alternative Ventures</strong>
          <span>CNPJ 61.920.356/0001-38</span>
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
        </div>
      </footer>
    </div>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalShell
      eyebrow="PRIVACIDADE E PROTEÇÃO DE DADOS"
      title="Política de Privacidade da MODO"
      summary="Esta política explica quais dados a MODO trata, por que eles são necessários, com quem podem ser compartilhados e como você pode exercer seus direitos."
    >
      <section>
        <h2>1. Quem é responsável pelos dados</h2>
        <p>
          A MODO é uma solução da <strong>Alternative Ventures</strong>, inscrita no CNPJ
          61.920.356/0001-38. Para questões sobre privacidade, proteção de dados ou
          exercício de direitos, o canal oficial é <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
        </p>
      </section>

      <section>
        <h2>2. A quem esta política se aplica</h2>
        <p>
          Esta política se aplica a visitantes do site, pessoas que realizam diagnósticos,
          usuários da plataforma, representantes de empresas, integrantes de equipes e
          pessoas que conectam contas profissionais de redes sociais à MODO.
        </p>
      </section>

      <section>
        <h2>3. Dados que podemos tratar</h2>
        <ul>
          <li><strong>Conta e identificação:</strong> nome, e-mail, credenciais protegidas, organização, marca e função do usuário.</li>
          <li><strong>Dados da marca:</strong> nome comercial, segmento, site, perfis públicos, produtos, serviços, público, objetivos e referências fornecidas pelo usuário.</li>
          <li><strong>Uso da plataforma:</strong> plano, créditos, missões, campanhas, conteúdos, aprovações, revisões, preferências e histórico de ações.</li>
          <li><strong>Diagnósticos e inteligência:</strong> URLs, termos de busca, regiões, concorrentes, produtos e resultados públicos ou autorizados utilizados nas análises.</li>
          <li><strong>Integração com Instagram:</strong> identificador da conta profissional, nome de usuário, autorizações concedidas, token de acesso protegido, status da conexão, conteúdo aprovado para publicação, identificadores e links das publicações. A MODO não solicita nem armazena a senha do Instagram.</li>
          <li><strong>Dados técnicos:</strong> endereço IP, navegador, dispositivo, registros de acesso, eventos de segurança, falhas e informações necessárias para prevenir abuso.</li>
          <li><strong>Atendimento e cobrança:</strong> mensagens de suporte, solicitações, informações da assinatura e registros de pagamento processados por fornecedores especializados.</li>
        </ul>
      </section>

      <section>
        <h2>4. Como usamos os dados</h2>
        <ul>
          <li>criar, autenticar e administrar contas e organizações;</li>
          <li>prestar os serviços contratados e entregar diagnósticos, conteúdos, campanhas, análises e recomendações;</li>
          <li>publicar conteúdo somente após ação ou aprovação do usuário, quando houver integração disponível;</li>
          <li>manter memória de marca, histórico, preferências e continuidade operacional;</li>
          <li>processar assinaturas, controlar limites e prevenir uso indevido;</li>
          <li>prestar suporte, responder solicitações e comunicar mudanças relevantes;</li>
          <li>melhorar segurança, qualidade, confiabilidade e desempenho da plataforma;</li>
          <li>cumprir obrigações legais, regulatórias, contratuais e exercer direitos em processos.</li>
        </ul>
      </section>

      <section>
        <h2>5. Bases legais</h2>
        <p>
          O tratamento pode ocorrer para execução de contrato e procedimentos preliminares,
          cumprimento de obrigação legal ou regulatória, exercício regular de direitos,
          proteção contra fraudes, atendimento a interesses legítimos compatíveis com as
          expectativas do titular e, quando necessário, mediante consentimento.
        </p>
      </section>

      <section>
        <h2>6. Compartilhamento de dados</h2>
        <p>A MODO não vende dados pessoais. Podemos compartilhar somente o necessário com:</p>
        <ul>
          <li>provedores de hospedagem, banco de dados, segurança, monitoramento, comunicação e armazenamento;</li>
          <li>fornecedores de inteligência artificial, automação e coleta de fontes públicas ou autorizadas;</li>
          <li>processadores de pagamento e serviços de assinatura;</li>
          <li>Meta e outras plataformas conectadas, quando o usuário solicitar autenticação, publicação ou outra ação integrada;</li>
          <li>profissionais autorizados da operação MODO, sujeitos a deveres de confidencialidade e acesso limitado;</li>
          <li>autoridades públicas ou terceiros quando houver obrigação legal, ordem válida ou necessidade de proteger direitos.</li>
        </ul>
      </section>

      <section>
        <h2>7. Transferências internacionais</h2>
        <p>
          Alguns fornecedores tecnológicos e plataformas sociais podem tratar dados fora do
          Brasil. Nessas situações, buscamos utilizar fornecedores com medidas contratuais,
          técnicas e organizacionais adequadas à proteção dos dados e às regras aplicáveis.
        </p>
      </section>

      <section>
        <h2>8. Segurança</h2>
        <p>
          Adotamos controles de acesso, proteção de credenciais, criptografia de tokens de
          integração, registros de segurança e medidas de redução de exposição. Nenhum sistema
          é totalmente imune a incidentes, mas trabalhamos para prevenir, detectar e responder
          a riscos de forma proporcional à natureza dos dados tratados.
        </p>
      </section>

      <section>
        <h2>9. Retenção e exclusão</h2>
        <p>
          Mantemos os dados pelo período necessário para prestar o serviço, preservar o
          histórico solicitado, cumprir obrigações legais e contratuais, resolver disputas e
          proteger a plataforma. Quando os dados deixarem de ser necessários, poderão ser
          eliminados ou anonimizados, ressalvadas as hipóteses legais de conservação, registros
          de segurança e cópias de backup com acesso restrito e ciclo próprio de expiração.
        </p>
      </section>

      <section>
        <h2>10. Seus direitos</h2>
        <p>Nos termos da legislação aplicável, você pode solicitar:</p>
        <ul>
          <li>confirmação da existência de tratamento e acesso aos dados;</li>
          <li>correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>informações sobre compartilhamento;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade;</li>
          <li>portabilidade, quando aplicável e regulamentada;</li>
          <li>revogação do consentimento e eliminação de dados tratados com consentimento, observadas as exceções legais;</li>
          <li>oposição ao tratamento, quando cabível;</li>
          <li>revisão de decisões tomadas exclusivamente por tratamento automatizado, quando aplicável.</li>
        </ul>
        <p>
          Para proteger a conta, poderemos solicitar informações razoáveis para confirmar a
          identidade e a legitimidade do pedido.
        </p>
      </section>

      <section>
        <h2>11. Cookies e armazenamento local</h2>
        <p>
          A plataforma pode utilizar cookies e armazenamento local estritamente necessários
          para sessão, segurança, preferências, continuidade do diagnóstico e funcionamento da
          experiência. Ferramentas adicionais de análise, quando adotadas, deverão observar as
          opções e informações disponibilizadas ao usuário.
        </p>
      </section>

      <section>
        <h2>12. Crianças e adolescentes</h2>
        <p>
          A MODO é destinada a atividades profissionais e empresariais e não é direcionada a
          crianças. Caso identifiquemos dados de criança tratados sem base adequada, adotaremos
          medidas para sua exclusão e proteção.
        </p>
      </section>

      <section>
        <h2>13. Alterações desta política</h2>
        <p>
          Esta política pode ser atualizada para refletir mudanças legais, técnicas ou de
          produto. A versão vigente ficará disponível nesta página com a data da atualização.
          Mudanças relevantes poderão ser comunicadas pelos canais disponíveis na plataforma.
        </p>
      </section>

      <section className="legal-contact-card">
        <h2>Contato de privacidade</h2>
        <p>
          Escreva para <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> com o assunto
          “Privacidade MODO”.
        </p>
        <a className="legal-button" href="/exclusao-de-dados">Ver instruções de exclusão de dados</a>
      </section>
    </LegalShell>
  );
}

export function DataDeletionPage() {
  return (
    <LegalShell
      eyebrow="CONTROLE DOS SEUS DADOS"
      title="Instruções para exclusão de dados"
      summary="Você pode solicitar a exclusão da conta, de dados pessoais ou de informações vinculadas às integrações da MODO."
    >
      <section>
        <h2>1. Como solicitar</h2>
        <p>
          Envie um e-mail para <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> usando,
          de preferência, o mesmo endereço cadastrado na MODO.
        </p>
        <div className="legal-example">
          <strong>Assunto:</strong> Exclusão de dados MODO
          <br />
          <strong>Informe:</strong> nome completo, e-mail da conta, organização ou marca e,
          quando aplicável, o nome de usuário do Instagram conectado.
        </div>
      </section>

      <section>
        <h2>2. Diga o que deve ser excluído</h2>
        <p>Você pode pedir uma ou mais destas ações:</p>
        <ul>
          <li>exclusão integral da conta e dos dados associados;</li>
          <li>exclusão de uma marca, organização, conteúdo, campanha ou missão específica;</li>
          <li>remoção dos dados da integração com Instagram, incluindo identificadores e token de acesso;</li>
          <li>revogação de autorizações e interrupção de futuras publicações;</li>
          <li>eliminação de dados pessoais tratados com consentimento, quando aplicável.</li>
        </ul>
      </section>

      <section>
        <h2>3. Verificação de segurança</h2>
        <p>
          Antes de realizar a exclusão, poderemos solicitar confirmação por e-mail ou outras
          informações razoáveis para impedir que terceiros removam dados sem autorização.
          Nunca solicitaremos sua senha do Instagram por e-mail.
        </p>
      </section>

      <section>
        <h2>4. O que acontece após o pedido</h2>
        <ol>
          <li>registramos a solicitação e confirmamos o recebimento;</li>
          <li>verificamos a identidade e o escopo do pedido;</li>
          <li>desativamos acessos e integrações abrangidos pela solicitação;</li>
          <li>excluímos ou anonimizamos os dados elegíveis nos sistemas ativos;</li>
          <li>enviamos uma confirmação quando o processo principal estiver concluído.</li>
        </ol>
        <p>
          O atendimento ocorrerá nos prazos aplicáveis da legislação. Alguns registros podem
          ser conservados quando necessários para cumprir obrigação legal, prevenir fraude,
          resolver disputas, proteger direitos ou respeitar o ciclo de retenção de backups.
          Durante esse período, o acesso permanece restrito às finalidades autorizadas.
        </p>
      </section>

      <section>
        <h2>5. Dados do Instagram e da Meta</h2>
        <p>
          A exclusão realizada pela MODO abrange os dados que estão sob nosso controle. Dados
          mantidos diretamente pela Meta ou pelo Instagram estão sujeitos às configurações,
          políticas e ferramentas dessas plataformas. Remover a integração na MODO não exclui
          automaticamente a conta do Instagram nem publicações já existentes na plataforma.
        </p>
      </section>

      <section className="legal-contact-card">
        <h2>Enviar solicitação</h2>
        <p>
          Canal oficial: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
        </p>
        <a
          className="legal-button"
          href={`mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent("Exclusão de dados MODO")}`}
        >
          Solicitar exclusão por e-mail
        </a>
      </section>
    </LegalShell>
  );
}
