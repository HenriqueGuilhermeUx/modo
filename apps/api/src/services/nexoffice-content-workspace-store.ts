import type {Brand,Niche} from "@modo/contracts";
import {randomUUID} from "node:crypto";
import pg,{type Pool} from "pg";

const {Pool:PgPool}=pg;

type Options={databaseUrl?:string;databaseSsl?:boolean};
type BrandInput={name:string;niche:Niche;websiteUrl?:string;instagramHandle?:string};
type BrandRow={id:string;organization_id:string;name:string;website_url:string|null;instagram_handle:string|null;niche:Niche;created_at:Date;updated_at:Date};

function organizationId(workspaceId:string){return `nexoffice-${workspaceId}`}
function mapBrand(row:BrandRow):Brand{return{id:row.id,organizationId:row.organization_id,name:row.name,websiteUrl:row.website_url||"",instagramHandle:row.instagram_handle||"",niche:row.niche,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()}}

export class NexOfficeContentWorkspaceStore{
  private readonly pool?:Pool;
  private readonly memory=new Map<string,Brand>();

  constructor(options:Options={}){
    if(options.databaseUrl)this.pool=new PgPool({connectionString:options.databaseUrl,ssl:options.databaseSsl?{rejectUnauthorized:false}:undefined,max:2});
  }

  get storage(){return this.pool?"postgres" as const:"memory" as const}
  organizationId(workspaceId:string){return organizationId(workspaceId)}

  async ensureBrand(workspaceId:string,input:BrandInput):Promise<Brand>{
    const orgId=organizationId(workspaceId);
    if(!this.pool){
      const current=this.memory.get(workspaceId);
      const now=new Date().toISOString();
      const brand:Brand=current?{...current,name:input.name,niche:input.niche,websiteUrl:input.websiteUrl||"",instagramHandle:input.instagramHandle||"",updatedAt:now}:{id:randomUUID(),organizationId:orgId,name:input.name,niche:input.niche,websiteUrl:input.websiteUrl||"",instagramHandle:input.instagramHandle||"",createdAt:now,updatedAt:now};
      this.memory.set(workspaceId,brand);
      return brand;
    }

    await this.pool.query(
      `INSERT INTO modo_organizations(id,name) VALUES($1,$2)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name`,
      [orgId,input.name],
    );
    const existing=await this.pool.query<BrandRow>(
      `SELECT id,organization_id,name,website_url,instagram_handle,niche,created_at,updated_at
       FROM modo_brands WHERE organization_id=$1 ORDER BY created_at ASC LIMIT 1`,
      [orgId],
    );
    if(existing.rowCount){
      const updated=await this.pool.query<BrandRow>(
        `UPDATE modo_brands SET name=$2,website_url=$3,instagram_handle=$4,niche=$5,updated_at=NOW()
         WHERE id=$1
         RETURNING id,organization_id,name,website_url,instagram_handle,niche,created_at,updated_at`,
        [existing.rows[0].id,input.name,input.websiteUrl||null,input.instagramHandle||null,input.niche],
      );
      return mapBrand(updated.rows[0]);
    }
    const created=await this.pool.query<BrandRow>(
      `INSERT INTO modo_brands(id,organization_id,name,website_url,instagram_handle,niche)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,organization_id,name,website_url,instagram_handle,niche,created_at,updated_at`,
      [randomUUID(),orgId,input.name,input.websiteUrl||null,input.instagramHandle||null,input.niche],
    );
    return mapBrand(created.rows[0]);
  }

  async close(){await this.pool?.end()}
}
