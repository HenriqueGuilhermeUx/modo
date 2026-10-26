import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classifyMobileAudit, collectExportEvidence } from "./modo-mobile-security-triage.mjs";

const report = (pairs) => {
  const entries=Object.fromEntries(pairs.map(([name,severity])=>[name,{
    severity, isDirect: name === "expo", range: "*", fixAvailable: false,
    via:[{url:"https://github.com/advisories/GHSA-86w9-cpqp-85rv"}],
  }]));
  const counts={info:0,low:0,moderate:0,high:0,critical:0};
  for(const [,sev] of pairs)counts[sev]++;
  return {metadata:{vulnerabilities:{...counts,total:pairs.length}},vulnerabilities:entries};
};

test("classifies known Expo toolchain packages without declaring shipped bundle safe",()=>{
  const r=classifyMobileAudit(report([["expo","high"],["node-forge","high"],["expo-router","moderate"]]));
  assert.equal(r.releaseBlocked,true);
  assert.equal(r.counts.high,2);
  assert.equal(r.actualShippedBundleExposureVerified,false);
  assert.equal(r.npmFixApplied,false);
  assert.equal(r.safeToDowngradeExpo,false);
  assert.equal(r.findings.find(p=>p.name==="node-forge").advisoryIds[0],"GHSA-86w9-cpqp-85rv");
});

test("invalid audit metadata cannot turn into a false clean status",()=>{
  assert.throws(()=>classifyMobileAudit({error:{code:"ENOAUDIT"}}),/UNAVAILABLE/);
  const fake=report([["zod","high"]]);
  fake.metadata.vulnerabilities.high=0;
  assert.throws(()=>classifyMobileAudit(fake),/MISMATCH/);
  const invalid=report([["node-forge","high"]]);
  invalid.vulnerabilities["node-forge"].severity="unsupported";
  assert.throws(()=>classifyMobileAudit(invalid),/BAD_PACKAGE/);
});

test("source-map inspection treats missing sources as inconclusive",async()=>{
  const temp=await mkdtemp(join(tmpdir(),"modo-mobile-audit-"));
  try {
    await mkdir(join(temp,"_expo","static","js"),{recursive:true});
    await writeFile(join(temp,"_expo","static","js","android.js"),"console.log('synthetic only')");
    let found=await collectExportEvidence(temp);
    assert.equal(found.expoAndroidExportGenerated,true);
    assert.equal(found.sourceMapCount,0);
    assert.equal(found.absenceProvesSafety,false);
    await writeFile(join(temp,"_expo","static","js","android.js.map"),
      JSON.stringify({version:3,sources:["../../node_modules/node-forge/lib/rsa.js"],names:[],mappings:""}));
    found=await collectExportEvidence(temp);
    assert.equal(found.sourceMapCount,1);
    assert.equal(found.potentialNodeForgePathHits.length,1);
    assert.equal(found.absenceProvesSafety,false);
  }finally{await rm(temp,{recursive:true,force:true});}
});
