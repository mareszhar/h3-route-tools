import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  compatibilityDate: "latest",
  errorHandler: "./error.ts",
  experimental: {
    asyncContext: true,
  },
});
