# HyperFrames 011 — snapshot PostgreSQL real + prova Ed25519 v3 no host

**Somente homologação sintética, PR #164 DRAFT. Não alterar Remotion, clientes, produção ou Publisher V2.**

## Entrega

A migração 010 já protegeu até duas renovações atômicas e impede qualquer recibo MP4 v2 depois de uma renovação. A biblioteca de contrato v3 anterior verificava fatos fornecidos pelo chamador. A migração **011_synthetic_v3_continuation_snapshot.sql** estabelece agora a fonte confiável desses fatos, por leitura transacional no banco descartável **modo_hyperframes_staging**.

A função **read_synthetic_v3_continuation_snapshot(job, tenant, fence)** é `SECURITY DEFINER`, de propriedade de um papel PostgreSQL **NOLOGIN**; o despacho sintético recebe apenas `EXECUTE`, sem `SELECT` nas tabelas de job/épocas. A função:

1. Valida identidade do banco, tenant e fence exclusivamente sintéticos.
2. Trava a linha do job corrente com `FOR SHARE`; lê o relógio PostgreSQL **depois do lock**.
3. Exige `running`, `previewOnly=true`, `published=false`, versão e deadline coincidentes no JSONB e nas colunas de controle; jamais assina tarefa vencida.
4. Consulta o despacho Ed25519 vinculado ao mesmo job/fence/worker e o lançamento único do Chrome.
5. Recupera **todas** as épocas de renovação, exige quantidade 1 ou 2, vínculo ao despacho/launch, versão inicial/final consecutiva, expiração corrente e horizonte máximo de **120 segundos** desde o lançamento.
6. Recusa snapshot caso já exista recibo ou finalização criptografada.

A biblioteca **static-lease-continuation-v3-pg.mjs** executa `BEGIN; SET LOCAL ROLE hf_staging_nonce_dispatcher`, chama essa função e mantém o lock até gerar/verificar o token **Ed25519 v3** no processo confiável, com chave privada **somente em RAM no host**. Em seguida conclui a transação. O verificador vinculado ao banco sempre relê o estado atual: uma renovação posterior invalida a prova anteriormente assinada.

## Testes integrados

`static-lease-continuation-v3-pg.test.mjs` cria jobs, handoffs, launches e épocas reais com dados sintéticos descartáveis. Testa: ausência de renovação, uma renovação, duas renovações, prova antiga inválida, usuário/fence incorreto, papel antigo sem `EXECUTE`, despacho sem `SELECT`, revogação, expiração, tarefa finalizada e disputa com transação que segura `FOR UPDATE`. As migrations 001–011 são executadas no mesmo banco descartável no CI. O E2E original de MP4 aplica 011 para testar compatibilidade, **sem efetuar renovação**.

## Limite que permanece intocado

**NÃO EXISTE FINALIZAÇÃO V3 DE MP4 NESTE INCREMENTO.** A barreira SQL da migração 010 continua recusando recibos MP4 v2 após renovação. A assinatura de continuação v3 é um pré-requisito técnico e não autoriza armazenamento/publicação ou um render mais longo. Depois será preciso criar recibo de saída v3 específico, autenticar a época sob lock no ato do commit e homologar concorrência, replay, expiração, troca de fence, falha de processo e recuperação criptografada, sem aumentar arbitrariamente prazos ou levar acesso ao PostgreSQL para o Chrome.

Nenhuma chave é persistida em disco ou enviada à imagem do renderer. Dados/artefatos continuam sintéticos e descartáveis.
