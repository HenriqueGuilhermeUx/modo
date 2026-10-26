const {test}=require("node:test");
const assert=require("node:assert/strict");
const {summarizeAudit,verifyMobileSdk}=require("./modo-mobile-security-audit.cjs");
const sample=(entries)=>({metadata:{vulnerabilities:{
 critical:0,high:entries.filter(v=>v[1].severity==="high").length,
 moderate:entries.filter(v=>v[1].severity==="moderate").length,
 low:0,info:0,total:entries.length,
}},vulnerabilities:Object.fromEntries(entries)});
test("mobile high advisory remains blocked; no broad waiver",()=>{
 const r=summarizeAudit(sample([
  ["node-forge",{severity:"high",isDirect:false,via:[{
    url:"https://github.com/advisories/GHSA-86w9-cpqp-85rv"}]}],
  ["decode-uri-component",{severity:"moderate",isDirect:false,via:[]}],
 ]));
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.shippedAppArtifactAnalyzed,false);
 assert.deepEqual(r.releaseBlocking[0].advisoryIds,["GHSA-86w9-cpqp-85rv"]);
});
test("incomplete or contradictory audit reports are never green",()=>{
 assert.throws(()=>summarizeAudit({error:"registry down"}),/UNAVAILABLE/);
 const a=sample([["zod",{severity:"high",via:[]}]]);
 a.metadata.vulnerabilities.total=0;
 assert.throws(()=>summarizeAudit(a),/INCONSISTENT/);
});
test("native ABI cannot silently shift away from SDK 57 / React Native 0.86.3",()=>{
 const a={packages:{"node_modules/expo":{version:"57.0.31"},
  "node_modules/react-native":{version:"0.86.3"},
  "node_modules/react":{version:"19.2.3"}}};
 const p={dependencies:{expo:"~57.0.31","react-native":"0.86.3",react:"19.2.3"}};
 assert.equal(verifyMobileSdk(a,p).expo,"57.0.31");
 a.packages["node_modules/react-native"].version="0.87.0";
 assert.throws(()=>verifyMobileSdk(a,p),/NATIVE_VERSION_DRIFT/);
});
