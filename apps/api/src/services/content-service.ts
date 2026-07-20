import type { ContentRequest, ContentRequestCreate } from "@modo/contracts/content";
import pg, { type Pool } from "pg";
const { Pool: PgPool } = pg;

type Row = {id:string;organization_id:string;brand_id:string;content_type:ContentRequest["contentType"];objective:ContentRequest["objective"];brief:string;channel:string;status:ContentRequest["status"];credits_charged:number;output:Record<string,unknown>|null;error:string|null;created_at:Date;updated_at:Date};
const mapRow=(r:Row):ContentRequest=>({id:r.id,organizationId:r.organization_id,brandId:r.brand_id,contentType:r.content_type,objective:r.objective,brief:r.brief,channel:r.channel,status:r.status,creditsCharged:r.credits_charged,output:r.output,error:r.error,createdAt:r.created_at.toISOString(),updatedAt:r.updated_at.toISOString()});

export class ContentService{
 private pool?:Pool; private items:ContentRequest[]=[];
 constructor(o:{databaseUrl?:string;databaseSsl?:boolean}={}){if(o.databaseUrl)this.pool=new PgPool({connectionString:o.databaseUrl,ssl:o.databaseSsl?{rejectUnauthorized:false}:undefined,max:5});}
 get storage(){return this.pool?"postgres" as const:"memory" as const;}
 async initialize(){if(!this.pool)return;await this.pool.query(`CREATE TABLE IF NOT EXISTS modo_content_requests(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES modo_organizations(id) ON DELETE CASCADE,brand_id TEXT NOT NULL REFERENCES modo_brands(id) ON DELETE CASCADE,content_type TEXT NOT NULL,objective TEXT NOT NULL,brief TEXT NOT NULL,channel TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',credits_charged INTEGER NOT NULL,output JSONB,error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS modo_content_requests_org_idx ON modo_content_requests(organization_id,created_at DESC);`);}
 async close(){await this.pool?.end();}
 async create(id:string,organizationId:string,input:ContentRequestCreate,creditsCharged:number):Promise<ContentRequest>{
  if(this.pool){const q=await this.pool.query<Row>(`INSERT INTO modo_content_requests(id,organization_id,brand_id,content_type,objective,brief,channel,credits_charged) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[id,organizationId,input.brandId,input.contentType,input.objective,input.brief,input.channel,creditsCharged]);return mapRow(q.rows[0]);}
  const now=new Date().toISOString();const item:ContentRequest={id,organizationId,brandId:input.brandId,contentType:input.contentType,objective:input.objective,brief:input.brief,channel:input.channel,status:"queued",creditsCharged,output:null,error:null,createdAt:now,updatedAt:now};this.items.unshift(item);return item;
 }
 async list(organizationId:string):Promise<ContentRequest[]>{if(this.pool){const q=await this.pool.query<Row>(`SELECT * FROM modo_content_requests WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`,[organizationId]);return q.rows.map(mapRow);}return this.items.filter(i=>i.organizationId===organizationId);}
}
