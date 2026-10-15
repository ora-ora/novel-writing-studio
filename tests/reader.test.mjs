import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { batchAround, fetchChapterBatch, hasBody } from "../lib/chapters.ts";

const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const anotherWorkspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const root = path.resolve(import.meta.dirname, "..");

// Run the actual route modules against a real SQLite schema, with an offline
// Workers binding. No preview server, production credentials, or model calls.
async function harness() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of (await readdir(path.join(root, "drizzle"))).filter(f => f.endsWith(".sql") && f !== "0009_shared_workspace.sql").sort()) {
    sqlite.exec(await readFile(path.join(root, "drizzle", file), "utf8"));
  }
  const binding = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async run() { return { meta: { changes: sqlite.prepare(sql).run(...args).changes } }; },
      };
    },
    async batch(statements) { const results = []; for (const statement of statements) results.push(await statement.run()); return results; },
  };
  const insertProject = sqlite.prepare("INSERT INTO projects (id,title,updated_at,workspace_id) VALUES (?,?,?,?)");
  insertProject.run("novel", "测试小说", "2026-10-15", workspace);
  insertProject.run("private", "原另一浏览器作品", "2026-10-15", anotherWorkspace);
  insertProject.run("trash", "已删除作品", "2026-10-15", anotherWorkspace);
  sqlite.prepare("UPDATE projects SET deleted_at=? WHERE id=?").run("2026-10-15", "trash");
  const insertChapter = sqlite.prepare("INSERT INTO chapters (id,project_id,position,title,synopsis,body,memory,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 165; i++) insertChapter.run(`c${i}`, "novel", i, `CHAPTER_${i}`, `SYNOPSIS_${i}`, `BODY_${i}\nPREVIOUS_END_${i}`, `MEMORY_${i}`, "2026-10-15", null);
  insertChapter.run("removed", "novel", 165, "已删除", "SECRET_DELETED", "SECRET_DELETED_BODY", "", "2026-10-15", "2026-10-15");
  insertChapter.run("foreign", "private", 0, "私人章节", "SECRET_PRIVATE", "SECRET_PRIVATE_BODY", "", "2026-10-15", null);
  insertChapter.run("trash-chapter", "trash", 0, "删除作品内正文", "", "PRESERVED_DELETED_BODY", "", "2026-10-15", null);
  const legacyProject = sqlite.prepare("SELECT * FROM projects WHERE id=?").get("novel");
  const legacyChapters = sqlite.prepare("SELECT * FROM chapters WHERE project_id=? AND deleted_at IS NULL ORDER BY position").all("novel");
  sqlite.prepare("INSERT INTO project_snapshots (id,project_id,reason,payload,created_at) VALUES (?,?,?,?,?)").run("before-sharing", "novel", "共享前版本", JSON.stringify({ project: legacyProject, chapters: legacyChapters }), "2026-10-15");
  sqlite.prepare("INSERT INTO generation_drafts (id,project_id,kind,content,created_at) VALUES (?,?,?,?,?)").run("old-draft", "novel", "body", "PRESERVED_DRAFT", "2026-10-15");
  sqlite.exec(await readFile(path.join(root, "drizzle/0009_shared_workspace.sql"), "utf8"));
  const prompts = [];
  const context = vm.createContext({
    Request, Response, Headers, URL, TextEncoder, TextDecoder, ReadableStream, AbortController,
    crypto: globalThis.crypto, setTimeout, clearTimeout, console,
    fetch: async (_url, options) => {
      const payload = JSON.parse(options.body);
      const prompt = payload.messages[1].content; prompts.push(prompt);
      return Response.json({ choices: [{ message: { content: prompt.includes("JSON 数组") ? '[{"title":"离线大纲","synopsis":"测试"}]' : "离线测试稿" } }] });
    },
  });
  const modules = new Map();
  const workers = new vm.SyntheticModule(["env"], function () { this.setExport("env", { DB: binding, DEEPSEEK_API_KEY: "offline-hosted-key" }); }, { context });
  async function load(file) {
    if (modules.has(file)) return modules.get(file);
    const source = await readFile(file, "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const module = new vm.SourceTextModule(code, { context, identifier: file }); modules.set(file, module);
    await module.link((name, importer) => name === "cloudflare:workers" ? workers : load(path.resolve(path.dirname(importer.identifier), name + ".ts")));
    await module.evaluate(); return module;
  }
  const route = await load(path.join(root, "app/api/workspace/route.ts"));
  const generate = await load(path.join(root, "app/api/generate/route.ts"));
  function get(params = {}, identity = workspace) {
    return route.namespace.GET(new Request(`https://novel.test/api/workspace?${new URLSearchParams({ view: "catalog", ...params })}`, { headers: identity ? { cookie: `novel_ws=${identity}` } : {} }));
  }
  function post(fields, identity = workspace) {
    return route.namespace.POST(new Request("https://novel.test/api/workspace", { method: "POST", headers: { ...(identity ? { cookie: `novel_ws=${identity}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(fields) }));
  }
  function ai(fields = {}, identity = workspace) {
    return generate.namespace.POST(new Request("https://novel.test/api/generate", { method: "POST", headers: { ...(identity ? { cookie: `novel_ws=${identity}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ kind: "body", projectId: "novel", selected: { id: "c164" }, chapters: [], endpoint: "https://model.example.test/v1/chat/completions", key: "offline-test-only", model: "offline", ...fields }) }));
  }
  return { get, post, ai, prompts, database: sqlite, close: () => sqlite.close() };
}

test("shared directory is lightweight, merges former workspaces, and excludes deleted data", async () => {
  const h = await harness();
  try {
    const response = await h.get(); const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.chapters.length, 166);
    assert.equal(data.projects.length, 2);
    assert.ok(data.chapters.every(c => c.body === "" && c.synopsis === "" && !c.body_loaded && c.body_length > 0));
    assert.ok(!JSON.stringify(data).includes("SECRET_PRIVATE"));
    assert.equal(data.drafts[0].content, "PRESERVED_DRAFT");
    assert.equal(data.snapshots[0].id, "before-sharing");
  } finally { h.close(); }
});

test("chapter batches preserve requested order and outline batches do not fetch body content", async () => {
  const h = await harness();
  try {
    const outline = await (await h.get({ view: "chapters", projectId: "novel", ids: "c164,c2,c80", content: "outline" })).json();
    assert.deepEqual(outline.chapters.map(c => c.id), ["c164", "c2", "c80"]);
    assert.equal(outline.chapters[0].synopsis, "SYNOPSIS_164"); assert.equal(outline.chapters[0].body, "");
    assert.equal(outline.chapters[0].body_loaded, false);
    const body = await (await h.get({ view: "chapters", projectId: "novel", ids: "c80,c164", content: "body" })).json();
    assert.match(body.chapters[1].body, /BODY_164/); assert.equal(body.chapters[1].body_loaded, true);
  } finally { h.close(); }
});

test("older open clients retain the full workspace response until they refresh", async () => {
  const h = await harness();
  try {
    const data = await (await h.get({ view: "" })).json();
    assert.equal(data.chapters[0].body, "BODY_0\nPREVIOUS_END_0");
    assert.equal(data.chapters[0].synopsis, "SYNOPSIS_0");
    assert.equal(data.chapters[0].body_loaded, true);
  } finally { h.close(); }
});

test("shared batches still enforce project membership, removed IDs, and batch limits", async () => {
  const h = await harness();
  try {
    assert.equal((await h.get({ view: "chapters", projectId: "private", ids: "foreign", content: "body" }, null)).status, 200);
    assert.equal((await h.get({ view: "chapters", projectId: "trash", ids: "trash-chapter", content: "body" })).status, 404);
    for (const ids of ["removed", "foreign", "c0') OR 1=1 --"]) assert.equal((await h.get({ view: "chapters", projectId: "novel", ids, content: "body" })).status, 409);
    for (const ids of ["c0,c0", Array.from({ length: 21 }, (_,i) => `c${i}`).join(",")]) assert.equal((await h.get({ view: "chapters", projectId: "novel", ids })).status, 400);
  } finally { h.close(); }
});

test("complete chapter traversal retrieves every body regardless of current reading page", async () => {
  const h = await harness();
  try {
    const catalog = (await (await h.get()).json()).chapters.filter(c => c.project_id === "novel");
    const fetched = [];
    for (let i = 0; i < catalog.length; i += 3) {
      const data = await (await h.get({ view: "chapters", projectId: "novel", ids: catalog.slice(i,i+3).map(c => c.id).join(","), content: "body" })).json();
      fetched.push(...data.chapters);
    }
    assert.deepEqual(fetched.map(c => c.id), catalog.map(c => c.id));
    assert.ok(fetched.every((c,i) => c.body.includes(`BODY_${i}`)));
  } finally { h.close(); }
});

test("AI resolves unloaded selected chapter, earlier memories, and previous three endings from D1", async () => {
  const h = await harness();
  try {
    const response = await h.ai(); assert.equal(response.status, 200);
    const prompt = h.prompts[0];
    for (const marker of ["SYNOPSIS_164", "MEMORY_163", "PREVIOUS_END_161", "PREVIOUS_END_162", "PREVIOUS_END_163"]) assert.ok(prompt.includes(marker), marker);
    assert.ok(!prompt.includes("SECRET_PRIVATE")); assert.ok(!prompt.includes("SECRET_DELETED"));
    const append = await h.ai({ kind: "append", selected: undefined }); assert.equal(append.status, 200);
    assert.ok(h.prompts[1].includes("SYNOPSIS_164"));
    assert.equal((await h.ai({ selected: { id: "foreign" } })).status, 404);
    assert.equal(h.prompts.length, 2);
  } finally { h.close(); }
});

test("prefetch windows cover book edges and body availability uses catalog length", () => {
  assert.deepEqual(batchAround(0, 165, "body"), { start: 0, end: 3 });
  assert.deepEqual(batchAround(164, 165, "body"), { start: 162, end: 165 });
  assert.deepEqual(batchAround(164, 165, "outline"), { start: 160, end: 165 });
  assert.equal(hasBody({ body: "", body_length: 123 }), true);
  assert.equal(hasBody({ body: "", body_length: 0 }), false);
});

test("different old cookies and an incognito request read the same works without establishing a session", async () => {
  const h = await harness();
  try {
    const first = await (await h.get({}, workspace)).json();
    for (const identity of [anotherWorkspace, null]) {
      const response = await h.get({}, identity);
      assert.equal(response.headers.get("Set-Cookie"), null);
      const data = await response.json();
      assert.deepEqual(data.projects.map(p => p.id), first.projects.map(p => p.id));
      assert.deepEqual(data.chapters.map(c => c.id), first.chapters.map(c => c.id));
    }
  } finally { h.close(); }
});

test("sharing migration preserves bodies, history, drafts, and deletion markers", async () => {
  const h = await harness();
  try {
    assert.ok(h.database.prepare("SELECT workspace_id FROM projects").all().every(p => p.workspace_id === "shared"));
    assert.equal(h.database.prepare("SELECT body FROM chapters WHERE id='c164'").get().body, "BODY_164\nPREVIOUS_END_164");
    assert.equal(h.database.prepare("SELECT deleted_at FROM projects WHERE id='trash'").get().deleted_at, "2026-10-15");
    assert.equal(h.database.prepare("SELECT body FROM chapters WHERE id='trash-chapter'").get().body, "PRESERVED_DELETED_BODY");
    assert.equal(JSON.parse(h.database.prepare("SELECT payload FROM project_snapshots WHERE id='before-sharing'").get().payload).project.workspace_id, workspace);
    assert.equal(h.database.prepare("SELECT content FROM generation_drafts WHERE id='old-draft'").get().content, "PRESERVED_DRAFT");
    // An old Worker can finish a write during rollout. Its old association must
    // not make that work disappear after the new shared Worker takes over.
    h.database.prepare("INSERT INTO projects (id,title,updated_at,workspace_id) VALUES (?,?,?,?)").run("late-write", "旧版本完成的写入", "2026-10-15", anotherWorkspace);
    assert.ok((await (await h.get({}, null)).json()).projects.some(p => p.id === "late-write"));
  } finally { h.close(); }
});

test("a new browser can create, edit, and soft-delete shared data without a cookie", async () => {
  const h = await harness();
  try {
    const created = await h.post({ action: "createProject", title: "共享新作品" }, null);
    assert.equal(created.status, 200); const { id } = await created.json();
    assert.equal(h.database.prepare("SELECT workspace_id FROM projects WHERE id=?").get(id).workspace_id, "shared");
    assert.ok((await (await h.get({}, anotherWorkspace)).json()).projects.some(p => p.id === id));
    assert.equal((await h.post({ action: "updateChapter", id: "c1", body: "CROSS_BROWSER_EDIT" }, anotherWorkspace)).status, 200);
    const batch = await (await h.get({ view: "chapters", projectId: "novel", ids: "c1", content: "body" }, null)).json();
    assert.equal(batch.chapters[0].body, "CROSS_BROWSER_EDIT");
    assert.equal((await h.post({ action: "deleteChapter", id: "c1" }, null)).status, 200);
    assert.ok(!(await (await h.get()).json()).chapters.some(c => c.id === "c1"));
    assert.equal(h.database.prepare("SELECT body FROM chapters WHERE id='c1'").get().body, "CROSS_BROWSER_EDIT");
    assert.equal((await h.post({ action: "deleteProject", id: "private" }, null)).status, 200);
    assert.ok(!(await (await h.get()).json()).projects.some(p => p.id === "private"));
    assert.equal((await h.get({ view: "chapters", projectId: "private", ids: "foreign", content: "body" })).status, 404);
    assert.equal(h.database.prepare("SELECT body FROM chapters WHERE id='foreign'").get().body, "SECRET_PRIVATE_BODY");
  } finally { h.close(); }
});

test("old snapshots remain restorable from another browser without restoring browser isolation", async () => {
  const h = await harness();
  try {
    await h.post({ action: "updateChapter", id: "c0", body: "CHANGED" }, workspace);
    assert.equal((await h.post({ action: "restoreSnapshot", id: "before-sharing" }, null)).status, 200);
    const batch = await (await h.get({ view: "chapters", projectId: "novel", ids: "c0", content: "body" }, anotherWorkspace)).json();
    assert.equal(batch.chapters[0].body, "BODY_0\nPREVIOUS_END_0");
    assert.equal(h.database.prepare("SELECT workspace_id FROM projects WHERE id='novel'").get().workspace_id, "shared");
  } finally { h.close(); }
});

test("AI can use a shared work without cookies and preserves the existing global daily ceiling", async () => {
  const h = await harness();
  try {
    assert.equal((await h.ai({ projectId: "private", selected: { id: "foreign" } }, null)).status, 200);
    assert.ok(h.prompts[0].includes("SECRET_PRIVATE"));
    const day = new Date().toISOString().slice(0,10);
    h.database.prepare("INSERT INTO generation_quota (day,workspace_id,calls) VALUES (?,?,?)").run(day, "global", 29);
    const hosted = { kind: "test", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-flash", key: "", selected: undefined };
    assert.equal((await h.ai(hosted, null)).status, 200);
    assert.equal((await h.ai(hosted, anotherWorkspace)).status, 429);
    assert.equal(h.database.prepare("SELECT calls FROM generation_quota WHERE day=? AND workspace_id='global'").get(day).calls, 30);
  } finally { h.close(); }
});

test("browser batch loader rejects missing chapters instead of silently exporting partial content", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ chapters: [{ id: "c0" }] });
    await assert.rejects(fetchChapterBatch("novel", ["c0", "c1"], "body"), /目录已变化/);
  } finally { globalThis.fetch = original; }
});
