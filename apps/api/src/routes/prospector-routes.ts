import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthService } from "../services/auth-service.js";
import { ProspectorError, ProspectorService, type ProspectorLeadStatus } from "../services/prospector-service.js";

function bearer(request:FastifyRequest){const value=request.headers.authorization;if(!value?.startsWith("Bearer "))throw new ProspectorError("UNAUTHORIZED",401,"Faça login para continuar.");return value.slice(7).trim()}

export async function registerProspectorRoutes(app:FastifyInstance,deps:{auth:AuthService;prospector:ProspectorService}){
 const userFor=async(request:FastifyRequest)=>deps.auth.getSession(bearer(request));
 app.get("/api/v1/prospector/health",async()=>({status:"ok",storage:deps.prospector.storage,capabilities:["icp","campaigns","leads","fit-score","lead-status"],provider:"manual"}));
 app.get("/api/v1/prospector/campaigns",async(request,reply)=>{try{return await deps.prospector.listCampaigns(await userFor(request))}catch(error){if(error instanceof ProspectorError)return reply.code(error.status).send({code:error.code,message:error.message});throw error}});
 app.post("/api/v1/prospector/campaigns",async(request,reply)=>{try{return reply.code(201).send(await deps.prospector.createCampaign(await userFor(request),request.body as any))}catch(error){if(error instanceof ProspectorError)return reply.code(error.status).send({code:error.code,message:error.message});throw error}});
 app.get("/api/v1/prospector/campaigns/:id/leads",async(request,reply)=>{try{const {id}=request.params as {id:string};return await deps.prospector.listLeads(await userFor(request),id)}catch(error){if(error instanceof ProspectorError)return reply.code(error.status).send({code:error.code,message:error.message});throw error}});
 app.post("/api/v1/prospector/campaigns/:id/leads",async(request,reply)=>{try{const {id}=request.params as {id:string};return reply.code(201).send(await deps.prospector.addLead(await userFor(request),{...(request.body as any),campaignId:id}))}catch(error){if(error instanceof ProspectorError)return reply.code(error.status).send({code:error.code,message:error.message});throw error}});
 app.patch("/api/v1/prospector/leads/:id/status",async(request,reply)=>{try{const {id}=request.params as {id:string};const {status}=request.body as {status:ProspectorLeadStatus};return await deps.prospector.updateLeadStatus(await userFor(request),id,status)}catch(error){if(error instanceof ProspectorError)return reply.code(error.status).send({code:error.code,message:error.message});throw error}});
}