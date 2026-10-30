# MODO HyperFrames — fila privada efêmera em staging

Módulo: `apps/api/src/services/hyperframes-staging-preview-queue.ts`.
Status: **piloto de engenharia**, sem deployment, sem endpoint HTTP, sem Redis, sem banco de dados, sem storage em nuvem e sem integração ao Publisher V2.

## O que já funciona na branch

- Fila em memória, com execução serial de um render por processo, limite de jobs e isolamento por organização.
- Identidade da organização exigida em **todas** as operações: criar job, consultar status, ler bytes e excluir. O identificador deve ser resolvido por um serviço confiável após autenticação, nunca recebido diretamente de um payload do navegador.
- Só executa com as duas flags `MODO_HYPERFRAMES_WORKER_MODE=isolated-staging` e `MODO_HYPERFRAMES_QUEUE_MODE=isolated-staging`, e recusa `NODE_ENV=production`.
- Copia o projeto no recebimento, restringe consumo total de RAM e conserva temporariamente MP4 em memória **somente** após validar organização, ID do projeto, tamanho, hash SHA-256 e sinalizadores `previewOnly/published`.
- Devolve apenas metadados sanitizados na consulta; download de bytes é uma cópia defensiva somente após nova verificação do escopo da organização e do hash.
- Erros externos são convertidos em `STAGING_RENDER_FAILED`, sem vazar stdout/stderr, segredos ou tokens.
- TTL padrão de dez minutos para resultados concluídos, aplicado quando a fila é acessada; operações de remoção exigem tenant e não removem jobs em andamento.
- Testes com dados sintéticos para enfileiramento serial, tentativa cross-tenant, falhas de hash, expiração, quotas e mensagens de erro.

## Prova opcional de criptografia AES-256-GCM (26/10/2026)

O módulo separado `hyperframes-staging-encrypted-vault.ts` usa uma chave de **32 bytes**, cópia interna da chave, IV aleatório de 96 bits por objeto, AES-256-GCM com metadados autenticados (organização, projeto, job, tamanho, hash e validade), validação SHA-256, TTL, limite de memória e limpeza de ciphertext/chave no encerramento. As operações de leitura, metadados e exclusão exigem identidade da organização a cada acesso; não há URL pública ou signed URL.

A fila aceita um parâmetro **opcional** `encryptedVault`. Com ele configurado, guarda **apenas metadados** no job, escreve o MP4 criptografado no cofre isolado e consulta o cofre novamente em cada download. Os testes cobrem o fluxo entre fila e cofre, incluindo recusa cross-tenant e remoção.

Ambas as flags de render/fila permanecem necessárias. A criptografia exige **também** `MODO_HYPERFRAMES_STORAGE_MODE=isolated-staging`. Nunca ligue essas variáveis no Render de produção; o código proíbe `NODE_ENV=production`.

**Fail-closed adicional:** se `MODO_HYPERFRAMES_STORAGE_MODE=isolated-staging` estiver ativado, a fila rejeita novas tarefas quando o cofre criptografado não foi injetado; não aceita downgrade silencioso para RAM sem criptografia. Se um cofre tiver sido injetado, a mesma flag passa a ser obrigatória antes do enfileiramento. A configuração da fila também recusa `maxJobs` fora de 1–20, `maxStoredBytes` fora de 4.000–100.000.000 bytes e TTL fora de 1–900 segundos.

**Limitação essencial:** criptografia em memória não cria durabilidade, não substitui KMS, não distribui filas entre instâncias, não impede acesso por administrador/root ao processo em execução e não equivale a criptografia de um bucket cloud em repouso. A chave não pode ser reutilizada da base Nexa, de tokens Privy ou do banco de dados. Não persistir em GitHub nem em logs.

## Importante: não é armazenamento privado durável

**RAM isolada não é um serviço persistente.** As entradas e os MP4 desaparecem com reinícios do processo, não há recuperação após falha, coordenação multiworker, criptografia em repouso, object storage ou trilha persistente. O limite de jobs considera jobs retidos até exclusão ou expiração. Este módulo NÃO deve ser importado pelo servidor Fastify existente ou por qualquer rota voltada a clientes.

## Gates para próxima etapa real

1. Provisionar ambiente de staging privado, sem permissão de publicação, com container isolado e egress restrito. Não alterar os serviços Render/Netlify atuais.
2. Implementar **fila durável** com escopo por organização, chave de idempotência, lease e retries limitados; conferir limites de custo e renderização.
3. Implementar object storage **privado e criptografado**, com nomes de objetos gerados no servidor, política de retenção, integridade SHA-256, auditoria e autorização a cada acesso. Bloquear URLs públicas e bucket listing.
4. Validar autenticação real, defesa cross-tenant e exclusão em staging com organizações sintéticas separadas; configurar observabilidade que não registra HTML nem segredos.
5. Obter correção/revisão das vulnerabilidades de dependências já identificadas na PR #164; manter Remotion como motor oficial.
6. Só após os gates: integrar preview ao MODO, sem criar qualquer caminho automático até postagem/publicação.

## Testes

`npx vitest run apps/api/src/services/hyperframes-staging-preview-queue.test.ts` quando executado no root do monorepo com configuração adequada, ou `npm test --workspace=@modo/api -- hyperframes-staging-preview-queue.test.ts`.

Não realizar merge, deploy, render com mídia real ou movimentação de créditos nesta etapa.
