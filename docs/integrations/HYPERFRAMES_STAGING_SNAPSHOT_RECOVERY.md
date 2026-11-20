# MODO HyperFrames — recuperação de origem imutável (somente staging)

**Implementado em PR #164 DRAFT, 27/10/2026. Sem merge, sem deploy e sem uso de mídia real.**

## Problema resolvido

A fila persistente tinha o hash do pedido, mas não mantinha o **projeto e a marca originais**. Um processo reiniciado poderia encontrar a tarefa sem ter de onde recuperar o conteúdo. Buscar a versão atual do projeto no MODO seria inseguro: ela poderia ter sido editada depois da autorização da tarefa.

## Implementação

- Migração `infra/hyperframes-staging/003_encrypted_render_snapshots.sql`, que se recusa a executar fora do banco **separado** `modo_hyperframes_staging`.
- `HyperframesStagingPgSnapshots.enqueue` valida o projeto pelo contrato MODO e pela compatibilidade com o HyperFrames HTML estático, calcula SHA-256 do pedido, cria o job e armazena **o mesmo snapshot imutável AES-256-GCM na mesma transação**. Se o storage falhar, a criação do job também é revertida.
- O payload criptografado inclui `VideoProject` e `brandName`; não é gravado conteúdo em claro. Dados autenticados (AAD) vinculam organização, projeto, job, hash, tamanho e expiração. A chave de 32 bytes é obtida separadamente do banco e do repositório.
- Idempotência por organização e chave de requisição, inclusive em criações simultâneas. O mesmo identificador com outro projeto ou marca é recusado. Se a origem foi removida/expirou, o job antigo não pode ser silenciosamente reusado.
- `HyperframesStagingPgSnapshots.load` só recupera tarefas em fila ou execução e **apenas para a organização autenticada**; verifica chave, GCM, contrato do projeto e hash do pedido antes de entregar um novo objeto.
- `resumeStagingHyperframesPgJob` liga o carregamento ao executor anterior, com lease/fencing e escrita criptografada do MP4. Após a conclusão, novas tentativas de render não ocorrem.
- Limites: snapshot até 150 KB, armazenamento global até 5 MB, TTL de 1 hora (com limpeza em lotes). Não inclui arquivos de vídeo ou imagens de clientes, URLs externas, Publisher, tokens, cobrança ou serviço HTTP.
- Quatro flags `isolated-staging` são obrigatórias: `WORKER_MODE`, `RECOVERY_MODE`, `DB_MODE` e `STORAGE_MODE` (todas prefixadas com `MODO_HYPERFRAMES_`). `NODE_ENV=production` bloqueia a operação.

## Homologação

No GitHub Actions, o workflow de Postgres descartável aplica as migrações 001/002/003 e testa separadamente cada suíte para não interferir nas cotas globais:

- Criação atômica e concorrente, mesmo idempotencyKey e conflitos.
- Criptografia do snapshot, chave diferente, violação de integridade, isolamento por organização.
- Imutabilidade: edição posterior do objeto original não altera a origem do job.
- Reinicialização das instâncias de snapshot, fila e storage, seguido de render sintético e retomada.
- Expiração, bloqueio em produção e ausência de callbacks do Publisher.

**Ainda não é lançamento MP4**: exige ambiente de staging real com executáveis HyperFrames/ffprobe pinados, saída de rede isolada, controle de recursos, identidade autenticada do scheduler, observabilidade, ciclo de vida de chaves e homologação dos próprios binários reais. O Remotion e a prévia HTML pública do MODO permanecem independentes.

**Nota operacional:** PostgreSQL `BYTEA` foi escolhido somente para provar persistência isolada e barata em pequeno volume; revisar custo/backup/retention antes de escalar para clientes. Não criar tabelas no banco produtivo do MODO.
