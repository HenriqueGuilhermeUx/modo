import { describe, expect, it } from "vitest";
import { ProspectorService } from "./services/prospector-service.js";

describe("ProspectorService",()=>{
 it("creates organization-scoped campaign and lead flow",async()=>{
  const service=new ProspectorService({});
  const context={organization:{id:"org-a"},user:{id:"user-a"}};
  const campaign=await service.createCampaign(context,{segment:"Contabilidade",roles:["Sócio","CEO"],location:"Brasil",companySize:"10-100",offer:"SmartBots"});
  expect(campaign.segment).toBe("Contabilidade");
  const lead=await service.addLead(context,{campaignId:campaign.id,name:"Ana",company:"Atlas",role:"CEO",fitScore:93,reason:"ICP aderente"});
  expect(lead.fitScore).toBe(93);
  expect((await service.listLeads(context,campaign.id))[0].company).toBe("Atlas");
  const approved=await service.updateLeadStatus(context,lead.id,"approved");
  expect(approved.status).toBe("approved");
  expect(await service.listCampaigns({organization:{id:"org-b"}})).toHaveLength(0);
  await service.close();
 });
});