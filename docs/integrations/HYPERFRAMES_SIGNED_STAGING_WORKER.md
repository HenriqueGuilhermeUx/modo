# MODO — worker HyperFrames de staging com ordem assinada

**Estado:** código e testes na [PR #164](https://github.com/HenriqueGuilhermeUx/modo/pull/164), exclusivamente de homologação. Não existem endpoints públicos, deploy do MP4, worker contínuo, novos bancos Render, importação no MODO em produção ou movimentações de clientes.

## O que foi implementado

1. `hyperframes-staging-pg-work-order.ts` assina ordens de execução curtas com **HMAC-SHA256**. O envelope contém audiência e emissor de staging, organização, ID do job, worker autorizado, SHA-256 do conteúdo original, nonce UUID e janela máxima de cinco minutos. A verificação rejeita assinatura inválida, prazo vencido, mudanças de tenant/job/worker/hash, campos extras e chave menor que 32 bytes. A assinatura usa uma **chave diferente** da criptografia AES dos arquivos e snapshots.
2. `runSignedStagingWorkOrder` verifica a assinatura e a identidade local do worker, consulta novamente a linha do job no PostgreSQL e confere o digest imutável **antes** de recuperar o snapshot e adquirir o lease. A conclusão permanece protegida por token de fencing e transação no banco; repetir a mesma ordem após conclusão não inicia outro render.
3. `apps/api/src/scripts/hyperframes-staging-one-shot.ts` é um **processo único, sem servidor HTTP**. Lê um arquivo de ordem de permissão 0600, exige `NODE_ENV` não produtivo, flags de staging, binários absolutos, banco explicitamente nomeado `modo_hyperframes_staging`, chave HMAC própria e chave AES separada. Descarrega as chaves da memória ao terminar e imprime só resultados sanitizados. Para banco remoto exige `sslmode=verify-full` e ainda verifica o nome do banco pela conexão.
4. O worker **não** cadastra rota, não roda como daemon, não acessa Publisher V2, não executa ações de mídia paga ou publicação e não carrega variáveis de produção no subprocesso do HyperFrames. Continua usando FFprobe para validar os vídeos e PostgreSQL AES-GCM para armazená-los.
5. `hyperframes-staging-real-pg-e2e.ts` e `.github/workflows/hyperframes-real-pg-e2e.yml` permitem um ensaio com PostgreSQL 16 descartável, chaves geradas em memória, ordem assinada, subprocesso one-shot, **CLI HyperFrames 0.8.207 de verdade** e FFmpeg/FFprobe. Confere criptografia, SHA-256, escopo da organização, tentativa duplicada e limpeza do teste. Apenas um projeto sintético estático de 15 segundos; nenhuma mídia de cliente.

## Requisitos para execução futura (não configurar em produção)

- Quatro flags `MODO_HYPERFRAMES_{WORKER,RECOVERY,DB,STORAGE}_MODE=isolated-staging`, mais `MODO_HYPERFRAMES_ONE_SHOT_MODE=isolated-staging`.
- Banco PostgreSQL **dedicado de staging**, com migrações 001/002/003 e credenciais próprias, jamais as credenciais do MODO de produção.
- `MODO_HYPERFRAMES_STAGE_DB_URL`: conexão ao banco de staging. Endereços remotos exigem certificado TLS com validação do hostname.
- `MODO_HYPERFRAMES_SIGNING_KEY_B64` e `MODO_HYPERFRAMES_CONTENT_KEY_B64`: duas chaves distintas, aleatórias e independentes, cada uma com 32 bytes codificados em base64. Gerenciar em secret manager de staging; nunca gravá-las em GitHub, logs, Dockerfile ou projeto de cliente.
- `MODO_HYPERFRAMES_LOCAL_WORKER_ID`: identidade estável do worker (deve corresponder exatamente à ordem assinada).
- `MODO_HYPERFRAMES_BIN` e `MODO_HYPERFRAMES_FFPROBE_BIN`: caminhos absolutos de binários fixados e verificados previamente.
- Arquivo de ordem assinado em diretório privado, com permissão 0600; o script recebe **apenas o caminho absoluto**. Não passe assinatura, senha nem chaves pela linha de comando.
- Run de staging com usuário sem privilégios, sistema de arquivos somente leitura exceto `/tmp`, limites de memória/CPU/processos, rede restrita ao banco exclusivo e sem acesso externo à Internet. A segregação de rede e recursos **ainda depende da configuração do futuro contêiner** e não é garantida somente pelo código Node.

## Limitações e próximas verificações

O HMAC é autorização de handoff limitada e **não representa, isoladamente, autenticação completa do serviço**. A identidade do scheduler precisa ser verificada antes de assinar; o worker precisa de permissões PostgreSQL mínimas e isolamento de rede. Um envelope válido pode ser reapresentado durante sua janela de validade; os limites de tentativas, a idempotência e o fencing no banco impedem reprocessar um job concluído, mas não substituem proteção explícita contra replay em um serviço público. **Nenhum endpoint público deve aceitar essas ordens.**

A janela HMAC é verificada ao começar a tarefa, não durante todo o render. A posse durante processamento é controlada pelo lease renovado no PostgreSQL; worker que perdeu lease não consegue finalizar e armazenar o vídeo.

O runner do GitHub executa em máquina descartável, mas **não comprova restrição real de egress da futura implantação**. Após testar com vídeo sintético, as próximas etapas são: contêiner isolado, provisionamento de staging com rede/credenciais próprias, serviço de identidade e chaves com rotação, auditoria sanitizada e liberação gradual com rollback.

A prévia HTML de produção e o Remotion atual não são afetados por esta PR.
