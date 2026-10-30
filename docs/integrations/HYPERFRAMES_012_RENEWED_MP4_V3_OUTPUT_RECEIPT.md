# HyperFrames 012 — recibo de saída MP4 v3 após renovação (prova, NÃO finalização)

**Âmbito:** PR #164 DRAFT; banco exclusivo `modo_hyperframes_staging` descartável; cenas e hashes sintéticos; nenhuma publicação, merge, cliente, Remotion ou deploy.

## O que foi construído

- `static-lease-mp4-receipt-v3.mjs`: assinatura Ed25519 independente para um **recibo de saída** com versão 3, contendo job, tenant sintético, projeto, worker, fence, versão/época atual, digests do despacho e admissão do Chrome, hash da **continuação v3** e digest/bytes/codec/resolução/fps/quadros do MP4 medidos pelo host confiável. Uma prova de continuação com versão obsoleta, chave revogada, assinatura adulterada, hash do MP4 divergente ou ordem do Chrome diferente é rejeitada.
- A migration **011** passou a incluir também o `rendererOrderSha256` no snapshot transacional; o recibo exige que seja exatamente o mesmo hash do lançamento de Chrome original, evitando trocar uma saída de outro storyboard.
- A migration **012_synthetic_mp4_output_receipts_v3.sql** cria tabela restrita de **metadados assinados**, sem bytes de vídeo. O commit usa `SECURITY DEFINER` de papel **NOLOGIN**; somente o dispatcher do host pode executar, sem `INSERT` direto. Ele valida **sob lock da linha de job** a versão corrente, fence, duração remanescente, despacho/admissão, contagem e última época, digest/bytes e ausência de recibos v2 e finalizações anteriores. Aceita somente um atestado de saída por job/fence. Um gatilho impede acrescentar outras épocas depois de gravar o atestado v3, inclusive concorrendo com o commit.
- `static-synthetic-mp4-pg-receipt-ledger-v3.mjs` recupera o snapshot PostgreSQL sob lock no **mesmo BEGIN/COMMIT** do registro, valida as duas assinaturas Ed25519 + os campos medidos e só então registra o recibo. O processo Chrome não recebe chave privada nem credenciais PostgreSQL.

## Testes (PostgreSQL 16 isolado)

A suíte de integração cobre ausência de renovação, primeira e segunda época, prova obsoleta, assinatura adulterada, troca do hash de MP4, ordem do Chrome errada, chave revogada, **12 gravações paralelas** com só uma vencedora, impossibilidade de renovar após atestação v3, e barreira v2 ainda ativa. O CI também compila/simula o pipeline anterior de MP4 real, *sem renovar esse render*, para detectar regressões.

**Limitação que não pode ser omitida:** os novos testes v3 utilizam metadados sintéticos de MP4 (hash/bytes) para provar a validade criptográfica e a atomicidade da tabela. **Ainda não constituem um E2E de MP4 real renderizado sob lease renovado.** O E2E existente com vídeo real continua no caminho **não renovado**, com as mesmas verificações criptográficas e AES-GCM anteriores. A função de banco confia que o processo host restrito já verificou as assinaturas Ed25519 e os bytes; o PostgreSQL **não** verifica assinaturas Ed25519 nativamente.

## Bloqueio de liberação continua

A migration 010 continua impedindo `synthetic_receipt_attestations` v2 após renovação; a finalização de `render_artifacts` das migrations 008/009 segue exigindo o fluxo anterior e **não** aceita o novo ledger v3. Portanto `storageAllowed:false`, `publicationAllowed:false`. Para permitir um render longo e recuperável ainda faltam uma migration posterior da finalização AES-GCM que valide o novo atestado v3 no commit, o encadeamento de recibos e as provas E2E de vídeo real após renovação, expiração, replay e restart. Nenhuma proteção antiga foi enfraquecida.
