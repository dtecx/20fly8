import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 2048,
    strictPort: true,
    watch: { usePolling: process.env.CHOKIDAR_USEPOLLING === "true" },
  },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
