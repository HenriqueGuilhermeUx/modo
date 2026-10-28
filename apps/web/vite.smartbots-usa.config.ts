import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: { outDir: "dist-smartbots-usa", emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, "smartbots-usa.html") } },
});
