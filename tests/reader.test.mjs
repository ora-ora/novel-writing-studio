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
  for (const file of (await readdir(path.join(root, "drizzle"))).filter(f => f.endsWith(".sql")).sort()) {
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
  insertProject.run("private", "别人的作品", "2026-10-15", anotherWorkspace);
  const insertChapter = sqlite.prepare("INSERT INTO chapters (id,project_id,position,title,synopsis,body,memory,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 165; i++) insertChapter.run(`c${i}`, "novel", i, `CHAPTER_${i}`, `SYNOPSIS_${i}`, `BODY_${i}\nPREVIOUS_END_${i}`, `MEMORY_${i}`, "2026-10-15", null);
  insertChapter.run("removed", "novel", 165, "已删除", "SECRET_DELETED", "SECRET_DELETED_BODY", "", "2026-10-15", "2026-10-15");
  insertChapter.run("foreign", "private", 0, "私人章节", "SECRET_PRIVATE", "SECRET_PRIVATE_BODY", "", "2026-10-15", null);
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
  const workers = new vm.SyntheticModule(["env"], function () { this.setExport("env", { DB: binding }); }, { context });
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
    return route.namespace.GET(new Request(`https://novel.test/api/workspace?${new URLSearchParams(params)}`, { headers: { cookie: `novel_ws=${identity}` } }));
  }
  function ai(fields = {}) {
    return generate.namespace.POST(new Request("https://novel.test/api/generate", { method: "POST", headers: { cookie: `novel_ws=${workspace}`, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "body", projectId: "novel", selected: { id: "c164" }, chapters: [], endpoint: "https://model.example.test/v1/chat/completions", key: "offline-test-only", model: "offline", ...fields }) }));
  }
  return { get, ai, prompts, close: () => sqlite.close() };
}

test("directory is lightweight and excludes other workspaces and deleted chapters", async () => {
  const h = await harness();
  try {
    const response = await h.get(); const data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.chapters.length, 165);
    assert.equal(data.projects.length, 1);
    assert.ok(data.chapters.every(c => c.body === "" && c.synopsis === "" && !c.body_loaded && c.body_length > 0));
    assert.ok(!JSON.stringify(data).includes("SECRET_PRIVATE"));
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

test("batch authorization, removed IDs, injection strings, and oversized batches fail closed", async () => {
  const h = await harness();
  try {
    assert.equal((await h.get({ view: "chapters", projectId: "private", ids: "foreign", content: "body" })).status, 404);
    for (const ids of ["removed", "foreign", "c0') OR 1=1 --"]) assert.equal((await h.get({ view: "chapters", projectId: "novel", ids, content: "body" })).status, 409);
    for (const ids of ["c0,c0", Array.from({ length: 21 }, (_,i) => `c${i}`).join(",")]) assert.equal((await h.get({ view: "chapters", projectId: "novel", ids })).status, 400);
  } finally { h.close(); }
});

test("complete chapter traversal retrieves every body regardless of current reading page", async () => {
  const h = await harness();
  try {
    const catalog = (await (await h.get()).json()).chapters;
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

test("browser batch loader rejects missing chapters instead of silently exporting partial content", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ chapters: [{ id: "c0" }] });
    await assert.rejects(fetchChapterBatch("novel", ["c0", "c1"], "body"), /目录已变化/);
  } finally { globalThis.fetch = original; }
});
