# MODO — HyperFrames Preview HTML: release isolada e reversível

**Escopo desta release:** disponibilizar no MODO, apenas por opção habilitada, uma exportação de **composição HTML estática e somente leitura** para projetos de vídeo autorizados por organização. Esta release **não** entrega MP4, fila durável, importação de mídia externa, publicações automáticas nem geração de criativos com custo.

Origem de código: módulos já homologados na PR #164, mas copiados cirurgicamente da branch de engenharia. Esta release **NÃO** contém o worker FFmpeg, fila em RAM, cofre criptografado, protocolo de recuperação, alterações de dependências ou a PR #166 de segurança. O Remotion permanece o renderizador oficial.

## Segurança

- Feature flag de servidor `MODO_HYPERFRAMES_PREVIEW_ENABLED=true` **e** de build da interface `VITE_HYPERFRAMES_PREVIEW_ENABLED=true` necessárias para uso completo.
- Endpoint GET autenticado: `/api/v1/video-projects/:id/hyperframes-preview`. `renderContext` recupera o projeto da organização autenticada e sua marca. Há rate limit e `Cache-Control: no-store`.
- Não gera ordens, renderiza MP4, grava dados no banco, publica vídeos ou acessa serviços externos.
- Apenas vídeo vertical 1080x1920, 30fps, cenas de texto estático, sem trilhas de áudio, animações, imagens externas ou alterações de timeline não suportadas. Projetos incompatíveis retornam 422.
- Texto e marca são escapados para HTML antes de exportação; o HTML não é executado dentro do site. A UI oferece somente download técnico para avaliação.
- O aplicativo permanece com Remotion quando a opção não estiver disponível.

## Sequência de release

1. Revisar esta PR de release contra `main`; confirmar que contém **somente** serviço e testes de HTML, rota, botão web, CSS e documentação. Sem arquivos de fila, cofre, FFmpeg, mobile, lockfile nem segredos.
2. Exigir CI completo, build, teste de isolamento e smoke do app. Inspecionar segurança de auth e tenant na rota.
3. Mesclar a PR de release somente se todas as validações estiverem aprovadas. Render/Netlify conectados em `main` fazem deploy automático; não disparar deploy duplicado.
4. Verificar `/health`, página inicial do MODO, fluxo autenticado e ausência da feature enquanto flags estiverem desligadas.
5. Ativar gradualmente `MODO_HYPERFRAMES_PREVIEW_ENABLED=true` no **Render modo-api** e `VITE_HYPERFRAMES_PREVIEW_ENABLED=true` na **Netlify modo1**. No Netlify a flag é de **build**; um novo build é obrigatório.
6. Validar com uma organização autorizada de teste: GET do projeto correto, GET de outra organização bloqueado, projeto incompatível 422, download HTML sem execução em app, Remotion e Publisher V2 inalterados.
7. Rollback: desligar **primeiro a flag do backend**, depois a de frontend (com rebuild). Em caso de instabilidade, restaurar o commit/deploy estável; preservar todas as operações já existentes.

**Critério de aceite:** cliente autenticado vê um botão de **exportação HTML experimental** em projetos compatíveis, e nunca uma opção nova de publicar ou gastar créditos. O MP4 de HyperFrames permanece bloqueado em PR #164 até infraestrutura e revisão específicas.

## Dependências

Esta release não altera `package.json` ou `package-lock.json`. Os alertas de dependências preexistentes continuam em acompanhamento independente e **não** devem ser ignorados para uma futura liberação do worker MP4.
