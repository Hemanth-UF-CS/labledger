import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two apps share one toolchain and the components in src/shared.
const app = process.env.APP === "field" ? "field" : "registry";

export default defineConfig({
  root: resolve(__dirname, "apps", app),
  envDir: __dirname,
  publicDir: resolve(__dirname, "public", app),
  plugins: [react()],
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  server: { fs: { allow: [__dirname] } },
  build: { outDir: resolve(__dirname, "dist", app), emptyOutDir: true },
});
