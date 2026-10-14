import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "runtime-manifest-in-development",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url?.split("?")[0] !== "/imd-deployment.json")
            return next();
          try {
            const bytes = await readFile(
              new URL("../dist/imd-deployment.json", import.meta.url),
            );
            response.setHeader("Content-Type", "application/json");
            response.end(bytes);
          } catch {
            response.statusCode = 503;
            response.end("Build the static export first.");
          }
        });
      },
    },
  ],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 750,
  },
});
