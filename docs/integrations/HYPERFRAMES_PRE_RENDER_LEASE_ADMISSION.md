# MODO HyperFrames — autorização Ed25519 antes do render (laboratório)

**PR #164 DRAFT; CI sintético somente; sem merge, deploy ou dados reais de clientes.**

## Cadeia comprovável desta rodada

1. O signer MODO existente gera o storyboard fictício (31+64+55 frames) e o pedido assinado Ed25519. A chave privada é gerada na memória do runner e não é gravada em disco.
2. **ANTES de iniciar o Docker/Chrome**, o novo `static-renderer-preflight-synthetic.mjs` verifica o pedido com a chave pública, cria o `render_jobs` no PostgreSQL descartável `modo_hyperframes_staging`, reivindica um lease e valida um despacho Ed25519 v2 via `consume_synthetic_lease`, com nonce global, versão, fence e clock do banco.
3. O processo confiável emite um **segundo** envelope Ed25519 `modo-static-render-admission-synthetic-v3`, com tenant, projeto, job UUID, worker, lease fence, tentativa, versão, hash do pedido original (`rendererOrderSha256`), digest do despacho (`leaseOrderSha256`), nonce e validade até o vencimento do lease (máximo de 60 s). Somente `admission.json` e a **chave pública** entram no container. `preflight-meta.json` fica exclusivamente no runner.
4. O renderer independente valida o pedido de storyboard e **depois a autorização pública, antes de lançar Chrome, criar HTML ou iniciar FFmpeg**. Exportações sintéticas opt-in exigem `MODO_HF_STATIC_ADMISSION_MODE=synthetic-ci-only`; sem isso, falham fechadas. O modo legado sem exportação permanece inalterado.
5. O workflow rejeita admissões alteradas e expiradas **dentro da própria imagem isolada**, sem gerar arquivo. O caso válido produz MP4 H.264 1080×1920 de 150 quadros em rede Docker interna.
6. O verifier confiável posterior usa o **mesmo UUID/lease reivindicado previamente**, confere autorização assinada, envelope original, registro persistente da emissão no PostgreSQL, hash dos bytes do MP4 e FFprobe. Assina recibo independente (chave diferente, em memória) com a identidade do job/lease e recusa adulterações/revogação e perda do fence. Arquivos sintéticos são eliminados ao final do workflow.

## Registro transacional da evidência (007, sem publicação)

A migração adicional `007_synthetic_receipt_attestations.sql` cria tabela descartável de metadados assinados com `PRIMARY KEY(receipt_sha256)`, `UNIQUE(job_id,lease_fence)` e chaves estrangeiras contra a fila e o ledger de despacho. A função `commit_synthetic_mp4_receipt`, definida com `SECURITY DEFINER`, busca o lease ainda vigente com `FOR SHARE`, confere tenant/projeto/job/worker/versão/fence e digest do despacho, consulta o relógio do banco **após adquirir o lock** e insere uma única atestação. O dispatcher restrito só recebe `EXECUTE`; não recebe acesso a tabelas ou poderes de publicação. O módulo Node `static-synthetic-mp4-pg-receipt-ledger.mjs` verifica o recibo Ed25519 e a medição independente do MP4 antes da chamada SQL.

No E2E há casos positivos, duplicidade, adulteração de hash, revogação de chave, tentativa de UPDATE sem permissão e recusa após perda de lease. **Importante:** a transação confirma apenas a autenticidade/atestado do recibo, não a permanência do arquivo MP4. O job continua `running` durante o teste e é explicitamente invalidado depois; `succeeded` exige armazenamento de mídia criptografada e commit com fencing próprio, fora deste escopo.

## Armazenamento criptografado e commit final do laboratório (008)

A migração `008_synthetic_encrypted_finalization.sql` não muda a implementação da classe existente `HyperframesStagingPgArtifacts`. Ela acrescenta um gatilho exclusivamente para o tenant de laboratório `synthetic-tenant-mp4-receipt` sobre a tabela `render_artifacts` do banco descartável. O gatilho é executado **na mesma transação** que a classe já utiliza para inserir o MP4 cifrado com AES-256-GCM e atualizar o job para `succeeded`.

Para esse tenant, o gatilho exige recibo previamente confirmado na tabela 007, despacho e fence ativos, identidade tenant/job/worker/versão/tentativa/digest compatível, status `running`, `previewOnly=true`, `published=false`, prazo do lease válido pelo relógio do PostgreSQL, e hash/tamanho do vídeo iguais aos do recibo. Na mesma transação insere em `synthetic_encrypted_finalizations` o vínculo `receipt_sha256 → job_id → lease_fence → storage_key → output_sha256`. Se faltar recibo ou houver divergência, a transação inteira sofre rollback: nenhum ciphertext e nenhuma alteração terminal. A função do gatilho tem `SECURITY DEFINER` com proprietário NOLOGIN de permissões limitadas.

O teste E2E usa os **bytes reais do MP4**; prova falha/rollback com MP4 adulterado (mesmo `ftyp`), não existência de ciphertext após falha, confirmação cifrada sob fence correto, mudança atômica para `succeeded` sem publicar, integridade AES-GCM, leitura após reiniciar o adaptador e recusa de chave errada, outro tenant, fence velho e confirmação duplicada. A chave de 32 bytes é criada só em memória no runner descartável e invalidada ao final. A rotina já prevê retenção curta (5 minutos na fixture) e pode executar `forget`/expiração.

**Escopo estrito:** apenas prova sintética em PostgreSQL efêmero. O gatilho não autentica sozinho serviços externos, não resolve replay da autorização do navegador durante o prazo, não constitui objeto de mídia/CDN comercial e não certifica equivalência visual com Remotion. O arquivo é descartado após o workflow, sem URL pública.

## Controle de uso único do launcher confiável (009)

A migração manual `009_synthetic_browser_launch_once.sql`, aplicável somente ao PostgreSQL descartável `modo_hyperframes_staging`, adiciona o ledger `synthetic_browser_launches` com **nonce global, admission_sha256 globalmente único e UNIQUE(job_id,lease_fence)**. A função restrita `consume_synthetic_browser_launch`, executável apenas pelo papel dispatcher NOLOGIN por meio de processo confiável, confere *após bloquear a linha da tarefa* o estado `running`, tenant exclusivamente sintético, worker, versão, tentativa, digest, fencing, prazo do lease, despacho Ed25519 previamente consumido e relógio do PostgreSQL. Concorrência converge para exatamente um vencedor. Duplicatas são recusadas sem apagar nem reutilizar o nonce.

O novo `static-browser-launch-gate.mjs` revalida a assinatura Ed25519, o digest exato do pedido original e os metadados esperados **independentemente fornecidos pelo scheduler**, antes de executar a função SQL. A prova `static-browser-launch-claim-ci.mjs` é chamada **entre a autorização do scheduler e o comando válido `docker run`**, testa 20 lançamentos simultâneos, replay, assinatura inválida, digest divergente e poderes do papel restrito. Somente se uma disputa tiver exatamente um vencedor, grava `launch-confirmation.json` na área temporária **exclusiva do runner**. O comando de render válido exige esse arquivo e o verificador pós-render confere a linha persistida, associada ao recibo e ao mesmo lease. O arquivo de confirmação NÃO é montado no Chrome.

Um segundo gatilho `BEFORE INSERT` na tabela de MP4s exige para o único tenant de laboratório um lançamento consumido. Atua na mesma transação que a verificação de recibo 008, a escrita AES-256-GCM e a mudança terminal da tarefa. Sem lançamento, a transação é recusada e nenhum artefato é persistido.

**Limite decisivo:** isto fornece um **controle de execução única pelo lançador confiável**, não é uma garantia de que um invasor com os mesmos mounts assinados não possa executar manualmente o container duas vezes durante a validade do certificado. Resolver essa ameaça de forma completa exige autenticação entre scheduler e worker, capacidade efêmera por instância / broker de execução e proibir a invocação direta do Chrome fora do serviço confiável. A fila e o armazenamento já impedem dupla confirmação final sob a mesma lease; renderizações duplicadas ilegítimas podem, contudo, consumir CPU antes desse commit.

## Broker interativo de execução vinculada à instância (experimento CI)

Depois do controle PostgreSQL de uso único (009), o laboratório adiciona um **broker externo ao Chrome** sobre socket Unix. O broker confiável, iniciado no runner antes da imagem derivada, mantém uma chave privada **Ed25519 exclusivamente na memória do processo**, grava somente sua chave pública e a incorpora à imagem do renderer em um layer derivado de CI. A imagem original continua funcionando no smoke sintético sem exportação.

Para exportar MP4, \`MODO_HF_STATIC_BROKER_MODE=synthetic-ci-only\` passa a ser obrigatório além da autorização Ed25519 original. Antes de abrir Chrome, o cliente rootless gera um desafio aleatório de 256 bits e o envia por socket Unix local ao broker. O broker confere o digest da autorização, o hash exato do pedido, UUID/fencing, e consome **uma única** autorização atômica no PostgreSQL através do papel NOLOGIN. Apenas o vencedor recebe assinatura vinculada ao desafio, pedido, tarefa e lease, válida por até 8 segundos. O cliente confere essa assinatura usando a chave pública **fixada na imagem**, não uma chave pública arbitrária fornecida por bind mount. A ausência do socket ou da resposta assinada é uma recusa anterior ao render.

A nova suíte testa assinatura de resposta, desafio copiado para outro container, identidade e digest diferentes, chave substituída, expiração e alteração de payload. O E2E verifica um container iniciado **somente com arquivos assinados, mas sem o socket**: deve falhar sem produzir MP4; depois monta o socket exclusivamente no container válido, obtém um grant e persiste a confirmação de lançamento apenas no runner. O backend/DB, a chave privada do broker e qualquer senha jamais entram na imagem.

**Limites:** uma pessoa com privilégios para modificar arbitrariamente a imagem do Docker ou controlar o broker/host consegue contornar qualquer proteção dentro da própria imagem; esse cenário continua fora da garantia. O broker é de CI e usa socket montado, não mTLS ou autenticação de serviço de produção. Um atacante com acesso ao mesmo socket ativo pode competir pelo lançamento legítimo, causando indisponibilidade; contenção da montagem, UID/ACL e identidade de runtime exigem revisão antes de produção. O Chrome interno ainda usa modo sem sandbox e não aceita HTML de clientes.

## Isolamento e limites

- Nenhum segredo, credencial PostgreSQL, chave de assinatura privada ou backend MODO é montado no container. A imagem inclui exclusivamente um verificador CommonJS de **chave pública** adicional.
- A tabela de despacho permanece separada e o papel restrito continua sem permissão de modificar a fila. O Chrome continua com `--no-sandbox` internamente e **não deve renderizar HTML ou ativos de clientes**.
- **A autorização no navegador é uma atestação de curta duração pelo scheduler, não uma consulta online ao estado do lease.** Não impede, por si, reutilização de um certificado válido em múltiplos containers; esse risco requer dispatch de uso único autenticado e fencing no commit final.
- O recibo pós-render pode ser registrado **atomicamente como evidência metadata-only** enquanto o lease estiver ativo, mas ainda não existe transação que confirme a gravação de um **objeto de mídia durável**. Não marcar job como `succeeded` nem publicar artefato sem esse passo.
- Próximas lacunas: commit atômico/criptografado em storage com fence ativo, auditoria imutável, lifecycle de chaves, autenticação entre serviços, isolamento do browser e comparação visual com Remotion. O CLI HyperFrames antigo no Docker restrito segue com falha independente.

Nenhum novo endpoint HTTP, banco comercial, Publisher V2 ou fluxo de produção foi criado.
