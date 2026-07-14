import { universalOverlay } from "@example/universal-overlay";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [universalOverlay().vite(), reactRouter()],
});
