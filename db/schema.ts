import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  premise: text("premise").notNull().default(""),
  summary: text("summary").notNull().default(""),
  importantNotes: text("important_notes").notNull().default(""),
  genre: text("genre").notNull().default(""),
  style: text("style").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull().default("未命名章节"),
  synopsis: text("synopsis").notNull().default(""),
  body: text("body").notNull().default(""),
  outlineRevision: integer("outline_revision").notNull().default(1),
  bodyOutlineRevision: integer("body_outline_revision"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_chapters_project_position").on(table.projectId, table.position)]);
