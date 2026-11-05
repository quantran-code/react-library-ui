import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The UI talks to the gateway, never to a service directly. VITE_API_BASE_URL
// keeps the address out of the build.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
