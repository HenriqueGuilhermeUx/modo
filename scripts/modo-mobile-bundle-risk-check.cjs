"use strict";

const fs=require("node:fs");
const path=require("node:path");

function walk(base,limit=2000) {
  const items=[];
  const pending=[base];
  while(pending.length) {
    const folder=pending.pop();
    for(const entry of fs.readdirSync(folder,{withFileTypes:true})) {
      const full=path.join(folder,entry.name);
      if(entry.isDirectory())pending.push(full);
      else if(entry.isFile() && /\.(?:js|bundle|hbc)$/.test(entry.name)) items.push(full);
      if(items.length>limit)throw new Error("MODO_MOBILE_EXPORTED_FILES_LIMIT");
    }
  }
  return items;
}

function inspectBundle(base) {
  if(!fs.existsSync(base) || !fs.statSync(base).isDirectory())
    throw new Error("MODO_MOBILE_BUNDLE_DIRECTORY_MISSING");
  const files=walk(base);
  if(!files.length)throw new Error("MODO_MOBILE_NO_JS_BUNDLE");
  let inspectedBytes=0;
  const signatures=[
    {key:"node-forge literal",expr:/node-forge/gi},
    {key:"forge rsa calls",expr:/forge[.]rsa[.]/gi},
    {key:"Expo code signing module",expr:/@expo\/code-signing-certificates/gi},
  ];
  const matched=[];
  for(const file of files) {
    const data=fs.readFileSync(file);
    if(data.length>60*1024*1024)throw new Error("MODO_MOBILE_BUNDLE_TOO_LARGE");
    inspectedBytes+=data.length;
    const body=data.toString("utf8");
    for(const signature of signatures) {
      if(signature.expr.test(body))
        matched.push({file:path.relative(base,file),signature:signature.key});
      signature.expr.lastIndex=0;
    }
  }
  return {
    platform:"android",
    javascriptBundleFiles:files.length,
    bytesInspected:inspectedBytes,
    signaturesFound:matched,
    sourceMapInspected:false,
    nativeBinaryInspected:false,
    vulnerableFunctionReachabilityProven:false,
    // Do not conflate absence of vendor names with secure cryptographic code.
    absentStringDoesNotProveSafe:true,
    productChangeAllowed:false,
  };
}

if(require.main===module){
  try {
    const [base,out]=process.argv.slice(2);
    if(!base||!out)throw new Error("MODO_MOBILE_BUNDLE_ARGS_REQUIRED");
    const report=inspectBundle(base);
    fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n",{mode:0o600});
    console.log(JSON.stringify({platform:report.platform,
      javascriptBundleFiles:report.javascriptBundleFiles,
      signaturesFound:report.signaturesFound.length,
      nativeBinaryInspected:false}));
  }catch(error){console.error(error);process.exitCode=1;}
}

module.exports={inspectBundle};
