import { describe, expect, it } from "vitest";
import type { ProspectorProvider } from "./services/prospector-provider.js";
import { ProspectorService } from "./services/prospector-service.js";

describe("ProspectorService",()=>{
 it("creates organization-scoped campaign and lead flow",async()=>{
  const service=new ProspectorService({});
  const context={organization:{id:"org-a"},user:{id:"user-a"}};
  const campaign=await service.createCampaign(context,{segment:"Contabilidade",roles:["Sócio","CEO"],location:"Brasil",companySize:"10-100",offer:"SmartBots"});
  const lead=await service.addLead(context,{campaignId:campaign.id,name:"Ana",company:"Atlas",role:"CEO",fitScore:93,reason:"ICP aderente"});
  expect(lead.fitScore).toBe(93);
  expect((await service.listLeads(context,campaign.id))[0].company).toBe("Atlas");
  expect((await service.updateLeadStatus(context,lead.id,"approved")).status).toBe("approved");
  expect(await service.listCampaigns({organization:{id:"org-b"}})).toHaveLength(0);
  await service.close();
 });
 it("discovers, scores and deduplicates provider leads",async()=>{
  const provider:ProspectorProvider={name:"mock",configured:true,async discover(){return [{name:"Beatriz Lima",role:"CEO",company:"Norte Contábil",email:"b@norte.test",linkedinUrl:"https://linkedin.com/in/b",websiteUrl:"https://norte.test",location:"Brasil",signal:"Expansão comercial"}]}};
  const service=new ProspectorService({provider});
  const context={organization:{id:"org-a"}};
  const campaign=await service.createCampaign(context,{segment:"Contabilidade",roles:["CEO"],location:"Brasil",offer:"SmartBots"});
  const first=await service.discover(context,campaign.id,10);
  expect(first.created).toBe(1);
  expect(first.leads[0].fitScore).toBeGreaterThanOrEqual(90);
  const second=await service.discover(context,campaign.id,10);
  expect(second.created).toBe(0);
  const draft=await service.prepareApproach(context,first.leads[0].id,"email");
  expect(draft.message).toContain("Beatriz");
  await service.close();
 });
});