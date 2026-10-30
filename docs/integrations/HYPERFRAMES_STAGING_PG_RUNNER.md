# MODO HyperFrames — executor isolado: PostgreSQL + renderizador + MP4 privado

**Status:** implementação de engenharia na PR #164 (DRAFT), não publicada em Render/Netlify nem integrada ao servidor MODO de clientes. Operação inicial somente com organizações sintéticas e banco PostgreSQL descartável de CI.

## Fluxo implementado

`apps/api/src/services/hyperframes-staging-pg-render-runner.ts` expõe duas funções internas:

- `stagingRenderRequestSha256(project, brandName)`: digest SHA-256 do conteúdo do projeto, organização e marca que será renderizada; o agendador deve usar o mesmo digest na criação do job com `HyperframesStagingPgQueue.enqueue`.
- `processStagingHyperframesPgJob({ jobId, project, brandName, authorizedOrganizationId, workerId, queue, artifacts, tools })`: verifica autorização da organização e digest do trabalho **antes de reclamar o job**; adquire o lease e um fencing token; executa `renderHyperframesStagingPreview` (com `hyperframes lint/check/render` e `ffprobe`) no worker; renova o lease periodicamente; verifica os metadados do MP4; usa `HyperframesStagingPgArtifacts.finishWithVideo` para persistir o MP4 criptografado e finalizar o job na mesma transação.

Os estados retornados são `unclaimed`, `completed`, `failed` e `lost-lease`. Nenhum expõe stdout/stderr do renderizador, vídeo bruto, arquivo público, URL ou credenciais. A saída MP4 em memória é zerada ao fim da tentativa.

## Controles

- São obrigatórias **quatro flags** em um processo não produtivo: `MODO_HYPERFRAMES_WORKER_MODE`, `MODO_HYPERFRAMES_RECOVERY_MODE`, `MODO_HYPERFRAMES_DB_MODE` e `MODO_HYPERFRAMES_STORAGE_MODE` com valor `isolated-staging`. `NODE_ENV=production` sempre bloqueia.
- `HyperframesStagingPgQueue` e `HyperframesStagingPgArtifacts` verificam no PostgreSQL a identidade do banco `modo_hyperframes_staging` e recusam qualquer outro.
- O agendador que chama o executor **deve autenticar o usuário, organização e worker por mecanismo independente**; `authorizedOrganizationId` não pode vir de uma requisição arbitrária do navegador.
- O digest protege contra processar projeto/brandName diferente do pedido armazenado. Para retry após crash, o agendador deve conseguir reconstruir o **mesmo snapshot imutável**, sem consultar uma versão editada de projeto.
- Lease padrão de 60 segundos, renovação a cada 15 segundos; intervalo configurável com limite menor que metade do lease. O PostgreSQL decide o tempo efetivo para reivindicação, heartbeat e conclusão.
- Um worker vencido/reassumido não consegue gravar ciphertext nem finalizar o job; as tentativas são limitadas pelo protocolo. Falhas de heartbeat não expõem MP4, e falhas do renderizador retornam estado sanitizado.

## Limites ainda importantes

1. **Não é daemon / dispatcher:** o método processa um job explicitamente identificado. Não há polling, ciclo de execução contínua, endpoints HTTP, autenticação de serviço, fila de priorização, webhooks ou deploy.
2. **Não há snapshot de fonte persistido:** o PostgreSQL mantém hash e metadados, mas não guarda projetos, HTML nem assets. Um processo reiniciado só poderá reprocessar um job se um scheduler autorizado fornecer o mesmo snapshot pelo qual o hash foi calculado.
3. **Interrupção de subprocesso:** perder o lease impede commit, mas não interrompe instantaneamente o renderizador CLI já iniciado. O executor do HyperFrames tem limite de 300 segundos e deve rodar em container isolado com quotas de CPU/memória, egress restrito e limpeza de arquivos temporários.
4. **Validação de mídia:** o executor exige o `ffprobe` real e fixado na imagem, valida um único stream de vídeo, 1080x1920, fps 30 e duração esperada. Os testes de CI usam mock controlado; a execução de binários HyperFrames/FFmpeg reais ainda não foi homologada.
5. **Chave e banco:** key de AES-256-GCM de 32 bytes externa ao GitHub e ao banco. O armazenamento `BYTEA` no PostgreSQL é um piloto de baixo volume, não solução escalável com KMS/CDN.
6. **Sem publicação:** nenhum fluxo chama Publisher V2, posts, campanhas, clientes, cobrança ou renderização Remotion atual. A prévia HTML publicada pela PR #170 permanece independente.
7. **Antes de ir ao ar com MP4:** testar binários reais em container egress restrito, provisionar staging isolado, autenticar o scheduler/worker, implementar recuperação de snapshots, avaliar volume/custo/storage, rever dependências e lançar em rollout controlado.

## Testes

O workflow `HyperFrames isolated Postgres recovery CI` aplica as migrações `001` e `002` a um PostgreSQL 16 descartável e executa, com dados sintéticos:

- Deduplicação e concorrência dos jobs.
- Persistência e autenticação de arquivos AES-GCM.
- Renderização via stub determinístico, sem mídia real, seguida de commit criptografado.
- Falha do render, troca de worker/fencing token e lease vencido.
- Renovação de lease em renderização lenta.
- Verificação de projeto/brandName alterado antes do claim e ausência de execução em produção.

O teste de smoke geral MODO continua exigindo build, API saudável, Remotion e Publisher V2 sem regressões.
