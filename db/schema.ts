import { integer, sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  premise: text("premise").notNull().default(""),
  summary: text("summary").notNull().default(""),
  storyBible: text("story_bible").notNull().default(""),
  mainline: text("mainline").notNull().default(""),
  importantNotes: text("important_notes").notNull().default(""),
  genre: text("genre").notNull().default(""),
  style: text("style").notNull().default(""),
  bookOutline:text("book_outline").notNull().default(""),
  tags:text("tags").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
  workspaceId: text("workspace_id").notNull().default("legacy"),
  deletedAt: text("deleted_at"),
});

export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull().default("未命名章节"),
  synopsis: text("synopsis").notNull().default(""),
  body: text("body").notNull().default(""),
  bodyRevision:integer("body_revision").notNull().default(1),
  memoryRevision:integer("memory_revision").notNull().default(0),
  outlineRevision: integer("outline_revision").notNull().default(1),
  bodyOutlineRevision: integer("body_outline_revision"),
  continuityReview: integer("continuity_review").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
  memory: text("memory").notNull().default(""),
  deletedAt: text("deleted_at"),
}, (table) => [index("idx_chapters_project_position").on(table.projectId, table.position)]);

export const loreCards = sqliteTable("lore_cards", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  category: text("category").notNull().default("rule"),
  content: text("content").notNull().default(""),
  fromChapter: integer("from_chapter"),
  untilChapter: integer("until_chapter"),
  done: integer("done").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  goal: text("goal").notNull().default(""),
  traits: text("traits").notNull().default(""),
  relationships: text("relationships").notNull().default(""),
  secret: text("secret").notNull().default(""),
  arc: text("arc").notNull().default(""),
  fromChapter: integer("from_chapter"),
  untilChapter: integer("until_chapter"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_characters_project").on(table.projectId)]);

export const projectSnapshots = sqliteTable("project_snapshots", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export const generationDrafts = sqliteTable("generation_drafts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  targetId: text("target_id"),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const generationQuota = sqliteTable("generation_quota", {
  day: text("day").notNull(),
  workspaceId: text("workspace_id").notNull(),
  calls: integer("calls").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.day, table.workspaceId] })]);

export const settingEntries=sqliteTable("setting_entries",{
 id:text("id").primaryKey(),projectId:text("project_id").notNull().references(()=>projects.id),
 kind:text("kind").notNull(),name:text("name").notNull(),aliases:text("aliases").notNull().default("[]"),
 content:text("content").notNull(),status:text("status").notNull().default("candidate"),hard:integer("hard").notNull().default(0),
 revealPosition:integer("reveal_position"),revealChapterId:text("reveal_chapter_id"),sourceChapterId:text("source_chapter_id"),sourceRevision:integer("source_revision"),
 evidence:text("evidence").notNull().default(""),version:integer("version").notNull().default(1),updatedAt:text("updated_at").notNull()
},table=>[index("idx_setting_project").on(table.projectId,table.status)]);
export const settingVersions=sqliteTable("setting_versions",{
 entryId:text("entry_id").notNull(),version:integer("version").notNull(),payload:text("payload").notNull(),createdAt:text("created_at").notNull()
},table=>[primaryKey({columns:[table.entryId,table.version]})]);
export const chapterMemories=sqliteTable("chapter_memories",{
 chapterId:text("chapter_id").primaryKey().references(()=>chapters.id),projectId:text("project_id").notNull().references(()=>projects.id),
 bodyRevision:integer("body_revision").notNull(),summary:text("summary").notNull(),facts:text("facts").notNull().default(""),
 candidates:text("candidates").notNull().default("[]"),updatedAt:text("updated_at").notNull()
});
export const referenceRuns=sqliteTable("reference_runs",{
 id:text("id").primaryKey(),projectId:text("project_id").notNull().references(()=>projects.id),chapterId:text("chapter_id"),
 kind:text("kind").notNull(),snapshot:text("snapshot").notNull(),refs:text("refs").notNull(),
 stale:integer("stale").notNull().default(0),adopted:integer("adopted").notNull().default(0),createdAt:text("created_at").notNull()
},table=>[index("idx_reference_project").on(table.projectId,table.chapterId)]);
export const consistencyChecks=sqliteTable("consistency_checks",{
 id:text("id").primaryKey(),projectId:text("project_id").notNull().references(()=>projects.id),chapterId:text("chapter_id"),runId:text("run_id"),
 draftHash:text("draft_hash").notNull(),findings:text("findings").notNull(),resolutions:text("resolutions").notNull().default("{}"),
 stale:integer("stale").notNull().default(0),createdAt:text("created_at").notNull()
});
export const extractionJobs=sqliteTable("extraction_jobs",{
 id:text("id").primaryKey(),projectId:text("project_id").notNull().references(()=>projects.id),chapters:text("chapters").notNull(),
 kind:text("kind").notNull().default("extract"),status:text("status").notNull().default("paused"),completed:text("completed").notNull().default("{}"),
 error:text("error").notNull().default(""),leaseOwner:text("lease_owner").notNull().default(""),leaseUntil:integer("lease_until").notNull().default(0),
 updatedAt:text("updated_at").notNull()
});
