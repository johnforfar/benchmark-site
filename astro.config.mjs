import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  vite: { 
    plugins: [tailwindcss()],
    ssr: {
      noExternal: true
    },
   },
  // Baked into the standalone server at build time: the deploy sets no
  // HOST/PORT, and the reverse proxy reaches this over the container's
  // interface, so loopback-only would refuse the connection.
  server: { host: "0.0.0.0", port: 3000 },
});
