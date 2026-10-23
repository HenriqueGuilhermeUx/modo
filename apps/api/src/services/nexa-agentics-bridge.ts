/**
 * MODO -> Nexa Agentics signed, campaign-planning preview-only bridge.
 * No Google Ads/Meta/Metricool campaign IDs, CRM contacts, creatives, raw
 * prompt or API keys cross this boundary. Real external execution forbidden.
 * Production/Render disabled pending security homologation.
 */
import {createHmac,randomUUID} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS=['version','product','tenantId','principalId','operation','eventId','issuedAt','expiresAt'] as const;
const PURPOSE='nexa.agentics.product.preview.v1';
export type ModoAgenticsIdentity={organizationId:string;userId:string};
export type ModoAgenticsPreview={contract:string;status:'review_only';product:'modo';
 tenantId:string;eventId:string;agent:'creative';title:string;summary:string;
 synthetic:true;readOnly:true;customerDataAccess:false;financialExecutionAllowed:false;
 externalToolsAllowed:false;medicalDataAccess:false;legalCaseDataAccess:false;
 productionReady:false};
function deny(reason:string):never{throw Error('modo_agentics_denied_'+reason)}
export function modoAgenticsEnabled(env:NodeJS.ProcessEnv=process.env){
 return env.MODO_NEXA_AGENTICS_ENABLED==='true'&&env.NODE_ENV!=='production'&&
  !env.RENDER&&!env.RENDER_SERVICE_ID&&
  !!env.MODO_NEXA_AGENTICS_KEY_B64&&!!env.MODO_NEXA_AGENTICS_BASE_URL;
}
function key(env:NodeJS.ProcessEnv):Buffer{
 const source=String(env.MODO_NEXA_AGENTICS_KEY_B64||'');
 if(!/^[A-Za-z0-9_-]{43,4096}$/.test(source))deny('product_key_required');
 const b=Buffer.from(source,'base64url');
 if(b.length<32||b.length>2048||b.toString('base64url')!==source)
  deny('invalid_product_key');
 return b;
}
function destination(env:NodeJS.ProcessEnv){
 if(!modoAgenticsEnabled(env))deny('feature_disabled');
 let url:URL;
 try{url=new URL(env.MODO_NEXA_AGENTICS_BASE_URL!)}catch{deny('unsafe_bridge_url')}
 if(url.origin!=='http://127.0.0.1:48619'||url.pathname!=='/'||
    url.search||url.hash||url.username||url.password)deny('unsafe_bridge_url');
 return new URL('/v1/agentics/preview',url.origin);
}
export function signModoAgenticsPreview(
 identity:ModoAgenticsIdentity,env:NodeJS.ProcessEnv=process.env,nowMs=Date.now()){
 if(!UUID.test(identity.organizationId)||!UUID.test(identity.userId))
  deny('authenticated_org_session_required');
 if(!Number.isSafeInteger(nowMs)||nowMs<0)deny('clock_invalid');
 const issuedAt=Math.floor(nowMs/1000);
 const request={version:PURPOSE,product:'modo',tenantId:identity.organizationId,
  principalId:identity.userId,operation:'campaign.draft.preview',
  eventId:randomUUID(),issuedAt,expiresAt:issuedAt+20};
 const signature=createHmac('sha256',key(env)).update(
  JSON.stringify(FIELDS.map(f=>request[f])),'utf8').digest('base64url');
 return Object.freeze({request:Object.freeze(request),signature});
}
export async function getModoAgenticsPreview(identity:ModoAgenticsIdentity,
 env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch):Promise<ModoAgenticsPreview>{
 const target=destination(env),signed=signModoAgenticsPreview(identity,env);
 let response:Response;
 try{
  response=await fetcher(target,{method:'POST',redirect:'error',
   headers:{'content-type':'application/json','accept':'application/json'},
   body:JSON.stringify(signed),signal:AbortSignal.timeout(3000)});
 }catch{deny('gateway_unavailable')}
 if(!response.ok)deny('gateway_rejected');
 let result:unknown;
 try{result=await response.json();}catch{deny('gateway_invalid_json')}
 if(!result||typeof result!=='object'||Array.isArray(result))
  deny('gateway_invalid_response');
 const r=result as Record<string,unknown>;
 if(r.contract!==PURPOSE||r.status!=='review_only'||r.product!=='modo'||
  r.tenantId!==identity.organizationId||r.eventId!==signed.request.eventId||
  r.agent!=='creative'||typeof r.title!=='string'||r.title.length>100||
  typeof r.summary!=='string'||r.summary.length>400||
  r.synthetic!==true||r.readOnly!==true||r.customerDataAccess!==false||
  r.financialExecutionAllowed!==false||r.externalToolsAllowed!==false||
  r.medicalDataAccess!==false||r.legalCaseDataAccess!==false||
  r.productionReady!==false)deny('unsafe_gateway_response');
 return {contract:PURPOSE,status:'review_only',product:'modo',tenantId:identity.organizationId,
  eventId:signed.request.eventId,agent:'creative',title:r.title,summary:r.summary,
  synthetic:true,readOnly:true,customerDataAccess:false,financialExecutionAllowed:false,
  externalToolsAllowed:false,medicalDataAccess:false,legalCaseDataAccess:false,
  productionReady:false};
}
