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
    expect(healthBody.workflow).toEqual(['draft','review','ready']);
    expect(healthBody.googleAds.metricsReadOnly).toBe(true);

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

  it('rejects manual Google Ads account attachment',async()=>{
    const service=new MediaConnectionService({});
    const ctx={organization:{id:'nexoffice:workspace-a'}};
    const prepared=await service.prepare(ctx,'google_ads');
    await expect(service.attachAuthorizedAccount(ctx,prepared.id,{externalAccountId:'1234567890',accountName:'Fake Google'})).rejects.toThrow(/OAuth oficial/i);
    await service.close();
  });
});
