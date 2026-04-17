import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/main/db/schema.ts",
  out: "./drizzle",
});
