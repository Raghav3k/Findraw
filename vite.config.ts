import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const skipPublicCopy = process.env.CF_PAGES === "1" || process.env.FINDRAW_SKIP_PUBLIC === "1";

export default defineConfig({
  publicDir: skipPublicCopy ? false : "public",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/auth": "http://127.0.0.1:3000",
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
});
