# MODO HyperFrames — autorização Ed25519 antes do render (laboratório)

**PR #164 DRAFT; CI sintético somente; sem merge, deploy ou dados reais de clientes.**

## Cadeia comprovável desta rodada

1. O signer MODO existente gera o storyboard fictício (31+64+55 frames) e o pedido assinado Ed25519. A chave privada é gerada na memória do runner e não é gravada em disco.
2. **ANTES de iniciar o Docker/Chrome**, o novo `static-renderer-preflight-synthetic.mjs` verifica o pedido com a chave pública, cria o `render_jobs` no PostgreSQL descartável `modo_hyperframes_staging`, reivindica um lease e valida um despacho Ed25519 v2 via `consume_synthetic_lease`, com nonce global, versão, fence e clock do banco.
3. O processo confiável emite um **segundo** envelope Ed25519 `modo-static-render-admission-synthetic-v3`, com tenant, projeto, job UUID, worker, lease fence, tentativa, versão, hash do pedido original (`rendererOrderSha256`), digest do despacho (`leaseOrderSha256`), nonce e validade até o vencimento do lease (máximo de 60 s). Somente `admission.json` e a **chave pública** entram no container. `preflight-meta.json` fica exclusivamente no runner.
4. O renderer independente valida o pedido de storyboard e **depois a autorização pública, antes de lançar Chrome, criar HTML ou iniciar FFmpeg**. Exportações sintéticas opt-in exigem `MODO_HF_STATIC_ADMISSION_MODE=synthetic-ci-only`; sem isso, falham fechadas. O modo legado sem exportação permanece inalterado.
5. O workflow rejeita admissões alteradas e expiradas **dentro da própria imagem isolada**, sem gerar arquivo. O caso válido produz MP4 H.264 1080×1920 de 150 quadros em rede Docker interna.
6. O verifier confiável posterior usa o **mesmo UUID/lease reivindicado previamente**, confere autorização assinada, envelope original, registro persistente da emissão no PostgreSQL, hash dos bytes do MP4 e FFprobe. Assina recibo independente (chave diferente, em memória) com a identidade do job/lease e recusa adulterações/revogação e perda do fence. Arquivos sintéticos são eliminados ao final do workflow.

## Isolamento e limites

- Nenhum segredo, credencial PostgreSQL, chave de assinatura privada ou backend MODO é montado no container. A imagem inclui exclusivamente um verificador CommonJS de **chave pública** adicional.
- A tabela de despacho permanece separada e o papel restrito continua sem permissão de modificar a fila. O Chrome continua com `--no-sandbox` internamente e **não deve renderizar HTML ou ativos de clientes**.
- **A autorização no navegador é uma atestação de curta duração pelo scheduler, não uma consulta online ao estado do lease.** Não impede, por si, reutilização de um certificado válido em múltiplos containers; esse risco requer dispatch de uso único autenticado e fencing no commit final.
- O recibo pós-render ainda é **uma verificação contra um snapshot do PostgreSQL**, não uma transação que confirme atomicamente a gravação de um objeto de mídia durável. Não marcar job como `succeeded` nem publicar artefato sem esse passo.
- Próximas lacunas: commit atômico/criptografado em storage com fence ativo, auditoria imutável, lifecycle de chaves, autenticação entre serviços, isolamento do browser e comparação visual com Remotion. O CLI HyperFrames antigo no Docker restrito segue com falha independente.

Nenhum novo endpoint HTTP, banco comercial, Publisher V2 ou fluxo de produção foi criado.
