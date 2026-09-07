import { describe, expect, it } from "vitest";
import { ApifyProspectorProvider } from "./services/prospector-provider.js";

describe("ApifyProspectorProvider",()=>{
 it("reports configuration state",()=>{
  expect(new ApifyProspectorProvider({}).configured).toBe(false);
  expect(new ApifyProspectorProvider({token:"x",actorId:"actor"}).configured).toBe(true);
 });
});