import {ContentUnitTypeSchema,NicheSchema} from "@modo/contracts";
import {ContentObjectiveSchema} from "@modo/contracts/content";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AdsCopilotService } from "../services/ads-copilot-service.js";
import {ContentAssetService} from "../services/content-asset-service.js";
import {ContentAutomationService} from "../services/content-automation-service.js";
import {ContentError,ContentService} from "../services/content-service.js";
import { DemandService } from "../services/demand-service.js";
import { GoogleAdsError, GoogleAdsService } from "../services/google-ads-service.js";
import { IntelligenceError, IntelligenceService } from "../services/intelligence-service.js";
import { MediaCampaignError, MediaCampaignService } from "../services/media-campaign-service.js";
import { MediaConnectionService, type MediaProvider } from "../services/media-connection-service.js";
import { ApifyProspectorProvider, ManualProspectorProvider } from "../services/prospector-provider.js";
import { ProspectorError, ProspectorService } from "../services/prospector-service.js";
import {NexOfficeContentWorkspaceStore} from "../services/nexoffice-content-workspace-store.js";

type Options = {
 serviceKey?:string;
 databaseUrl?:string;
 databaseSsl?:boolean;
 openAiApiKey?:string;
 openAiTextModel?:string;
 openAiImageModel?:string;
 googleAdsClientId?:string;
 googleAdsClientSecret?:string;
 googleAdsRedirectUri?:string;
 googleAdsEncryptionSecret?:string;
 googleAdsApiVersion?:string;
 googleAdsDeveloperToken?:string;
 apifyApiToken?:string;
 apifyApiBaseUrl?:string;
 apifyB2bProspectingTaskId?:string;
 intelligenceProvider?:"queue"|"apify"|"n8n";
 apifyMarketRadarTaskId?:string;
 n8nIntelligenceWebhookUrl?:string;
 n8nIntelligenceSecret?:string;
 intelligenceCallbackSecret?:string;
 publicApiUrl?:string;
 intelligenceRequestTimeoutMs?:number;
};
const DemandInput=z.object({name:z.string().max(160).optional(),business:z.string().min(1).max(160),offer:z.string().min(1).max(240),objective:z.string().max(40).default("leads"),location:z.string().max(160).default("Brasil"),monthlyBudget:z.number().nonnegative().default(0),ticket:z.number().nonnegative().default(0),cpc:z.number().positive().optional(),landingRate:z.number().min(0).max(100).optional(),closeRate:z.number().min(0).max(100).optional()});
const AdsInput=z.object({business:z.string().min(1).max(160),offer:z.string().min(1).max(240),objective:z.string().max(80).optional(),location:z.string().max(160).optional(),budget:z.number().nonnegative().optional(),ticket:z.number().nonnegative().optional(),customerDescription:z.string().max(1200).optional(),channelPreference:z.string().max(120).optional()});
const CampaignInput=z.object({projectId:z.string().uuid(),provider:z.enum(["google_ads","meta_ads"]),name:z.string().max(160).optional(),monthlyBudget:z.number().nonnegative().optional(),plan:z.record(z.string(),z.unknown()).default({})});
const OutcomeInput=z.object({eventName:z.enum(["qualified_lead","customer"]),sessionId:z.string().max(128).optional(),utm:z.record(z.string(),z.unknown()).optional(),metadata:z.record(z.string(),z.unknown()).optional()});
const ProspectingCampaignInput=z.object({name:z.string().max(160).optional(),segment:z.string().min(1).max(240),roles:z.array(z.string().min(1).max(120)).max(20).default([]),location:z.string().max(160).optional(),companySize:z.string().max(120).optional(),offer:z.string().max(600).optional(),notes:z.string().max(1600).optional()});
const ProspectingLeadInput=z.object({name:z.string().min(1).max(180),role:z.string().max(160).optional(),company:z.string().min(1).max(180),email:z.string().email().optional(),linkedinUrl:z.string().url().optional(),websiteUrl:z.string().url().optional(),location:z.string().max(160).optional(),fitScore:z.number().min(0).max(100).optional(),reason:z.string().max(1000).optional(),signal:z.string().max(1000).optional(),source:z.string().max(80).optional(),sourceRef:z.string().max(600).optional(),metadata:z.record(z.string(),z.unknown()).optional()});
const ProspectingDiscoveryInput=z.object({approved:z.literal(true),limit:z.coerce.number().int().min(1).max(50).default(20)});
const ProspectingApproachInput=z.object({channel:z.enum(["email","linkedin","whatsapp"]).default("email")});
const ContentDraftInput=z.object({
 brandName:z.string().trim().min(2).max(120),
 niche:NicheSchema.default("outro"),
 websiteUrl:z.union([z.literal(""),z.string().url().max(500)]).optional().default(""),
 instagramHandle:z.string().trim().max(80).optional().default(""),
 contentType:ContentUnitTypeSchema,
 objective:ContentObjectiveSchema,
 brief:z.string().trim().min(10).max(2000),
 channel:z.string().trim().min(2).max(60).default("Instagram"),
});
const MarketRadarMissionInput=z.object({
 approved:z.literal(true),
 name:z.string().trim().min(3).max(140),
 objective:z.string().trim().min(3).max(1200),
 brandName:z.string().trim().min(2).max(180),
 niche:z.string().trim().max(240).optional().default(""),
 websiteUrl:z.union([z.literal(""),z.string().url().max(1000)]).optional().default(""),
 instagramHandle:z.string().trim().max(160).optional().default(""),
 regions:z.array(z.string().trim().min(2).max(180)).max(20).optional().default([]),
 keywords:z.array(z.string().trim().min(2).max(180)).max(40).optional().default([]),
 competitors:z.array(z.string().trim().min(2).max(1000)).max(40).optional().default([]),
 maxItems:z.coerce.number().int().min(1).max(500).default(50),
}).refine(value=>value.keywords.length>0||value.competitors.length>0,{message:"Informe termos de mercado ou concorrentes para o radar.",path:["keywords"]});
function safeEqual(received:string,expected:string){if(!received||!expected)return false;const a=Buffer.from(received),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)}
function access(request:FastifyRequest,expected:string){const key=String(request.headers["x-nexoffice-key"]||""),workspaceId=String(request.headers["x-nexoffice-workspace-id"]||"").trim();if(!expected)return{ok:false as const,status:503,error:"bridge_not_configured"};if(!safeEqual(key,expected))return{ok:false as const,status:401,error:"unauthorized"};if(!workspaceId)return{ok:false as const,status:400,error:"workspace_required"};return{ok:true as const,workspaceId}}
function context(workspaceId:string){return{organization:{id:`nexoffice:${workspaceId}`}}}
function googleFail(reply:any,e:unknown){if(e instanceof GoogleAdsError)return reply.code(e.status).send({error:e.code,message:e.message,detail:e.detail});throw e}
function campaignFail(reply:any,e:unknown){if(e instanceof MediaCampaignError)return reply.code(e.status).send({error:e.code,message:e.message});throw e}
function prospectorFail(reply:any,e:unknown){if(e instanceof ProspectorError)return reply.code(e.status).send({error:e.code,message:e.message});throw e}
function intelligenceFail(reply:any,e:unknown){if(e instanceof IntelligenceError)return reply.code(e.statusCode).send({error:e.code,message:e.message});throw e}
function contentFail(reply:any,e:unknown){if(e instanceof ContentError)return reply.code(e.statusCode).send({error:e.code,message:e.message});throw e}

export async function registerNexOfficeMarketingRoutes(app:FastifyInstance,options:Options={}){
 const expectedKey=options.serviceKey||process.env.NEXOFFICE_SERVICE_KEY||"";
 const demand=new DemandService({databaseUrl:options.databaseUrl,databaseSsl:options.databaseSsl});
 const ads=new AdsCopilotService({openAiApiKey:options.openAiApiKey,model:options.openAiTextModel});
 const media=new MediaConnectionService({databaseUrl:options.databaseUrl,databaseSsl:options.databaseSsl});
 const campaigns=new MediaCampaignService({databaseUrl:options.databaseUrl,databaseSsl:options.databaseSsl});
 const googleAds=new GoogleAdsService({databaseUrl:options.databaseUrl,databaseSsl:options.databaseSsl,clientId:options.googleAdsClientId||process.env.GOOGLE_ADS_CLIENT_ID,clientSecret:options.googleAdsClientSecret||process.env.GOOGLE_ADS_CLIENT_SECRET,redirectUri:options.googleAdsRedirectUri||process.env.GOOGLE_ADS_REDIRECT_URI,encryptionSecret:options.googleAdsEncryptionSecret||process.env.GOOGLE_ADS_TOKEN_ENCRYPTION_SECRET,apiVersion:options.googleAdsApiVersion||process.env.GOOGLE_ADS_API_VERSION||"v25",developerToken:options.googleAdsDeveloperToken||process.env.GOOGLE_ADS_DEVELOPER_TOKEN});
 const prospectingProvider=(options.apifyApiToken&&options.apifyB2bProspectingTaskId)?new ApifyProspectorProvider({token:options.apifyApiToken,taskId:options.apifyB2bProspectingTaskId,baseUrl:options.apifyApiBaseUrl}):new ManualProspectorProvider();
 const prospector=new ProspectorService({databaseUrl:options.databaseUrl,databaseSsl:options.databaseSsl,provider:prospectingProvider,openAiApiKey:options.openAiApiKey,openAiTextModel:options.openAiTextModel});
 const content=new ContentService({databaseUrl:options.databaseUrl,databaseSsl:options.databaseSsl});
 const contentAssets=new ContentAssetService({databaseUrl:options.databaseUrl,databaseSsl:options.databaseSsl,publicApiUrl:options.publicApiUrl});
 const contentWorkspaces=new NexOfficeContentWorkspaceStore({databaseUrl:options.databaseUrl,databaseSsl:options.databaseSsl});
 const contentAutomation=new ContentAutomationService({provider:options.openAiApiKey?"openai":"native",content,assets:contentAssets,openAiApiKey:options.openAiApiKey,openAiTextModel:options.openAiTextModel,openAiImageModel:options.openAiImageModel});
 const intelligence=new IntelligenceService({
  databaseUrl:options.databaseUrl,
  databaseSsl:options.databaseSsl,
  provider:options.intelligenceProvider||"queue",
  apifyBaseUrl:options.apifyApiBaseUrl,
  apifyToken:options.apifyApiToken,
  n8nWebhookUrl:options.n8nIntelligenceWebhookUrl,
  n8nSecret:options.n8nIntelligenceSecret,
  publicApiUrl:options.publicApiUrl,
  callbackSecret:options.intelligenceCallbackSecret,
  requestTimeoutMs:options.intelligenceRequestTimeoutMs,
  taskIds:{market_radar:options.apifyMarketRadarTaskId,b2b_prospecting:options.apifyB2bProspectingTaskId},
 });
 await demand.initialize();await media.initialize();await campaigns.initialize();await googleAds.initialize();await prospector.initialize();await content.initialize();await contentAssets.initialize();await intelligence.initialize();
 app.addHook("onClose",async()=>{await Promise.all([demand.close(),media.close(),campaigns.close(),googleAds.close(),prospector.close(),content.close(),contentAssets.close(),contentWorkspaces.close(),intelligence.close()])});
 app.get("/api/v1/google-ads/readiness",async()=>({status:"ok",configured:googleAds.configured,apiVersion:googleAds.apiVersion,oauthScope:"https://www.googleapis.com/auth/adwords",redirectUriConfigured:Boolean(options.googleAdsRedirectUri||process.env.GOOGLE_ADS_REDIRECT_URI),metricsReadOnly:true,externalCampaignActivation:false}));
 app.get("/api/v1/internal/nexoffice/marketing/v1/health",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({status:"error",error:a.error});const marketRadarTaskConfigured=intelligence.configuredPlaybooks().market_radar,marketRadarReady=marketRadarTaskConfigured&&intelligence.mode!=="queue";return{status:"ok",contract:"nexoffice-marketing-v1",workspaceId:a.workspaceId,storage:{demand:demand.storage,media:media.storage,campaigns:campaigns.storage,prospecting:prospector.storage,intelligence:intelligence.storage,content:content.storage,contentAssets:contentAssets.storage,contentWorkspaces:contentWorkspaces.storage},capabilities:["demand.projects","demand.landing","demand.funnel","demand.leads","demand.outcomes","ads.plan","media.connections.read","media.connections.prepare","google_ads.oauth","google_ads.account_select","google_ads.metrics.read","marketing.insights","campaigns.draft","campaigns.review","campaigns.ready","prospecting.icp","prospecting.campaigns","prospecting.leads","prospecting.discovery","prospecting.outreach_draft","intelligence.market_radar.read","intelligence.market_radar.collect","content.drafts.read","content.drafts.create"],workflow:["draft","review","ready"],googleAds:{oauthConfigured:googleAds.configured,apiVersion:googleAds.apiVersion,metricsReadOnly:true},prospecting:{provider:prospector.provider,discoveryRequiresExplicitApproval:true,externalOutreach:false},marketRadar:{provider:intelligence.mode,taskConfigured:marketRadarTaskConfigured,configured:marketRadarReady,collectionRequiresExplicitApproval:true,externalCommunication:false},content:{provider:contentAutomation.mode,imageGeneration:contentAutomation.imageMode,draftCreation:true,billingMode:"nexoffice_entitlement",modoCreditsCharged:0,publishing:false,externalPublication:false},externalCampaignActivation:false,externalProspectingOutreach:false,readyRequirements:["explicit_client_approval","authorized_media_account"]}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/demand/projects",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});return demand.list(context(a.workspaceId))});
 app.post("/api/v1/internal/nexoffice/marketing/v1/demand/projects",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});return reply.code(201).send(await demand.create(context(a.workspaceId),DemandInput.parse(request.body)))});
 app.post("/api/v1/internal/nexoffice/marketing/v1/demand/projects/:id/landing",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});return demand.generateLanding(context(a.workspaceId),String((request.params as any).id))});
 app.get("/api/v1/internal/nexoffice/marketing/v1/demand/projects/:id/funnel",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});return demand.funnel(context(a.workspaceId),String((request.params as any).id))});
 app.get("/api/v1/internal/nexoffice/marketing/v1/demand/projects/:id/leads",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});return demand.listLeads(context(a.workspaceId),String((request.params as any).id))});
 app.post("/api/v1/internal/nexoffice/marketing/v1/demand/projects/:id/outcomes",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});return demand.trackOutcome(context(a.workspaceId),String((request.params as any).id),OutcomeInput.parse(request.body))});
 app.post("/api/v1/internal/nexoffice/marketing/v1/ads/plan",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});return ads.plan(AdsInput.parse(request.body))});
 app.get("/api/v1/internal/nexoffice/marketing/v1/media/connections",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});return media.list(context(a.workspaceId))});
 app.post("/api/v1/internal/nexoffice/marketing/v1/media/connections/:provider/prepare",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});const provider=z.enum(["google_ads","meta_ads"]).parse((request.params as any).provider) as MediaProvider,prepared=await media.prepare(context(a.workspaceId),provider);if(provider!=="google_ads")return reply.code(201).send(prepared);try{return reply.code(201).send({...prepared,authorization:await googleAds.prepare(context(a.workspaceId),prepared.id)})}catch(e){return googleFail(reply,e)}});
 app.post("/api/v1/internal/nexoffice/marketing/v1/media/google_ads/connections/:id/select-account",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{return await googleAds.selectAccount(context(a.workspaceId),String((request.params as any).id),z.object({customerId:z.string().min(1),accountName:z.string().max(160).optional()}).parse(request.body))}catch(e){return googleFail(reply,e)}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/media/google_ads/metrics",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{return await googleAds.metrics(context(a.workspaceId),Number((request.query as any)?.days||30))}catch(e){return googleFail(reply,e)}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/media/google_ads/oauth/callback",async(request,reply)=>{const q=request.query as any;if(q?.error)return reply.code(400).type("text/html").send("<html><body><h2>Autorização Google Ads não concluída</h2><p>Você pode fechar esta janela e tentar novamente no NexOffice.</p></body></html>");try{await googleAds.callback(String(q?.state||""),String(q?.code||""));return reply.type("text/html").send("<html><body><h2>Google Ads autorizado</h2><p>Volte ao NexOffice para escolher a conta e concluir a conexão.</p><script>setTimeout(function(){window.close()},1800)</script></body></html>")}catch(e){if(e instanceof GoogleAdsError)return reply.code(e.status).type("text/html").send(`<html><body><h2>Não foi possível concluir</h2><p>${String(e.message).replace(/[<>&]/g,"")}</p></body></html>`);throw e}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/campaigns",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});const projectId=String((request.query as any)?.projectId||"")||undefined;return campaigns.list(context(a.workspaceId),projectId)});
 app.post("/api/v1/internal/nexoffice/marketing/v1/campaigns",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{return reply.code(201).send(await campaigns.create(context(a.workspaceId),CampaignInput.parse(request.body)))}catch(e){return campaignFail(reply,e)}});
 app.post("/api/v1/internal/nexoffice/marketing/v1/campaigns/:id/review",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{return await campaigns.submitReview(context(a.workspaceId),String((request.params as any).id))}catch(e){return campaignFail(reply,e)}});
 app.post("/api/v1/internal/nexoffice/marketing/v1/campaigns/:id/ready",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});const body=z.object({approved:z.literal(true)}).parse(request.body);try{return await campaigns.markReady(context(a.workspaceId),String((request.params as any).id),body)}catch(e){return campaignFail(reply,e)}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/prospecting/campaigns",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});return prospector.listCampaigns(context(a.workspaceId))});
 app.post("/api/v1/internal/nexoffice/marketing/v1/prospecting/campaigns",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{return reply.code(201).send(await prospector.createCampaign(context(a.workspaceId),ProspectingCampaignInput.parse(request.body)))}catch(e){return prospectorFail(reply,e)}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/prospecting/campaigns/:id/leads",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{return await prospector.listLeads(context(a.workspaceId),String((request.params as any).id))}catch(e){return prospectorFail(reply,e)}});
 app.post("/api/v1/internal/nexoffice/marketing/v1/prospecting/campaigns/:id/leads",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{return reply.code(201).send(await prospector.addLead(context(a.workspaceId),{...ProspectingLeadInput.parse(request.body),campaignId:String((request.params as any).id)}))}catch(e){return prospectorFail(reply,e)}});
 app.post("/api/v1/internal/nexoffice/marketing/v1/prospecting/campaigns/:id/discover",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{const input=ProspectingDiscoveryInput.parse(request.body);return await prospector.discover(context(a.workspaceId),String((request.params as any).id),input.limit)}catch(e){return prospectorFail(reply,e)}});
 app.post("/api/v1/internal/nexoffice/marketing/v1/prospecting/leads/:id/approach",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{const input=ProspectingApproachInput.parse(request.body||{});return await prospector.prepareApproach(context(a.workspaceId),String((request.params as any).id),input.channel)}catch(e){return prospectorFail(reply,e)}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/content/drafts",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{return{requests:await content.list(contentWorkspaces.organizationId(a.workspaceId)),governance:{workspaceScoped:true,billingMode:"nexoffice_entitlement",modoCreditsCharged:0,publishing:false,externalPublication:false}}}catch(e){return contentFail(reply,e)}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/content/drafts/:id",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{const id=z.string().uuid().parse((request.params as any).id);return{request:await content.getForOrganization(id,contentWorkspaces.organizationId(a.workspaceId)),governance:{workspaceScoped:true,billingMode:"nexoffice_entitlement",modoCreditsCharged:0,publishing:false,externalPublication:false}}}catch(e){return contentFail(reply,e)}});
 app.post("/api/v1/internal/nexoffice/marketing/v1/content/drafts",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});const input=ContentDraftInput.parse(request.body);try{const brand=await contentWorkspaces.ensureBrand(a.workspaceId,{name:input.brandName,niche:input.niche,websiteUrl:input.websiteUrl,instagramHandle:input.instagramHandle}),id=randomUUID(),created=await content.create(id,brand.organizationId,{brandId:brand.id,contentType:input.contentType,objective:input.objective,brief:input.brief,channel:input.channel},0,1);void contentAutomation.dispatch(created,brand).catch(error=>request.log.error({error,contentRequestId:id,workspaceId:a.workspaceId},"Falha ao gerar draft NexOffice"));return reply.code(201).send({request:created,governance:{workspaceScoped:true,billingMode:"nexoffice_entitlement",modoCreditsCharged:0,publishing:false,externalPublication:false}})}catch(e){return contentFail(reply,e)}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/intelligence/market-radar/missions",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{const missions=(await intelligence.list(context(a.workspaceId).organization.id)).filter(item=>item.playbook==="market_radar");return{missions,governance:{workspaceScoped:true,readOnly:true,collectionRequiresExplicitApproval:true,externalCommunication:false}}}catch(e){return intelligenceFail(reply,e)}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/intelligence/market-radar/missions/:id/results",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});try{const id=z.string().uuid().parse((request.params as any).id),organizationId=context(a.workspaceId).organization.id,mission=await intelligence.get(id,organizationId);if(mission.playbook!=="market_radar")return reply.code(404).send({error:"market_radar_mission_not_found"});const limit=Math.min(200,Math.max(1,Number((request.query as any)?.limit||50))),result=await intelligence.results(id,organizationId,limit);return{...result,governance:{workspaceScoped:true,readOnly:true,externalCommunication:false}}}catch(e){return intelligenceFail(reply,e)}});
 app.post("/api/v1/internal/nexoffice/marketing/v1/intelligence/market-radar/missions",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});if(!intelligence.configuredPlaybooks().market_radar||intelligence.mode==="queue")return reply.code(503).send({error:"MARKET_RADAR_NOT_CONFIGURED",message:"O provider externo do Radar de Mercado ainda não está configurado."});const input=MarketRadarMissionInput.parse(request.body);try{const brandId=`nexoffice:${a.workspaceId}:primary`,mission=await intelligence.create(context(a.workspaceId).organization.id,`nexoffice:${a.workspaceId}:service`,{brandId,name:input.name,playbook:"market_radar",objective:input.objective,regions:input.regions,keywords:input.keywords,competitors:input.competitors,products:[],maxItems:input.maxItems},{id:brandId,name:input.brandName,niche:input.niche,websiteUrl:input.websiteUrl,instagramHandle:input.instagramHandle});return reply.code(201).send({mission,governance:{explicitApproval:true,providerCompute:mission.provider!=="queue",externalCommunication:false,workspaceScoped:true}})}catch(e){return intelligenceFail(reply,e)}});
 app.get("/api/v1/internal/nexoffice/marketing/v1/insights",async(request,reply)=>{const a=access(request,expectedKey);if(!a.ok)return reply.code(a.status).send({error:a.error});const ctx=context(a.workspaceId),projects=await demand.list(ctx),funnels=await Promise.all(projects.slice(0,50).map(async(p:any)=>({name:p.name,...await demand.funnel(ctx,p.id)})));let google:any=null;try{google=await googleAds.metrics(ctx,Number((request.query as any)?.days||30))}catch(e){if(!(e instanceof GoogleAdsError)||![409,503].includes(e.status))throw e}const demandTotals=funnels.reduce((s:any,f:any)=>({pageViews:s.pageViews+Number(f.pageViews||0),ctaClicks:s.ctaClicks+Number(f.ctaClicks||0),leads:s.leads+Number(f.leads||0),qualifiedLeads:s.qualifiedLeads+Number(f.qualifiedLeads||0),customers:s.customers+Number(f.customers||0)}),{pageViews:0,ctaClicks:0,leads:0,qualifiedLeads:0,customers:0});return{periodDays:Math.min(90,Math.max(1,Number((request.query as any)?.days||30))),projects:projects.length,funnels,demandTotals,googleAds:google,blended:google?{costMinor:google.costMinor,customers:demandTotals.customers,cacMinor:demandTotals.customers?Math.round(google.costMinor/demandTotals.customers):null,googleReportedRoas:google.roas,attribution:"workspace_blended_not_campaign_attributed"}:null,learningNote:"CAC combinado só é exibido quando há custo real do Google Ads e clientes registrados no funil da MODO. Não representa atribuição individual de campanha."}});
}