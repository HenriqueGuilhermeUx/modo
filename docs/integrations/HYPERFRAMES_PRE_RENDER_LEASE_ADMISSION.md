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

## Isolamento e limites

- Nenhum segredo, credencial PostgreSQL, chave de assinatura privada ou backend MODO é montado no container. A imagem inclui exclusivamente um verificador CommonJS de **chave pública** adicional.
- A tabela de despacho permanece separada e o papel restrito continua sem permissão de modificar a fila. O Chrome continua com `--no-sandbox` internamente e **não deve renderizar HTML ou ativos de clientes**.
- **A autorização no navegador é uma atestação de curta duração pelo scheduler, não uma consulta online ao estado do lease.** Não impede, por si, reutilização de um certificado válido em múltiplos containers; esse risco requer dispatch de uso único autenticado e fencing no commit final.
- O recibo pós-render pode ser registrado **atomicamente como evidência metadata-only** enquanto o lease estiver ativo, mas ainda não existe transação que confirme a gravação de um **objeto de mídia durável**. Não marcar job como `succeeded` nem publicar artefato sem esse passo.
- Próximas lacunas: commit atômico/criptografado em storage com fence ativo, auditoria imutável, lifecycle de chaves, autenticação entre serviços, isolamento do browser e comparação visual com Remotion. O CLI HyperFrames antigo no Docker restrito segue com falha independente.

Nenhum novo endpoint HTTP, banco comercial, Publisher V2 ou fluxo de produção foi criado.
