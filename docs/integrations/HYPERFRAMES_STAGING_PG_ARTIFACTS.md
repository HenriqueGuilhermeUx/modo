# MODO HyperFrames — armazenamento MP4 persistente, criptografado e isolado

Status: **implementação técnica em PR #164 DRAFT**, sem deploy, sem banco de clientes, sem criação de serviço e sem media real. Data: 27/10/2026.

## O que foi implementado

O `HyperframesStagingPgArtifacts` em `apps/api/src/services/hyperframes-staging-pg-artifacts.ts` integra o protocolo durável de jobs com ciphertext MP4 dentro do **mesmo PostgreSQL exclusivo de staging**.

- Migração aditiva `infra/hyperframes-staging/002_encrypted_render_artifacts.sql`, protegida por verificação de `current_database() = 'modo_hyperframes_staging'`; constraint FK composta garante a associação job + organização.
- `finishWithVideo`: verifica **lease ativo e fencing token** no job, bloqueia linha, criptografa com AES-256-GCM e só então grava ciphertext e conclui o job **na mesma transação**, com controle otimista de versão. Não promove MP4 vindo de worker expirado.
- Uma chave aleatória de 32 bytes **separada do banco e do código** é fornecida pelo executor. A chave é copiada para uso do processo e zerada na chamada de encerramento. O esquema nunca guarda chave ou plaintext.
- IV aleatório, tag GCM e dados autenticados abrangendo job, organização, projeto, identificador do objeto, hash SHA-256, tamanho e validade. A leitura recusa alterações, chave errada, expiração, organização divergente e jobs não concluídos.
- Leitura entrega somente um Buffer ao serviço interno autorizado; **sem URL pública, rota HTTP, Publisher, upload de cliente ou publicação**.
- Cota configurável de MP4 criptografados (padrão 50 MB, máximo 100 MB), MP4 máximo de 25 MB, TTL padrão de 10 min e máximo de 15 min. Trava consultiva transacional impede dupla ocupação de espaço durante gravações concorrentes.
- `forget` exclui ciphertext e também apaga o ponteiro do resultado no job. `pruneExpired` remove até 100 registros por chamada, devendo ser agendado futuramente pelo worker.
- A verificação rápida do marcador `ftyp` não substitui a validação **obrigatória de codec, resolução, duração, fps e integridade via ffprobe** pelo renderizador isolado.

## Como homologar sem risco

O workflow `HyperFrames isolated Postgres recovery CI` sobe o PostgreSQL 16 descartável, aplica as migrações 001 e 002 e roda os dois arquivos de testes com organizações sintéticas. Ele valida persistência após reinstanciar o adaptador, conflito cross-tenant, stale fencing, GCM/tamper, quota concorrente, expiração, exclusão e bloqueio em produção.

Este módulo exige simultaneamente:
- `MODO_HYPERFRAMES_RECOVERY_MODE=isolated-staging`
- `MODO_HYPERFRAMES_DB_MODE=isolated-staging`
- `MODO_HYPERFRAMES_STORAGE_MODE=isolated-staging`
- `NODE_ENV` diferente de `production`

Nunca habilitar essas flags na API atual do Render. O banco operacional de clientes do MODO nunca deve receber estas migrações. A chave de criptografia nunca deve ser escrita no GitHub, banco, logs ou webhook.

## Entrega e bloqueios restantes

Este é um **storage durável de staging de baixo volume**, não S3, CDN, nem armazenamento de vídeos de produção. A viabilidade de usar PostgreSQL como storage definitivo deve ser avaliada por custo de disco, backups, retenção e pressão de I/O. Uma arquitetura escalável provavelmente migrará ciphertext para armazenamento privado de objetos e KMS.

Ainda faltam: provisionamento isolado de staging com credenciais não compartilhadas, execução real do HyperFrames com processo sandbox e ffprobe, orquestração/renovação de leases durante o render, recuperação após falha de processo, observabilidade sanitizada e revisão de dependências. **Não mesclar a PR #164 e não liberar MP4 para usuários até cumprir esses gates.**

A prévia de composição HTML lançada na PR #170 está **separada** e continua preservada.
