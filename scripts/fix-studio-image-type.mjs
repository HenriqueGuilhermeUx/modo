import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const path = "apps/web/src/StudioWorkspace.tsx";
let source = readFileSync(path, "utf8");
const oldBlock = `  backgroundImage?: CanvasImageSource,\n) {\n`;
const newBlock = `  backgroundImage?: HTMLImageElement,\n) {\n`;
if (!source.includes(oldBlock)) throw new Error("Studio background image type marker not found.");
source = source.replace(oldBlock, newBlock);
const oldDimensions = `    const sourceWidth = "naturalWidth" in backgroundImage ? backgroundImage.naturalWidth : backgroundImage.width;\n    const sourceHeight = "naturalHeight" in backgroundImage ? backgroundImage.naturalHeight : backgroundImage.height;\n`;
const newDimensions = `    const sourceWidth = backgroundImage.naturalWidth;\n    const sourceHeight = backgroundImage.naturalHeight;\n`;
if (!source.includes(oldDimensions)) throw new Error("Studio image dimensions marker not found.");
source = source.replace(oldDimensions, newDimensions);
writeFileSync(path, source);
unlinkSync("scripts/fix-studio-image-type.mjs");
unlinkSync(".github/workflows/fix-studio-image-type.yml");
console.log("Studio image type fixed.");
