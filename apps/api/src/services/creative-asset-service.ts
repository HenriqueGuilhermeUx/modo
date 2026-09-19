import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";
import type { CreativeAsset, CreativeBrief, CreativeProviderJob } from "./creative-engine-service.js";
const { Pool: PgPool } = pg;

export interface StoredCreativeJob {
  id: string; organizationId: string; brandId: string; provider: string; providerJobId: string;
  kind: string; objective: string; prompt: string; status: string; qualityStatus?: "pending"|"passed"|"needs_review"; qualityScore?: number; approvalStatus?: "pending"|"approved"|"rejected"; assets: CreativeAsset[];
  error?: string | null; createdAt: string; updatedAt: string;
}

export class CreativeAssetService {
  private readonly pool?: Pool;
  private readonly jobs = new Map<string, StoredCreativeJob>();
  constructor(options: { databaseUrl?: string; databaseSsl?: boolean } = {}) {
    if (options.databaseUrl) this.pool = new PgPool({ connectionString: options.databaseUrl, ssl: options.databaseSsl ? { rejectUnauthorized: false } : undefined, max: 3 });
  }
  async initialize() {
    if (!this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS modo_creative_jobs(
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,
      brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE, provider TEXT NOT NULL,
      provider_job_id TEXT NOT NULL, kind TEXT NOT NULL, objective TEXT NOT NULL, prompt TEXT NOT NULL,
      status TEXT NOT NULL, quality_status TEXT NOT NULL DEFAULT 'pending', quality_score INTEGER, approval_status TEXT NOT NULL DEFAULT 'pending', assets JSONB NOT NULL DEFAULT '[]'::jsonb, error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ); CREATE INDEX IF NOT EXISTS modo_creative_jobs_brand_idx ON modo_creative_jobs(organization_id,brand_id,created_at DESC);`);
  }
  async close(){ await this.pool?.end(); }
  private map(r:any):StoredCreativeJob{return{id:r.id,organizationId:r.organization_id,brandId:r.brand_id,provider:r.provider,providerJobId:r.provider_job_id,kind:r.kind,objective:r.objective,prompt:r.prompt,status:r.status,qualityStatus:r.quality_status||"pending",qualityScore:r.quality_score??undefined,approvalStatus:r.approval_status||"pending",assets:r.assets||[],error:r.error,createdAt:new Date(r.created_at).toISOString(),updatedAt:new Date(r.updated_at).toISOString()}}
  async create(organizationId:string, brief:CreativeBrief, job:CreativeProviderJob){
    const id=randomUUID();
    if(this.pool){const r=await this.pool.query(`INSERT INTO modo_creative_jobs(id,organization_id,brand_id,provider,provider_job_id,kind,objective,prompt,status,assets,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,[id,organizationId,brief.brandId,job.provider,job.providerJobId,brief.kind,brief.objective,brief.prompt,job.status,JSON.stringify(job.assets),job.error||null]);return this.map(r.rows[0]);}
    const now=new Date().toISOString();const item:StoredCreativeJob={id,organizationId,brandId:brief.brandId,provider:job.provider,providerJobId:job.providerJobId,kind:brief.kind,objective:brief.objective,prompt:brief.prompt,status:job.status,qualityStatus:"pending",approvalStatus:"pending",assets:job.assets,error:job.error,createdAt:now,updatedAt:now};this.jobs.set(id,item);return item;
  }
  async listApproved(organizationId:string,brandId:string){
    if(this.pool){const r=await this.pool.query("SELECT * FROM modo_creative_jobs WHERE organization_id=$1 AND brand_id=$2 AND status='ready' AND quality_status='passed' AND approval_status='approved' ORDER BY updated_at DESC LIMIT 100",[organizationId,brandId]);return r.rows.map(x=>this.map(x));}
    return [...this.jobs.values()].filter(x=>x.organizationId===organizationId&&x.brandId===brandId&&x.status==="ready"&&x.qualityStatus==="passed"&&x.approvalStatus==="approved").sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }

  async list(organizationId:string,brandId:string){
    if(this.pool){const r=await this.pool.query("SELECT * FROM modo_creative_jobs WHERE organization_id=$1 AND brand_id=$2 ORDER BY created_at DESC LIMIT 100",[organizationId,brandId]);return r.rows.map(x=>this.map(x));}
    return [...this.jobs.values()].filter(x=>x.organizationId===organizationId&&x.brandId===brandId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async sync(organizationId:string,id:string,job:CreativeProviderJob){
    if(this.pool){const r=await this.pool.query(`UPDATE modo_creative_jobs SET status=$3,assets=$4::jsonb,error=$5,updated_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING *`,[id,organizationId,job.status,JSON.stringify(job.assets),job.error||null]);if(!r.rowCount)throw new Error("Creative job não encontrado.");return this.map(r.rows[0]);}
    const item=this.jobs.get(id);if(!item||item.organizationId!==organizationId)throw new Error("Creative job não encontrado.");const next={...item,status:job.status,assets:job.assets,error:job.error,updatedAt:new Date().toISOString()};this.jobs.set(id,next);return next;
  }
  async qualityGate(organizationId:string,id:string){
    const item=await this.get(organizationId,id);if(!item||item.status!=="ready")throw new Error("Criação pronta não encontrada.");
    const hasAsset=item.assets.length>0&&item.assets.every(a=>/^https:\/\//i.test(a.url));const score=hasAsset?100:0;const qualityStatus=score>=80?"passed":"needs_review";
    if(this.pool){const r=await this.pool.query("UPDATE modo_creative_jobs SET quality_status=$3,quality_score=$4,updated_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING *",[id,organizationId,qualityStatus,score]);return this.map(r.rows[0]);}
    const next={...item,qualityStatus:qualityStatus as "passed"|"needs_review",qualityScore:score,updatedAt:new Date().toISOString()};this.jobs.set(id,next);return next;
  }

  async setApproval(organizationId:string,id:string,status:"approved"|"rejected"){
    if(this.pool){const r=await this.pool.query("UPDATE modo_creative_jobs SET approval_status=$3,updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND status='ready' RETURNING *",[id,organizationId,status]);if(!r.rowCount)throw new Error("Criação pronta não encontrada.");return this.map(r.rows[0]);}
    const item=this.jobs.get(id);if(!item||item.organizationId!==organizationId||item.status!=="ready")throw new Error("Criação pronta não encontrada.");const next={...item,approvalStatus:status,updatedAt:new Date().toISOString()};this.jobs.set(id,next);return next;
  }

  async get(organizationId:string,id:string){
    if(this.pool){const r=await this.pool.query("SELECT * FROM modo_creative_jobs WHERE id=$1 AND organization_id=$2",[id,organizationId]);return r.rowCount?this.map(r.rows[0]):null;}
    const x=this.jobs.get(id);return x?.organizationId===organizationId?x:null;
  }
}
