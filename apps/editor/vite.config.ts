import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.SITECRAFT_API_URL ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: Object.fromEntries(["/api", "/preview", "/s/", "/forms", "/media"].map((p) => [p, { target: api, changeOrigin: true }])),
  },
  build: { outDir: "dist", sourcemap: true },
});
