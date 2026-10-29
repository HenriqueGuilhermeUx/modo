# HyperFrames 014 — prova real de H.264 com renovação da autorização original

**Somente PR #164 DRAFT, PostgreSQL `modo_hyperframes_staging` descartável e dados sintéticos. Este arquivo documenta o teste, não uma autorização comercial.**

O novo workflow `hyperframes-renewed-v3-real-mp4-ci.yml` reproduz, num runner independente e sem rede externa no Chrome, o fluxo existente de *signing → scheduler preflight → browser one-shot broker → MP4 H.264 real*. Preserva o teste de resposta de broker, prevenção de replay do navegador, isolamento rootless e limpeza de MP4/chaves ao final.

**Diferencial:** depois de gerar e verificar realmente o MP4, o script `static-real-renewed-v3-mp4-e2e.mjs` renova **a mesma lease/fence/job** do lançamento Chrome, usando a função SQL 010 como dispatcher autorizado no host. Os passos posteriores executam a migration 011 para emitir a continuação Ed25519 v3 a partir de snapshot bloqueado do banco, assinam o recibo de saída v3 com SHA-256 e FFprobe reais e o registram uma única vez usando a migration 012. Finalmente, a migration 013 e o cofre existente AES-256-GCM inserem ciphertext, prova e transição para `succeeded` atomicamente. A leitura é repetida após reinicializar a instância do cofre.

**Validações de falha:** assinatura da entrada, lançamento sem replay, quadros 150/30fps, hash do MP4, falha da prova de saída adulterada, bloqueio de rota v2 após renovação, digest incompatível na finalização, fence antigo, registro duplicado, checksum/ciphertext e tenant incorreto. O vídeo não se torna publicado; `published:false`, sem API de download.

**Limite rigoroso:** mesmo após aprovação do E2E, o Chrome permanece com `--no-sandbox` somente dentro do Docker de CI sintético, isolado e sem entrada externa. O broker e as chaves nunca entram no processo browser. Não habilitar esse caminho para HTML, URLs, arquivos, vídeo ou outros dados de clientes; não abrir merge nem deploy. O limite de duas renovações e horizonte de 120 segundos não mudam.

**Critério de aceite:** execução `SUCCESS` do workflow citado no SHA exato, além do PG CI 15/15, E2E v2 preservado, e ausência de novos erros não previamente conhecidos. Caso o E2E falhe, reportar a falha como bloqueio e não dizer que o MP4 com renovação já foi validado.
