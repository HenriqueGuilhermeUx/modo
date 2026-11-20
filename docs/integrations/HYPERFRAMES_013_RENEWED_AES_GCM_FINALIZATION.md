# HyperFrames 013 — AES-GCM após renovação, fluxo v3 estritamente isolado

**Escopo:** PR #164 DRAFT, banco descartável `modo_hyperframes_staging`, tenant `synthetic-tenant-mp4-receipt`. Nenhuma modificação à produção, ao Remotion comercial, ao Publisher V2 ou à base de clientes.

## Protocolo

A migration 013 cria a coluna opcional `render_artifacts.v3_receipt_sha256` (com FK para o atestado v3). Ela separa os gatilhos de autorização e conclusão da tabela de artefatos em **dois caminhos mutuamente exclusivos**, definidos pelo valor da coluna:

- `NULL`: os gatilhos originais 008/009 para recibos v2 e lançamento único continuam **intactos**, inclusive o bloqueio 010 para leases renovados;
- SHA-256 não nulo: dois gatilhos novos, `BEFORE INSERT` e `AFTER INSERT`, exigem correspondência exata com o recibo v3 já autenticado pelo host, job/tenant, worker/fence/leaseVersion, `running` + `previewOnly`, digest e número de bytes, despacho original, token de lançamento, contagem de épocas, vencimento do lease e horizonte de 120 segundos; a nova tabela `synthetic_renewed_encrypted_finalizations_v3` registra a conclusão.

O método existente `HyperframesStagingPgArtifacts.finishWithVideo` ganhou o parâmetro **opcional** `v3ReceiptSha256`, recusado fora de `synthetic-ci-only` e do tenant fictício. Para todos os chamadores sem esse campo, o INSERT anterior permanece sem alteração semântica. A mesma transação do cofre AES-256-GCM continua efetuando lock da linha, criptografia/autenticação AAD, verificação do recibo pelo gatilho, INSERT de ciphertext, registro de prova e transição atômica do job para `succeeded`. Erros e expiração fazem rollback completo. O método `read` continua verificando status, organização, expiração, GCM tag, AAD e SHA-256 após restart.

O Chrome **não** recebe credenciais PostgreSQL nem chave de assinatura. A chave AES é gerada apenas no processo confiável. O job permanece `published:false`, `previewOnly:true`; nenhuma API HTTP, publicador ou URL de download foi adicionada. O banco não verifica assinaturas Ed25519 por conta própria: o sidecar confiável as verificou antes de registrar o recibo v3 nas migrations 011/012.

## Testes de isolamento e AES-GCM

A suíte `static-lease-continuation-v3-pg.test.mjs` valida novo opt-in desativado por padrão, conclusão v3 com ciphertext, read/decrypt após reinicializar a instância, ausência de linha v2, proibição de reutilizar receipt, tenant/fence errados, vídeo adulterado, expiração e rollback integral. A migration é aplicada ao CI PostgreSQL e ao E2E do MP4 legado para confirmar que a rota V2 não mudou.

**Limite dos testes desta etapa:** os cenários recém-inseridos de finalização v3 usam um Buffer sintético MP4-shaped (marca `ftyp`), **não** provam que o conteúdo foi renderizado no Chrome nem validado por FFprobe. O E2E anterior continua testando vídeo H.264 real, mas sem renovação. Não chamar esta etapa de E2E de MP4 real com renovação até executar o próximo teste específico com o mesmo job e lançamento do Chrome.

## Próxima evidência

No pipeline de vídeo real, usar o mesmo job/lease do despacho/Chrome: renderizar o H.264 sintético, verificar seus quadros e SHA, **renovar o lease no host**, emitir continuação v3 e recibo v3, gravar pelo mesmo cofre AES, forçar a recuperação/negação de replay após restart. Certificar bloqueios de prazo, parâmetros, repetição, falta de chaves e sem publicação. Só então considerar o caminho v3 de homologação operacional; produção continua proibida.
