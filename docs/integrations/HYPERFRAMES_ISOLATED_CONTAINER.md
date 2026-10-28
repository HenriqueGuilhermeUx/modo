# MODO HyperFrames — contêiner isolado de homologação

**Estado:** PR #164, DRAFT. Este documento e os arquivos de infraestrutura não criam infraestrutura no Render, não fazem deploy, não mesclam a PR e não mexem em produção. A composição publicada em `trymodo.com.br` continua sendo somente HTML.

## Pacote entregue

- `infra/hyperframes-staging/worker.Dockerfile`: imagem separada com Node 22, HyperFrames **0.8.207** pinado, FFmpeg/FFprobe e Chromium. Processo sempre como UID/GID **10001**, sem root e sem segredos na imagem. O contexto de build tem `worker.Dockerfile.dockerignore` próprio, sem modificar o build principal do MODO.
- `infra/hyperframes-staging/compose.isolated.yaml`: dois serviços sem TCP, sem portas publicadas e sem acesso à Internet em runtime (`network_mode: none`): PostgreSQL 16 exclusivamente `modo_hyperframes_staging` e worker `one-shot`, que abre conexão por socket Unix privado `/var/run/postgresql` em volume compartilhado.
- O worker recebe filesystem somente leitura, capacidades Linux removidas, `no-new-privileges`, até **2 vCPU**, **2 GiB** de RAM, **128 PIDs** e diretórios temporários em `tmpfs`. A base tem volume local persistente, sem origem compartilhada com clientes. Nenhum serviço sobe por padrão: são perfis `local-db` e `manual`.
- `infra/hyperframes-staging/004_worker_role.sql`: papel PostgreSQL `hf_staging_worker`, criado sem LOGIN, sem privilégios de migração, sem TRUNCATE nem administração. O operador precisa ativar LOGIN e definir uma senha independente em ambiente privado.
- `apps/api/src/scripts/hyperframes-staging-one-shot.ts`: aceita DB por conexão remota TLS verificada ou socket local allowlisted, nunca os dois. No modo socket, a senha só é lida de `/run/hyperframes/db-password`, arquivo regular privado, sem seguir symlink, dono do próprio UID do worker e sem permissões para grupo/outros.
- `.github/workflows/hyperframes-container-isolation.yml`: compila a imagem e executa verificação de UID, capacidades e isolamento de rede; tenta também renderizar MP4 sintético em `--network none`, com recursos limitados e FFprobe.
- `.github/workflows/hyperframes-compose-socket-ci.yml`: sobe PostgreSQL descartável, aplica migrações de staging, provisiona senha sintética, conecta por socket a partir do worker sem rede externa, verifica leitura autorizada, negação de DDL e faz `docker compose down -v`. Não usa dados reais.

## Preparação operacional (apenas homologação local dedicada)

**Atenção:** quem executar precisa ter Docker Engine + Compose no host de homologação (não no site de produção). Não executar este stack dentro do servidor de clientes, e não apontar para banco existente.

1. Trabalhe em checkout exclusivo da branch `feat/hyperframes-pilot-20261025`.
2. Crie `infra/hyperframes-staging/private/`, fora do versionamento (o Dockerfile ignora esse diretório). Gere `admin-password`, `db-password` e, após criar uma tarefa sintética com o scheduler autorizado, `order.json`. Restrinja o diretório a modo 0700; `admin-password` deve ser legível ao usuário do PostgreSQL no contêiner (UID 999 para a imagem selecionada), `db-password` e `order.json` devem pertencer ao UID **10001**, com modo **0600**. Os caminhos exatos e modos são checados pelo worker.
3. Em um arquivo de variáveis **não versionado**, defina `HF_STAGE_WORKER_ID` e duas chaves base64 aleatórias **diferentes**, de 32 bytes cada: `HF_STAGE_SIGNING_KEY_B64` e `HF_STAGE_CONTENT_KEY_B64`. Não reaproveitar segredos da Nexa, do MODO ou de outros serviços. Rotacionar fora do Git e nunca imprimir em logs ou sessões compartilhadas.
4. Inicie **somente o banco privado**:
   `docker compose -f infra/hyperframes-staging/compose.isolated.yaml --profile local-db up -d pg-staging`.
   As migrações 001 a 004 só rodam em uma base local recém-criada. O nome `modo_hyperframes_staging` é verificado por cada migração.
5. Ative o login do papel `hf_staging_worker` e defina, com `psql` privado, a mesma senha de `private/db-password`. Use `\\password hf_staging_worker` e `ALTER ROLE hf_staging_worker LOGIN` de uma sessão administrativa; não cole senhas em comandos que apareçam no histórico de shell.
6. Só com uma ordem **assinada e validada para o mesmo tenant, worker e hash** e o DB privado pronto, execute uma tarefa: `docker compose -f infra/hyperframes-staging/compose.isolated.yaml --profile local-db --profile manual run --rm worker`.
7. Confira apenas resultado sanitizado (`completed`, `unclaimed`, `failed`), informações de recovery e estado do job. O MP4 criptografado não deve ser publicado, enviado a URL nem exposto a clientes.
8. Para desligar, `docker compose -f infra/hyperframes-staging/compose.isolated.yaml --profile local-db --profile manual down`. **Não usar `-v`** quando quiser preservar os jobs de staging; `down -v` apaga os volumes locais — é usado somente nos testes descartáveis do CI.

## Limites e decisões que ainda impedem produção

Este contêiner prova um isolamento técnico de homologação; **não é uma implantação comercial pronta**. O papel PostgreSQL pode ler linhas de vários tenants do staging: faltam RLS e uma credencial por escopo ou proxy de autenticação antes de qualquer dado de cliente. O HMAC de ordem é defesa adicional, não substitui autenticação de serviço do scheduler, rotação/revogação de chaves e auditoria. A senha e chaves entregues via variáveis de ambiente ao worker podem aparecer em inspeções privilegiadas do runtime; é necessário secret manager ou credenciais efêmeras para um serviço operacional.

O Compose usa `network_mode:none` para impedir conexões externas, mas não limita comunicação com *processos que recebam explicitamente acesso ao mesmo volume de socket*. O host que opera Docker continua parte da zona de confiança. Não executar projetos de clientes antes de testar a fronteira de autenticidade do scheduler, isolamento entre tenants, limites do Chromium e ciclo de vida/limpeza de snapshots e MP4.

**Release gate:** imagem + Compose + PostgreSQL + egress + MP4 sintético devem passar no GitHub; depois auditar dependências e assinar operacionalmente a configuração. Não fazer merge nem deploy do motor MP4 da PR #164 antes disso.
