import assert from "node:assert/strict";
import {test} from "node:test";
import {summarizeAudit,buildTriage,triageMarkdown} from "./hyperframes-dependency-audit-triage.mjs";

const source=(entries={})=>({
  metadata:{vulnerabilities:{
    info:0,low:0,moderate:0,high:Object.values(entries).filter(x=>x.severity==="high").length,
    critical:Object.values(entries).filter(x=>x.severity==="critical").length,
    total:Object.keys(entries).length,
  }},vulnerabilities:entries,
});
test("separates critical dev-only candidates from runtime release blockers",()=>{
  const a=summarizeAudit(source({
    vitest:{severity:"critical",isDirect:true,fixAvailable:false},
    "@remotion/bundler":{severity:"high",isDirect:true,fixAvailable:false},
  }),"all");
  const api=summarizeAudit(source({"@remotion/bundler":{
    severity:"high",isDirect:true,fixAvailable:false}}),"api");
  const web=summarizeAudit(source(),"web");
  const mobile=summarizeAudit(source(),"mobile");
  const r=buildTriage([a,api,web,mobile]);
  assert.equal(r.productionRuntimeReleaseBlocked,true);
  assert.deepEqual(r.criticalDevOnlyCandidates,["vitest"]);
  assert.equal(r.releaseBlockers.length,1);
  assert.match(triageMarkdown(r),/BLOCKED/);
});
test("refuses invalid or contradictory audit data instead of falsely approving",()=>{
  assert.throws(()=>summarizeAudit({error:{code:"ENOAUDIT"}},"api"),/REPORT_INVALID/);
  assert.throws(()=>summarizeAudit(source({zod:{severity:"high",isDirect:true,fixAvailable:false}}),"wrong"),/REPORT_INVALID/);
  const broken=source({zod:{severity:"high",isDirect:true,fixAvailable:false}});
  broken.metadata.vulnerabilities.total=0;
  assert.throws(()=>summarizeAudit(broken,"api"),/COUNT_MISMATCH/);
  assert.throws(()=>buildTriage([
    summarizeAudit(source(),"all"),
    summarizeAudit(source(),"api"),
    summarizeAudit(source(),"api"),
    summarizeAudit(source(),"mobile"),
  ]),/SCOPES_DUPLICATED/);
});
