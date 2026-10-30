# HyperFrames — contrato de recuperação de jobs (staging, sem deploy)

Código: `apps/api/src/services/hyperframes-staging-recovery-protocol.ts`. Testes: `hyperframes-staging-recovery-protocol.test.ts`.

## Estado implementado

Este código é **apenas o protocolo de transições** que um storage transacional externo deverá usar. Não há Postgres instalado para esse fluxo, nem tabela criada, nem scheduler, nem worker distribuído, nem endpoint ou conexão com o sistema atual do MODO.

- Jobs têm apenas metadados: organização, projeto, chave idempotente, SHA-256 do pedido imutável, estado, versão, tentativas, lease e referência opaca do resultado; nenhum HTML, mídia do cliente, token ou chave privada.
- Só cria/renova/conclui uma tarefa para uma organização autorizada e uma posse (worker + token de fencing) ainda ativa.
- Depois do vencimento do lease, outro worker pode reivindicar a tarefa com novo token. O worker antigo não pode confirmar sucesso nem apagar a tarefa com seu token vencido.
- Máximo de três tentativas. A conclusão encerra a tarefa; uma tentativa subsequente de conclusão ou retry é recusada.
- Chave idempotente repetida somente é admissível para o mesmo projeto e mesmo digest de pedido; uso da mesma chave para pedidos diferentes é conflito.
- Nenhuma tarefa é publicável: `previewOnly=true`, `published=false`.
- A flag `MODO_HYPERFRAMES_RECOVERY_MODE=isolated-staging` é necessária; `NODE_ENV=production` bloqueia as operações.

## Persistência obrigatória para o próximo ciclo

O protocolo **não** garante atomicidade sozinho. Sua adoção futura exige um adaptador de banco de homologação com:

1. Restrição `UNIQUE (organization_id, idempotency_key)`. Fazer inserção concorrente e, em caso de conflito, comparar os campos imutáveis usando `assertRecoveryIdempotentReuse`; nunca aceitar silenciosamente outra versão do payload.
2. Trocas de estado sob `UPDATE ... SET ..., version = version + 1 WHERE job_id = :job_id AND organization_id = :organization_id AND version = :expected_version RETURNING ...`. Só considerar a transição válida quando **exatamente uma linha** mudar.
3. `NOW()`/tempo do **banco** como referência comum para lease, quando houver mais de um worker, com controle de duração e limite máximo de 60 segundos por lease. O relógio recebido pelas funções de domínio é exclusivamente um modelo de teste.
4. Claim em transação, de preferência seleção `FOR UPDATE SKIP LOCKED`, protegendo tenant, estado e vencimento. Nunca passar token de lease como autorização do cliente.
5. Finalização por **fencing token + versão**. Antes da publicação de um objeto final no bucket privado, validar a posse atual em operação transacional ou usar promoção condicional de objeto com identidade de tentativa. Nunca promover o MP4 de um worker cujo lease expirou.
6. Retry máximo de três e nenhum efeito externo no ciclo de renderização. Uma falha pode deixar objetos temporários órfãos; o reaper deve removê-los por TTL, com política de auditoria sem dados sensíveis.
7. Job deve transportar um identificador opaco de asset privado; leitura só pela organização autenticada com validação novamente no banco. Object storage requer acesso privado, criptografia/KMS própria, sem public ACL, listagem ou token reaproveitado de serviços financeiros.
8. Separar roles e bases de homologação dos clientes em produção. Adotar logs estruturados apenas de IDs e resultados sanitizados, retenção curta, limites de CPU/memória/custo e zero credenciais de Publisher V2.

## Matriz de testes existente

- Concorrência e CAS simulado por versão: somente uma transição de determinada versão pode prevalecer.
- Expiração, extensão de lease e fencing: tokens antigos não concluem a tarefa.
- Idempotência: mesmo pedido pode reutilizar a mesma chave; pedido diferente não.
- Falha ou expiração na terceira tentativa: resultado terminal sem retry infinito.
- Escopo por organização e checagem dos formatos dos IDs, digest e metadados de storage.
- Bloqueio em produção, sem segredos, pagamentos ou publicação.

## Separação das responsabilidades

O `hyperframes-staging-preview-queue.ts` é **fila efêmera de processo**; o `hyperframes-staging-encrypted-vault.ts` é **cofre AES-GCM efêmero de RAM**. O novo protocolo descreve as condições sob as quais um job poderá ser **persistido e recuperado no futuro**. Os três módulos são independentes e **não estão ligados a uma fila durável real**.

**Bloqueios de release:** prover DB isolado + migrações reversíveis, teste de falha real entre claim/render/storage/ack, KMS, isolamento multi-tenant, revisão de vulnerabilidades de dependências e garantia de que o Publisher V2 permanece completamente separado. Não ativar em produção e não mesclar a PR #164.


## Incremento 27/10/2026 — persistência PostgreSQL REAL, exclusiva de staging

Foi acrescentado um **adaptador transacional funcional** no código `apps/api/src/services/hyperframes-staging-pg-queue.ts`, com migração em `infra/hyperframes-staging/001_render_jobs.sql`. O adaptador implementa `enqueue/get/claim/heartbeat/finish/fail` sobre uma tabela de tarefas persistida, transações e `SELECT ... FOR UPDATE SKIP LOCKED`, além de controle de versão em `UPDATE ... WHERE version = :expected_version`.

**Limites de segurança reais:**

- Conecta **somente** se o PostgreSQL responder `current_database() = 'modo_hyperframes_staging'`. A migração também recusa outros nomes de banco antes de criar qualquer estrutura. Não executar esta migração no banco de produção do MODO.
- Exige `MODO_HYPERFRAMES_RECOVERY_MODE=isolated-staging`, `MODO_HYPERFRAMES_DB_MODE=isolated-staging` e recusa `NODE_ENV=production`.
- A chave `UNIQUE (organization_id,idempotency_key)` impede duplicação com requisições concorrentes; diferença no hash/projeto resulta em erro de idempotência.
- Claims simultâneos da mesma tarefa são serializados; somente o worker que possui o `fence` ativo pode completar/falhar. Tentativas passam pelo limite de três do protocolo.
- Os registros preservam apenas metadados, incluindo SHA-256 e chave de objeto opaca. **Não** contêm HTML, MP4, tokens ou URLs públicas.
- Não cria conexões a partir do servidor `modo-api` atual, não registra rotas, não altera o Publisher V2 e não efetua deploy ou migração em serviços conectados à produção.
- O horário do servidor PostgreSQL é usado para o lease. Um adaptador reiniciado recupera os estados de tarefas salvos, mas a recuperação de bytes MP4 **ainda depende de object storage privado persistente** e um worker isolado que continue/verifique a execução.

**Teste automatizado**: workflow [HyperFrames isolated Postgres recovery CI](../../.github/workflows/hyperframes-staging-pg-ci.yml), com banco PostgreSQL 16 descartável chamado `modo_hyperframes_staging`, migration e testes de corrida/duplicação/isolamento, sem qualquer segredo ou mídia real.

**Gates ainda pendentes antes de uso real**: provisionar banco e usuário dedicados de staging, object storage privado e criptografado, autenticação e auditoria dos workers, limitar CPU/memória/execuções, demonstrar recuperação após término abrupto do worker e revisar dependências vulneráveis. Nunca usar a credencial/banco PostgreSQL de clientes existentes.
