const fs = require('node:fs');
const [file, output] = process.argv.slice(2);
if (!file || !output) throw new Error('AUDIT_ARGS_REQUIRED');
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!raw || !raw.metadata || !raw.metadata.vulnerabilities || typeof raw.vulnerabilities !== 'object') {
  throw new Error('AUDIT_REPORT_UNAVAILABLE');
}
const severity = ['critical','high','moderate','low','info'];
const counts = Object.fromEntries(severity.map(s => [s,raw.metadata.vulnerabilities[s]]));
if (Object.values(counts).some(c => !Number.isInteger(c) || c < 0)) throw new Error('AUDIT_COUNTS_INVALID');
const entries=Object.entries(raw.vulnerabilities).map(([name, v])=>({
  name, severity:v.severity, affectedRange:typeof v.range==='string'?v.range:null,
  advisories:(Array.isArray(v.via)?v.via:[]).filter(a=>a&&typeof a==='object').map(a=>({
    id:typeof a.url==='string'?(a.url.match(/GHSA-[a-z0-9-]+/i)||[])[0]||null:null,
    range:typeof a.range==='string'?a.range:null,
  })),
}));
if (raw.metadata.vulnerabilities.total !== entries.length) throw new Error('AUDIT_COUNT_MISMATCH');
const blocked=counts.high+counts.critical>0;
const report={scope:'MODO API installed production dependency tree (CI)',counts,
  blocked,requiresManualReachabilityReview:true,dependenciesChangedInProduction:false,entries};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({scope:report.scope,counts,blocked,entries}));
if (blocked) process.exitCode=2;
