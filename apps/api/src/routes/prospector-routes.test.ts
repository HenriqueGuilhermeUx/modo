import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerProspectorRoutes } from "./prospector-routes.js";
import { ProspectorService } from "../services/prospector-service.js";

describe("prospector routes",()=>{
 it("exposes provider health",async()=>{
  const app=Fastify();
  const prospector=new ProspectorService({});
  await registerProspectorRoutes(app,{auth:{authenticate:async()=>({organization:{id:"org"}})} as any,prospector});
  const response=await app.inject({method:"GET",url:"/api/v1/prospector/health"});
  expect(response.statusCode).toBe(200);
  expect(response.json().capabilities).toContain("discovery");
  await app.close();
 });
});