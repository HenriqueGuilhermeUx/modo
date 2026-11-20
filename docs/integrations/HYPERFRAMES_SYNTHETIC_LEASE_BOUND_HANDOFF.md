# HyperFrames — synthetic Ed25519 v2 linked to a staging PostgreSQL lease

State: experiment only, PR #164 DRAFT. No merge, production deploy, customer media or publication.

The original v1 signed nonce remains unchanged. The new v2 order binds a real isolated-staging job UUID to tenant, project, worker, current lease fence, lease version and attempts, request hash, nonce and short deadline.

The migration 006_synthetic_lease_handoffs.sql is guarded by the database name modo_hyperframes_staging and executed only by a CI-only workflow. The new table stores a globally unique nonce and UNIQUE(job_id,lease_fence). A foreign key binds the dispatch to the existing render_jobs table. Tokens never reauthorize after expiry.

Important least privilege control: PostgreSQL requires UPDATE permission to acquire a row lock with SELECT FOR SHARE. That permission is NEVER granted to the dispatcher. A dedicated NOLOGIN role hf_staging_lease_claim_owner has only the minimal queue column privileges needed to enforce the lease predicate, and owns the SECURITY DEFINER function consume_synthetic_lease. The function has fixed fully-qualified SQL, a restricted search_path, data checks, a DB-name guard and an expiry check performed AFTER the row lock is acquired. The function is callable only by the existing NOLOGIN nonce-dispatcher role. The dispatcher does not get direct table INSERT/SELECT/UPDATE on render_jobs or the v2 dispatch table; existing renderer and worker receive no access.

The trusted-side Node adapter only calls the function after the synthetic Ed25519 verifier validates signature, audience, independently authorized job and worker identity. It does not expose HTTP or include database credentials or browser code. The existing HyperframesStagingPgQueue is used in the disposable PostgreSQL test: enqueue, claim, fail, finish; 20 concurrent signed dispatches per lease, duplicate rejection, stale fence after retry, expired orders and wrong database.

Still blocked: service authentication/mTLS, audited signing key revocation, actual MP4 result binding, production-grade retention and reliable cleanup, browser sandbox hardening, visual comparison with Remotion, and the original HyperFrames CLI failure under restricted Docker. No customer pilot or production promotion.
