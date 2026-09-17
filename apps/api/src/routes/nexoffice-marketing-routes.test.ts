import Fastify from 'fastify';
import {describe,expect,it} from 'vitest';
import {registerNexOfficeMarketingRoutes} from './nexoffice-marketing-routes.js';
import {MediaConnectionService} from '../services/media-connection-service.js';

const headers={'x-nexoffice-key':'test-bridge-key','x-nexoffice-workspace-id':'workspace-a','content-type':'application/json'};

describe('NexOffice marketing bridge Google Ads governance',()=>{
  it('keeps OAuth and campaign activation closed when Google credentials/account are absent',async()=>{
    const app=Fastify();
    await registerNexOfficeMarketingRoutes(app,{serviceKey:'test-bridge-key'});
    const health=await app.inject({method:'GET',url:'/api/v1/internal/nexoffice/marketing/v1/health',headers});
    expect(health.statusCode).toBe(200);
    const healthBody=health.json();
    expect(healthBody.externalCampaignActivation).toBe(false);
    expect(healthBody.externalProspectingOutreach).toBe(false);
    expect(healthBody.workflow).toEqual(['draft','review','ready']);
    expect(healthBody.googleAds.metricsReadOnly).toBe(true);
    expect(healthBody.prospecting.discoveryRequiresExplicitApproval).toBe(true);
    expect(healthBody.prospecting.externalOutreach).toBe(false);
    expect(healthBody.capabilities).toContain('prospecting.icp');
    expect(healthBody.capabilities).toContain('prospecting.outreach_draft');
    expect(healthBody.capabilities).toContain('intelligence.market_radar.read');
    expect(healthBody.capabilities).toContain('intelligence.market_radar.collect');
    expect(healthBody.marketRadar.configured).toBe(false);
    expect(healthBody.marketRadar.collectionRequiresExplicitApproval).toBe(true);
    expect(healthBody.marketRadar.externalCommunication).toBe(false);

    const prepare=await app.inject({method:'POST',url:'/api/v1/internal/nexoffice/marketing/v1/media/connections/google_ads/prepare',headers,payload:{}});
    expect(prepare.statusCode).toBe(201);
    expect(prepare.json().authorization.ready).toBe(false);

    const project=await app.inject({method:'POST',url:'/api/v1/internal/nexoffice/marketing/v1/demand/projects',headers,payload:{business:'Negócio Teste',offer:'Oferta Teste',objective:'leads',location:'Santos',monthlyBudget:1500,ticket:500}});
    expect(project.statusCode).toBe(201);
    const projectId=project.json().id;
    const campaign=await app.inject({method:'POST',url:'/api/v1/internal/nexoffice/marketing/v1/campaigns',headers,payload:{projectId,provider:'google_ads',name:'Campanha Teste',monthlyBudget:1500,plan:{channelPlan:[{channel:'google_search'}]}}});
    expect(campaign.statusCode).toBe(201);
    const campaignId=campaign.json().id;
    const review=await app.inject({method:'POST',url:`/api/v1/internal/nexoffice/marketing/v1/campaigns/${campaignId}/review`,headers,payload:{}});
    expect(review.statusCode).toBe(200);
    const ready=await app.inject({method:'POST',url:`/api/v1/internal/nexoffice/marketing/v1/campaigns/${campaignId}/ready`,headers,payload:{approved:true}});
    expect(ready.statusCode).toBe(409);

    const insights=await app.inject({method:'GET',url:'/api/v1/internal/nexoffice/marketing/v1/insights?days=30',headers});
    expect(insights.statusCode).toBe(200);
    expect(insights.json().googleAds).toBeNull();
    await app.close();
  });

  it('exposes workspace-scoped B2B prospecting but never sends outreach',async()=>{
    const app=Fastify();
    await registerNexOfficeMarketingRoutes(app,{serviceKey:'test-bridge-key'});

    const created=await app.inject({method:'POST',url:'/api/v1/internal/nexoffice/marketing/v1/prospecting/campaigns',headers,payload:{name:'SaaS Santos',segment:'SaaS B2B',roles:['Founder','CEO'],location:'Santos',offer:'NexOffice'}});
    expect(created.statusCode).toBe(201);
    const campaign=created.json();
    expect(campaign.segment).toBe('SaaS B2B');

    const lead=await app.inject({method:'POST',url:`/api/v1/internal/nexoffice/marketing/v1/prospecting/campaigns/${campaign.id}/leads`,headers,payload:{name:'Pessoa Teste',role:'Founder',company:'Empresa Teste',email:'pessoa@example.com',fitScore:88,signal:'Crescimento da operação'}});
    expect(lead.statusCode).toBe(201);
    expect(lead.json().status).toBe('new');

    const approach=await app.inject({method:'POST',url:`/api/v1/internal/nexoffice/marketing/v1/prospecting/leads/${lead.json().id}/approach`,headers,payload:{channel:'email'}});
    expect(approach.statusCode).toBe(200);
    expect(approach.json().message).toMatch(/Empresa Teste|Pessoa/i);

    const discovery=await app.inject({method:'POST',url:`/api/v1/internal/nexoffice/marketing/v1/prospecting/campaigns/${campaign.id}/discover`,headers,payload:{approved:true,limit:5}});
    expect(discovery.statusCode).toBe(503);
    expect(discovery.json().error).toBe('PROVIDER_NOT_CONFIGURED');

    const otherHeaders={...headers,'x-nexoffice-workspace-id':'workspace-b'};
    const other=await app.inject({method:'GET',url:'/api/v1/internal/nexoffice/marketing/v1/prospecting/campaigns',headers:otherHeaders});
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual([]);
    await app.close();
  });

  it('isolates Market Radar missions by NexOffice workspace and keeps collection approval-first',async()=>{
    const app=Fastify();
    await registerNexOfficeMarketingRoutes(app,{serviceKey:'test-bridge-key',intelligenceProvider:'queue',apifyMarketRadarTaskId:'test-market-radar-task'});
    const health=await app.inject({method:'GET',url:'/api/v1/internal/nexoffice/marketing/v1/health',headers});
    expect(health.statusCode).toBe(200);
    expect(health.json().marketRadar.configured).toBe(true);

    const created=await app.inject({method:'POST',url:'/api/v1/internal/nexoffice/marketing/v1/intelligence/market-radar/missions',headers,payload:{approved:true,name:'Radar Santos',objective:'Mapear concorrentes e sinais de demanda',brandName:'NexOffice Teste',niche:'SaaS B2B',regions:['Santos'],keywords:['gestão empresarial','ERP'],competitors:['Concorrente A'],maxItems:10}});
    expect(created.statusCode).toBe(201);
    const mission=created.json().mission;
    expect(mission.playbook).toBe('market_radar');
    expect(created.json().governance.explicitApproval).toBe(true);
    expect(created.json().governance.externalCommunication).toBe(false);

    const listA=await app.inject({method:'GET',url:'/api/v1/internal/nexoffice/marketing/v1/intelligence/market-radar/missions',headers});
    expect(listA.statusCode).toBe(200);
    expect(listA.json().missions).toHaveLength(1);

    const otherHeaders={...headers,'x-nexoffice-workspace-id':'workspace-b'};
    const listB=await app.inject({method:'GET',url:'/api/v1/internal/nexoffice/marketing/v1/intelligence/market-radar/missions',headers:otherHeaders});
    expect(listB.statusCode).toBe(200);
    expect(listB.json().missions).toEqual([]);

    const crossRead=await app.inject({method:'GET',url:`/api/v1/internal/nexoffice/marketing/v1/intelligence/market-radar/missions/${mission.id}/results`,headers:otherHeaders});
    expect(crossRead.statusCode).toBe(404);
    await app.close();
  });

  it('rejects manual Google Ads account attachment',async()=>{
    const service=new MediaConnectionService({});
    const ctx={organization:{id:'nexoffice:workspace-a'}};
    const prepared=await service.prepare(ctx,'google_ads');
    await expect(service.attachAuthorizedAccount(ctx,prepared.id,{externalAccountId:'1234567890',accountName:'Fake Google'})).rejects.toThrow(/OAuth oficial/i);
    await service.close();
  });
});