import fs from "node:fs";

const path = "apps/api/src/services/canva-service.ts";
const current = fs.readFileSync(path, "utf8");
const before = `      body: data,`;
const after = `      body: Uint8Array.from(data).buffer,`;
if (!current.includes(before)) throw new Error("Trecho de upload Canva não encontrado.");
fs.writeFileSync(path, current.replace(before, after));
