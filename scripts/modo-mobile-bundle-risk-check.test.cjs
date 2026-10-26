const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {inspectBundle}=require("./modo-mobile-bundle-risk-check.cjs");

test("reports suspicious vendor strings without claiming full security proof",()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"modo-bundle-risk-test-"));
 try{
   fs.writeFileSync(path.join(folder,"index.js"),
     'console.log("@expo/code-signing-certificates and node-forge");');
   const result=inspectBundle(folder);
   assert.equal(result.javascriptBundleFiles,1);
   assert.equal(result.nativeBinaryInspected,false);
   assert.equal(result.absentStringDoesNotProveSafe,true);
   assert.equal(result.signaturesFound.length,2);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test("fails on no JS bundle rather than approving missing output",()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"modo-bundle-risk-test-"));
 try{assert.throws(()=>inspectBundle(folder),/NO_JS_BUNDLE/);}
 finally{fs.rmSync(folder,{recursive:true,force:true});}
});
