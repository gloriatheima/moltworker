import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import { cloudflare } from "@cloudflare/vite-plugin"

export default defineConfig({
	base: "/_admin/",
	plugins: [
		vue(),
		cloudflare({
			configPath: "./wrangler.jsonc",
			persistState: false,
		}),
	],
})
