import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {BrandCreateRequestSchema,DiagnosticCreateRequestSchema,LeadCreateRequestSchema,LoginRequestSchema,RegisterRequestSchema,contentCreditCost,planEntitlements} from "@modo/contracts";
import {ContentRequestCreateSchema} from "@modo/contracts/content";
import Fastify,{type FastifyRequest} from "fastify";
import {randomUUID} from "node:crypto";
import type {DiagnosticProvider} from "./providers/diagnostic-provider.js";
import {assertPublicHttpUrl} from "./security/public-url.js";
import {AuthError,AuthService} from "./services/auth-service.js";
import {BillingError,BillingService} from "./services/billing-service.js";
import {ContentService} from "./services/content-service.js";
import {DiagnosticService} from "./services/diagnostic-service.js";
import {LeadService} from "./services/lead-service.js";

export interface CreateAppOptions{provider:DiagnosticProvider;allowedOrigins?:string[];logger?:boolean;databaseUrl?:string;databaseSsl?:boolean;sessionDays?:number;enableDemoBilling?:boolean}
const token=(r:FastifyRequest)=>{const h=r.headers.authorization;if(!h?.startsWith("Bearer "))throw new AuthError("UNAUTHORIZED",401,"Faça login para continuar.");return h.slice(7).trim()};

export async function createApp(o:CreateAppOptions){
 const app=Fastify({logger:o.logger??false});
 const diagnostics=new DiagnosticService(o.provider),leads=new LeadService();
 const billing=new BillingService({databaseUrl:o.databaseUrl,databaseSsl:o.databaseSsl});
 const auth=new AuthService({databaseUrl:o.databaseUrl,databaseSsl:o.databaseSsl,sessionDays:o.sessionDays});
 const content=new ContentService({databaseUrl:o.databaseUrl,databaseSsl:o.databaseSsl});
 await billing.initialize();await auth.initialize();await content.initialize();
 app.addHook("onClose",async()=>{await Promise.all([billing.close(),auth.close(),content.close()])});
 await app.register(helmet,{contentSecurityPolicy:false});
 await app.register(cors,{origin(origin,cb){const allowed=o.allowedOrigins??["http://localhost:5173"];if(!origin||allowed.includes("*")||allowed.includes(origin))return cb(null,true);cb(new Error("Origem não permitida."),false)}});
 await app.register(rateLimit,{max:80,timeWindow:"1 minute"});

 app.get("/health",async()=>({status:"ok",service:"modo-api",version:"0.4.0",billingStorage:billing.storage,accountStorage:auth.storage,contentStorage:content.storage}));
 app.get("/api/v1/plans",async()=>({plans:{start:planEntitlements.start,presenca:planEntitlements.presenca,pro:planEntitlements.pro,business:planEntitlements.business}}));

 app.post("/api/v1/auth/register",{config:{rateLimit:{max:8,timeWindow:"15 minutes"}}},async(r,reply)=>{const session=await auth.register(RegisterRequestSchema.parse(r.body));await billing.createOrUpdateDemoSubscription(session.organization.id,"trial");return reply.code(201).send(session)});
 app.post("/api/v1/auth/login",{config:{rateLimit:{max:12,timeWindow:"15 minutes"}}},async r=>auth.login(LoginRequestSchema.parse(r.body)));
 app.get("/api/v1/auth/me",async r=>auth.authenticate(token(r)));
 app.post("/api/v1/auth/logout",async(r,reply)=>{await auth.logout(token(r));return reply.code(204).send()});

 app.get("/api/v1/dashboard",async r=>{const ctx=await auth.authenticate(token(r));const[usage,brands]=await Promise.all([billing.getUsage(ctx.organization.id),auth.listBrands(ctx.organization.id)]);return{...ctx,usage,brands}});
 app.get("/api/v1/brands",async r=>{const ctx=await auth.authenticate(token(r));return{brands:await auth.listBrands(ctx.organization.id)}});
 app.post("/api/v1/brands",async(r,reply)=>{const ctx=await auth.authenticate(token(r)),input=BrandCreateRequestSchema.parse(r.body);if(input.websiteUrl)assertPublicHttpUrl(input.websiteUrl);const[brands,usage]=await Promise.all([auth.listBrands(ctx.organization.id),billing.getUsage(ctx.organization.id)]);if(brands.length>=usage.entitlements.maxBrands)throw new BillingError("BRAND_LIMIT_REACHED",409,"O limite de marcas do seu plano foi atingido.");return reply.code(201).send(await auth.createBrand(ctx.organization.id,input))});

 app.get("/api/v1/content-requests",async r=>{const ctx=await auth.authenticate(token(r));return{requests:await content.list(ctx.organization.id)}});
 app.post("/api/v1/content-requests",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async(r,reply)=>{const ctx=await auth.authenticate(token(r)),input=ContentRequestCreateSchema.parse(r.body),brands=await auth.listBrands(ctx.organization.id);if(!brands.some(b=>b.id===input.brandId))throw new AuthError("BRAND_NOT_FOUND",404,"Marca não encontrada nesta organização.");const id=randomUUID(),credits=contentCreditCost[input.contentType];const usage=await billing.consume(ctx.organization.id,{contentType:input.contentType,referenceId:`content_request:${id}`,metadata:{brandId:input.brandId,objective:input.objective,channel:input.channel}});const request=await content.create(id,ctx.organization.id,input,credits);return reply.code(201).send({request,usage})});

 app.post("/api/v1/diagnostics",{config:{rateLimit:{max:8,timeWindow:"10 minutes"}}},async(r,reply)=>{const input=DiagnosticCreateRequestSchema.parse(r.body);assertPublicHttpUrl(input.websiteUrl);const job=diagnostics.create(input);return reply.code(202).send({id:job.id,status:job.status,pollUrl:`/api/v1/diagnostics/${job.id}`})});
 app.get("/api/v1/diagnostics/:id",async(r,reply)=>{const job=diagnostics.get((r.params as{id:string}).id);return job??reply.code(404).send({code:"DIAGNOSTIC_NOT_FOUND",message:"Diagnóstico não encontrado."})});
 app.post("/api/v1/leads",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(r,reply)=>{const input=LeadCreateRequestSchema.parse(r.body);if(!diagnostics.get(input.diagnosticId))return reply.code(404).send({code:"DIAGNOSTIC_NOT_FOUND",message:"Diagnóstico não encontrado."});const lead=leads.create(input);r.log.info({leadId:lead.id},"Lead capturado");return reply.code(201).send({id:lead.id,status:"captured"})});

 app.setErrorHandler((e,_r,reply)=>{if(e instanceof BillingError||e instanceof AuthError)return reply.code(e.statusCode).send({code:e.code,message:e.message});const message=e instanceof Error?e.message:"Ocorreu um erro inesperado.",name=e instanceof Error?e.name:"UnknownError",validation=name==="ZodError"||message.includes("URL")||message.includes("Endereços");return reply.code(validation?400:500).send({code:validation?"INVALID_REQUEST":"INTERNAL_ERROR",message:validation?message:"Ocorreu um erro inesperado."})});
 return app;
}
