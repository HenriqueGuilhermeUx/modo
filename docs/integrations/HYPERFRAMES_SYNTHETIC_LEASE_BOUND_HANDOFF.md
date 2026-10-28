# HyperFrames — contrato sintético Ed25519 v2 vinculado ao lease PostgreSQL

Estado: experimento isolado na PR #164 DRAFT. Sem merge/deploy, mídia real de clientes ou publicação.

O contrato v1 usa IDs sintéticos e nonce; a fila já existente usa UUID real da tarefa, organização, worker, versão, tentativa e fencing. O v2 é separado para impedir que um pedido assinado anteriormente seja aceito após a troca de lease.

Arquivos:
- static-handoff-lease-v2.mjs: assinatura e verificação Ed25519, audience v2, job UUID, projeto UUID, organização sintética, worker, fence UUID, leaseVersion, attempts, digest, nonce e prazo curto; exige identidade independente autorizada.
- 006_synthetic_lease_handoffs.sql: migração de laboratório manual protegida por nome do banco modo_hyperframes_staging; nonce global e UNIQUE(job_id, lease_fence); FK (job_id, organization_id) para fila real de homologação.
- static-handoff-pg-lease.mjs: conferência da tarefa atual (running), projeto, organização, hash, worker, versão/tentativa e fence; SELECT FOR SHARE serializa o despacho contra mudanças da fila. Apenas um INSERT atômico por lease, relógio do PostgreSQL.
- static-handoff-pg-lease.test.mjs: prova integrada com HyperframesStagingPgQueue.enqueue/claim/fail/finish, 20 pedidos concorrentes, reexecução, troca de fence, conclusão, falhas criptográficas, DB errado, produção desabilitada e privilégios.
- hyperframes-staging-pg-ci.yml: extensão da suíte existente, após 001–005.

O papel hf_staging_nonce_dispatcher continua NOLOGIN, recebe INSERT na tabela nova e SELECT nas colunas da fila necessárias ao predicado; não pode alterar a fila. O worker antigo e o navegador não recebem acesso à nova tabela. Nenhuma chave privada ou mídia de cliente é utilizada.

Limitações: não há autenticação mútua de serviços, integração com renderizador real, recibo assinado vinculado ao lease, política de retenção/auditoria, lifecycle de chaves ou homologação visual Remotion. Nunca ativar clientes ou produção automaticamente. A falha original do CLI HyperFrames em Docker restrito permanece um teste separado.
