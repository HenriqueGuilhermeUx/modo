# MODO — ensaio de storyboard estático com CDP + FFmpeg

**Data:** 28/10/2026. **Escopo:** somente PR #164 DRAFT, branch `feat/hyperframes-pilot-20261025`. Nada publicado em produção.

## Objetivo e fronteira

Transformar a prova isolada `Chrome → screenshots → FFmpeg → MP4` num **ensaio de fidelidade temporal** para o subconjunto de projetos MODO já aceito pela prévia HyperFrames: vídeo vertical 1080×1920, 30fps, cenas de texto estático, cortes diretos, sem áudio, mídia externa, movimento ou transições complexas.

- `apps/api/src/services/hyperframes-static-storyboard.ts` recebe um `VideoProject` **já autorizado** pelo contexto do chamador e reutiliza `exportVideoProjectHyperframesPreview`. Não reinventa validação, não transforma funcionalidades incompatíveis e não usa dados de clientes no CI.
- A saída tem `scenes[]` com `startFrame`, `endFrame` e `frames` **inteiros**. O cronograma do encoder usa os quadros originais, nunca a duração HTML arredondada para três casas. Exemplo sintético: **31 + 64 + 55 = 150 quadros, 5 segundos** a 30fps.
- `infra/hyperframes-staging/modo-static-storyboard-synthetic.cjs` cria um `VideoProject` sintético, chama o exportador MODO compilado, serve somente HTML gerado em loopback com CSP restritiva, exibe **uma cena por vez** via cortes diretos, verifica o título/legenda de cada cena e captura três imagens diferentes. FFmpeg produz H264 sem áudio; FFprobe exige 1080×1920, 30fps, exatamente 150 frames e 5 segundos.
- `.github/workflows/hyperframes-cdp-ffmpeg-synthetic-ci.yml` executa tanto a prova simples anterior de dois quadros quanto esse storyboard real do MODO no contêiner temporário. Não carrega arquivos comerciais nem publica vídeo.

## Segurança — separação de processo testada, não homologação comercial

O contêiner **do renderizador sintético**, separado da execução de armazenamento PostgreSQL, recebe apenas a flag `MODO_HF_STATIC_STORYBOARD_CI=synthetic-only`. Não recebe `PGHOST`, `PGPASSWORD`, `DATABASE_URL`, chave HMAC/AES ou volume do socket PostgreSQL; o script verifica isso antes de iniciar o navegador. O Docker exige usuário não-root, rootfs somente leitura, capacidades removidas, `no-new-privileges`, limites de recursos e rede interna sem roteamento externo. Os arquivos HTML temporários/imagens/MP4 são apagados na saída e não são publicados como artefatos.

**Limitação:** a imagem de prova ainda deriva da imagem experimental do worker e contém dependências adicionais; a separação de credenciais é atualmente **em tempo de execução e mounts**, não uma imagem de renderização mínima auditada. Antes de tratar vídeos de clientes, criar imagem específica sem código/segredos do DB, contrato de handoff com autenticação e expiração, isolamento por tenant, limite de concorrência, logs sanitizados, escaneamento de dependências e operação em staging provisionado.

O Chrome utiliza `--no-sandbox` **internamente** devido à restrição de namespaces no Docker. Isso **não está aprovado** para conteúdo HTML não confiável de clientes. A rede `--internal` bloqueia saída externa, mas não substitui uma política de rede em profundidade nem elimina riscos de contato entre contêineres na mesma rede.

## Critérios de aceite do ensaio

1. Testes unitários do plano exigem os três limites de cena `[0,31)`, `[31,95)`, `[95,150)`, checksum estável e escape de HTML.
2. Qualquer gap, overlap, mídia remota, voz, efeito de movimento, formato ou duração incompatível deve ser **rejeitado**, mantendo o renderer Remotion existente.
3. CI real deve aprovar navegador offline, texto e corte em cada cena, fingerprints de imagens distintos, `ffprobe` com 150 quadros/30fps/5 segundos e ausência de áudio.
4. Não confundir esse resultado com equivalência visual frente ao Remotion ou com o **CLI HyperFrames**, que segue com sua própria verificação vermelha de `Network.enable timed out` no Docker.
5. Nenhuma rota, publicação, merge, deploy ou tarefa do Publisher V2 pode ser adicionada como efeito colateral.

**Próxima etapa depois da prova:** processar um projeto MODO sintético 100% representativo em um contêiner de renderização **independente do DB** e compará-lo visualmente ao Remotion quadro a quadro, em ambiente descartável, antes de qualquer piloto por convite.
