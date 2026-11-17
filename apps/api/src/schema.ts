import { pgTable, text, jsonb, integer } from "drizzle-orm/pg-core";
export const records = pgTable("records", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  body: jsonb("body").notNull(),
  version: integer("version").notNull().default(0),
});
