# HyperFrames 010 — épocas de renovação atômicas e bloqueio de recibos antigos

## Estado do incremento

**Laboratório isolado, PR #164 DRAFT.** Esta fase implementa o controle transacional de renovação, mas **não habilita** recibos MP4 depois de uma renovação. Em vez de relaxar a verificação existente, o PostgreSQL passa a bloquear explicitamente qualquer recibo v2 que tente continuar um lease renovado. Somente o banco descartável `modo_hyperframes_staging` recebe a migration 010; a produção, o Remotion e o Publisher V2 permanecem intocados.

## O problema

O workflow atual depende de assinaturas Ed25519 que vinculam `leaseVersion`, `attempts` e `leaseFence` a uma versão exata do job. A API `queue.heartbeat()` aumenta a versão. Uma renovação que apenas aumentasse a duração deixaria o recibo antigo incompatível; ignorar a versão seria uma regressão de segurança.

## O que a migration 010 faz

- Cria `synthetic_lease_renewal_epochs` como trilha imutável: job, tenant fictício, fence, versão de origem e destino, hash da ordem e da autorização, horário e expiração.
- Cria `renew_synthetic_lease_epoch`, função `SECURITY DEFINER` pertencente a um papel PostgreSQL NOLOGIN. Apenas o dispatcher sintético tem permissão EXECUTE; nenhum worker nem o Chrome recebem permissão direta de atualizar jobs ou inserir auditoria.
- Realiza, **na mesma transação**, lock exclusivo do job com `FOR UPDATE`, verificação do relógio do banco *após o lock*, validação do pedido e dos digests do despacho/lançamento, checagem da versão exata, atualização do `document` JSONB + `version` + `lease_expires_ms` + `updated_ms`, e inserção da época.
- Limita a **duas renovações** por mesmo fence, com duração solicitada de 1 a 60 segundos, sem diminuição de prazo e horizonte total de até 120 segundos desde o lançamento do navegador. Versões puladas, corrida de renovação, lease vencido, trabalhador trocado, fence antigo, tenant diferente e tarefa já finalizada são recusados.
- O gatilho `reject_receipt_after_lease_renewal` bloqueia novos recibos v2 após qualquer renovação do mesmo job/fence, até existir um novo protocolo que revalide a nova versão assinada. Recibos do caminho original, **sem renovação**, continuam inalterados.

## Testes

No CI PostgreSQL descartável: concorrência de 20 renovações (uma vencedora), avanço atômico de versão/JSONB/expiração, limite de duas épocas, negação por tenant/fence/worker/digest, expiração e recuperação, rejeição do recibo Ed25519 com versão obsoleta e impossibilidade de registrar um novo recibo v2 após a renovação. A suíte verifica também as permissões mínimas dos papéis NOLOGIN.

O E2E MP4 anterior permanece sem renovar o lease: aplica a migration 010 para testar compatibilidade, mas executa o caminho original de recibo e finalização como antes.

## Próxima fase obrigatória

Criar uma prova assinada **v3** de continuação do lease, reemitida pelo processo confiável a partir do banco (nunca no Chrome), com vínculo ao `leaseFence`, versão corrente, digest de autorização, tentativas, limite e época. Somente depois de validar o v3 e adaptar o recibo final e seus gatilhos em uma nova migration poderemos habilitar renovação durante renderizações mais longas. Nenhuma etapa pode permitir a finalização com recibo assinado para versão anterior.
