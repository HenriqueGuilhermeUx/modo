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
      version:"57.0.32",dependencies:{"@expo/code-signing-certificates":"0.0.6","zod":"^3.25.76"}
    },
    "node_modules/expo/node_modules/zod": {version:"3.25.76"},
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
test("lists every installed Zod copy, including vulnerable Expo transitive version",()=>{
  const a=structuredClone(audit);
  a.vulnerabilities.zod={severity:"high",via:[{url:"https://github.com/advisories/GHSA-mrhx-c7xc-m3w5"}]};
  const extra=structuredClone(lock);
  extra.packages["packages/contracts"].dependencies={"zod":"^4"};
  const r=traceMobileAuditDependencyPaths(extra,a);
  const zod=r.findings.find(x=>x.package==="zod");
  assert.deepEqual(zod.installedVersions.sort(),["3.25.76","4.6.7"].sort());
  assert.equal(zod.multipleInstalledVersions,true);
  assert.equal(zod.allInstalledInstances.length,2);
  assert.ok(zod.allInstalledInstances.some(x=>
    x.path==="node_modules/expo/node_modules/zod" && x.version==="3.25.76"));
  assert.equal(r.releaseBlocked,true);
  assert.equal(r.safeToSignOrPublish,false);
});

test("refuse incomplete or corrupt lockfiles",()=>{
  assert.throws(()=>traceMobileAuditDependencyPaths({packages:{}},audit),/INVALID_SOURCE/);
  const bad=structuredClone(lock);
  bad.packages["node_modules/@modo/contracts"].resolved="absent";
  assert.throws(()=>traceMobileAuditDependencyPaths(bad,audit),/LINK_UNRESOLVED/);
});
