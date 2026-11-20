# HyperFrames v3 — prova assinada de continuação de lease (verificação isolada)

**PR #164 DRAFT · MODO synthetic CI only · não habilitado para finalização.**

O incremento 010 já permite até duas renovações atômicas de um lease sintético e bloqueia qualquer recibo MP4 v2 se houver renovação. Este incremento acrescenta o contrato criptográfico **v3**, mas **não remove o bloqueio SQL** e não inicia renovação durante o renderizador.

A nova biblioteca `static-lease-continuation-v3.mjs` assina e verifica uma prova Ed25519 gerada **exclusivamente pelo processo confiável**, utilizando os dados atuais do PostgreSQL fornecidos pelo adaptador confiável. Os fatos necessários são:

- job, tenant sintético, projeto, worker, tentativas e `leaseFence`, vinculados ao job em status `running`, `previewOnly:true`, `published:false`;
- versão corrente e expiração exata da fila, idênticas à última época registrada;
- cadeia completa (até duas épocas), sem buracos, saltos, alteração de versões, hashes ou regressão de prazos;
- hashes do despacho assinado e da admissão de Chrome, vinculados ao lançamento original;
- relógio atual, validade do comprovante e horizonte total de **até 120 segundos** desde o lançamento, sem extensão ao navegador.

A verificação rejeita chave substituída, assinatura adulterada, chave revogada, versão anterior, fence/tenant falsos, tarefa finalizada, expiração e alteração de digests. O envio de chave privada, credenciais PostgreSQL ou função de renovação para a imagem Chrome continua proibido.

**Limite essencial:** a biblioteca é uma peça de protocolo e possui testes de contrato com fatos sintéticos em memória. Ainda não há um adaptador SQL que leia uma snapshot confiável, nem um recibo de saída v3 integrado ao commit transacional. Consequentemente, a migration 010 mantém sua barreira `HF_SYNTHETIC_RENEWAL_RECEIPT_V3_REQUIRED`. A implementação e os testes desta etapa não provam renovação + finalização de MP4; não afirmar isso.

Próxima fase: um adaptador do host que leia uma snapshot transacional do banco, produza a prova v3 em RAM, invalide provas antigas e implemente uma migração adicional para validar a época assinada **no momento do commit**. Construir E2E de corrida com renovação, render tardio, replay e expiração antes de aceitar vídeos mais longos. Remotion comercial, clientes e produção permanecem intocados.
