import {describe,it,expect} from 'vitest';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {getModoAgenticsPreview,modoAgenticsEnabled,signModoAgenticsPreview} from './nexa-agentics-bridge.js';

const organizationId=randomUUID(),userId=randomUUID(),identity={organizationId,userId};
const key=randomBytes(48);
const env={NODE_ENV:'test',MODO_NEXA_AGENTICS_ENABLED:'true',
 MODO_NEXA_AGENTICS_KEY_B64:key.toString('base64url'),
 MODO_NEXA_AGENTICS_BASE_URL:'http://127.0.0.1:48619/'};
const fields=['version','product','tenantId','principalId','operation','eventId','issuedAt','expiresAt'];
function valid(request:any,override:Record<string,unknown>={}){
 return {contract:'nexa.agentics.product.preview.v1',status:'review_only',
  product:'modo',tenantId:request.tenantId,eventId:request.eventId,
  agent:'creative',title:'Planejamento de campanha',
  summary:'Plano genérico sem postagem nem veiculação',
  synthetic:true,readOnly:true,customerDataAccess:false,
  financialExecutionAllowed:false,externalToolsAllowed:false,
  medicalDataAccess:false,legalCaseDataAccess:false,productionReady:false,...override};
}
describe('MODO → Nexa Agentics bridge (no external actions)',()=>{
 it('derives tenant/principal from server session, signs fixed operation',()=>{
  const {request,signature}=signModoAgenticsPreview(identity,env as any,
    Date.parse('2026-10-23T20:00:00.000Z'));
  expect(request.tenantId).toBe(organizationId);
  expect(request.principalId).toBe(userId);
  expect(request.product).toBe('modo');
  expect(request.operation).toBe('campaign.draft.preview');
  expect(request.expiresAt-request.issuedAt).toBe(20);
  expect(signature).toBe(createHmac('sha256',key)
   .update(JSON.stringify(fields.map(f=>(request as any)[f])),'utf8').digest('base64url'));
 });
 it('disabled by default and in production/Render',()=>{
  expect(modoAgenticsEnabled({})).toBe(false);
  expect(modoAgenticsEnabled({...env,NODE_ENV:'production'})).toBe(false);
  expect(modoAgenticsEnabled({...env,RENDER:'true'})).toBe(false);
 });
 it('refuses client-created organization or principal',()=>{
  expect(()=>signModoAgenticsPreview({...identity,organizationId:'from-browser'},env as any)).toThrow(/authenticated_org_session_required/);
  expect(()=>signModoAgenticsPreview({...identity,userId:'administrator'},env as any)).toThrow(/authenticated_org_session_required/);
 });
 it('restricts destination to fixture loopback',async()=>{
  for(const url of ['https://attacker.invalid/','http://127.0.0.1:5000/',
   'http://127.0.0.1:48619/path','file:///etc/passwd']){
   await expect(getModoAgenticsPreview(identity,{...env,MODO_NEXA_AGENTICS_BASE_URL:url} as any))
    .rejects.toThrow(/unsafe_bridge_url/);
  }
 });
 it('sends only signed minimal context and filters gateway output',async()=>{
  let called=0;
  const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{
   called++;
   expect(String(url)).toBe('http://127.0.0.1:48619/v1/agentics/preview');
   const body=JSON.parse(String(init?.body));
   expect(Object.keys(body).sort()).toEqual(['request','signature']);
   expect(Object.keys(body.request).sort()).toEqual([...fields].sort());
   expect(body.request.tenantId).toBe(organizationId);
   expect(body.request.principalId).toBe(userId);
   expect(body.request.operation).toBe('campaign.draft.preview');
   return Response.json(valid(body.request,{customerSecret:'never exposed'}));
  };
  const out=await getModoAgenticsPreview(identity,env as any,fetcher as typeof fetch);
  expect(called).toBe(1);
  expect((out as any).customerSecret).toBeUndefined();
  expect(out.synthetic).toBe(true);
  expect(out.externalToolsAllowed).toBe(false);
 });
 it('rejects responses granting money, data access or remote actions',async()=>{
  for(const override of [
   {tenantId:randomUUID()},{customerDataAccess:true},{externalToolsAllowed:true},
   {financialExecutionAllowed:true},{productionReady:true},{medicalDataAccess:true}
  ]){
   const fetcher=async(_url:RequestInfo|URL,init?:RequestInit)=>{
    const {request}=JSON.parse(String(init?.body));return Response.json(valid(request,override));
   };
   await expect(getModoAgenticsPreview(identity,env as any,fetcher as typeof fetch))
    .rejects.toThrow(/unsafe_gateway_response/);
  }
 });
 it('fails closed on outages and weak signing keys',async()=>{
  await expect(getModoAgenticsPreview(identity,env as any,
   (async()=>{throw Error('offline')}) as typeof fetch)).rejects.toThrow(/gateway_unavailable/);
  expect(()=>signModoAgenticsPreview(identity,
   {...env,MODO_NEXA_AGENTICS_KEY_B64:randomBytes(8).toString('base64url')} as any))
    .toThrow(/product_key_required|invalid_product_key/);
 });
});
