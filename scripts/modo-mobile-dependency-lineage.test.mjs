import { test } from "node:test";
import assert from "node:assert/strict";
import { traceMobileAuditDependencyPaths } from "./modo-mobile-dependency-lineage.mjs";

const lock = {
  lockfileVersion:3,
  packages:{
    "apps/mobile": { dependencies: {expo:"~57.0.9", "@modo/contracts":"*"} },
    "node_modules/@modo/contracts": { link:true, resolved:"packages/contracts" },
    "packages/contracts": { version:"0.9.0" },
    "node_modules/expo": {version:"57.0.31",dependencies:{"@expo/cli":"57.0.32"}},
    "node_modules/expo/node_modules/@expo/cli": {
      version:"57.0.32",dependencies:{"@expo/code-signing-certificates":"0.0.6"}
    },
    "node_modules/@expo/code-signing-certificates": {
      version:"0.0.6",dependencies:{"node-forge":"^1.4.0"}
    },
    "node_modules/node-forge": {version:"1.4.0"},
    "node_modules/zod": {version:"4.6.7"}
  }
};
const audit={metadata:{vulnerabilities:{critical:0,high:2,moderate:0,low:0,info:0,total:2}},
  vulnerabilities:{
    "node-forge":{severity:"high",via:[{url:"https://github.com/advisories/GHSA-86w9-cpqp-85rv"}]},
    "expo":{severity:"high",via:[]}
  }};

test("trace Expo CLI signing dependency from mobile without asserting shipped exposure",()=>{
  const r=traceMobileAuditDependencyPaths(lock,audit);
  const forge=r.findings.find(f=>f.package==="node-forge");
  assert.deepEqual(forge.shortestPath,[
    "apps/mobile@unknown","expo@57.0.31","@expo/cli@57.0.32",
    "@expo/code-signing-certificates@0.0.6","node-forge@1.4.0"
  ]);
  assert.equal(forge.installedVersion,"1.4.0");
  assert.deepEqual(forge.advisoryIds,["GHSA-86w9-cpqp-85rv"]);
  assert.equal(r.releaseBlocked,true);
  assert.equal(r.safeToSignOrPublish,false);
  assert.equal(r.notProofOfShippedBundleReachability,true);
  assert.deepEqual(r.unresolved,[]);
});
test("do not assume missing package path is safe",()=>{
  const a=structuredClone(audit);
  a.vulnerabilities.zod={severity:"high",via:[]};
  const r=traceMobileAuditDependencyPaths(lock,a);
  assert.deepEqual(r.unresolved,["zod"]);
  assert.equal(r.findings.find(x=>x.package==="zod").graphResolution,"requires-manual-review");
  assert.equal(r.safeToSignOrPublish,false);
});
test("refuse incomplete or corrupt lockfiles",()=>{
  assert.throws(()=>traceMobileAuditDependencyPaths({packages:{}},audit),/INVALID_SOURCE/);
  const bad=structuredClone(lock);
  bad.packages["node_modules/@modo/contracts"].resolved="absent";
  assert.throws(()=>traceMobileAuditDependencyPaths(bad,audit),/LINK_UNRESOLVED/);
});
