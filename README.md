# 纸间 · 小说创作工作台

免登录的小说创作工作台。可生成和编辑小说概要、故事资料、章节大纲与正文，支持章节事实记忆、选段修订、版本恢复和流式草稿预览，适配桌面与手机。

## 使用

新建作品后先写概要和核心冲突，再在“作品设定”的故事资料中用 `# 故事主线`、`# 人物` 等标签整理设定，也可以插入默认模板。生成大纲、追加或插入章节、逐章写正文时，AI 会参考这些设定。生成结果在预览中确认后才写入；可停止流式输出，已收到的文字会保留为近期草稿。选中正文片段可扩写、重写、缩写或润色。替换全书大纲、采用 AI 修订等操作会建立可恢复的快照。作品和章节均为软删除，恢复入口暂未提供。

匿名工作区由浏览器的安全 Cookie 标识。**清除 Cookie 会失去该工作区的访问凭据**，请定期导出 Markdown 备份。匿名工作区不提供跨设备同步或账号找回；手机和电脑默认是不同工作区。

默认 DeepSeek 密钥只在服务端使用。默认模型每日限全站 30 次、每工作区 10 次；自定义模型的密钥只在页面内存中使用，刷新后需重新填写。非密钥的模型地址、名称和温度保存在浏览器本地。

## 开发

`npm run db:generate` 生成 D1 迁移；`npx tsc --noEmit` 与 `npm run build` 验证代码。数据库结构见 `db/schema.ts`，迁移按 `drizzle/` 中的编号顺序执行。Sites 发布时会应用待执行的迁移。

## 部署方式

项目使用 Vinext、React、Cloudflare Workers 和 D1。前端页面、服务端 API 与流式模型请求由同一个 Worker 提供，作品数据保存在 D1；当前不需要 R2。

| 方式 | 说明 |
| --- | --- |
| Sites 托管 | 保留现有 Sites 发布流程，由平台管理部署、D1 绑定与迁移。 |
| 独立 Cloudflare 部署 | 使用自己的 Cloudflare 账号、Worker、D1 和密钥，不依赖 Sites 发布服务。下文提供配置步骤。 |
| 本地运行 | 使用 Wrangler/Miniflare 的本地 Workers 环境和本地 D1，不是公网生产部署。 |
| 普通 VPS / Docker / Node | 当前不能直接运行生产服务；需先改造 Workers/D1 专用接口与数据库层。 |

不要只把 `dist/client` 上传成静态网站：`/api/workspace` 和 `/api/generate` 是必需的服务端接口。本项目的独立部署目标是 **Cloudflare Workers**，不是纯静态 Pages。

## 独立部署到 Cloudflare Workers

以下步骤基于仓库当前锁定的 Vinext、Cloudflare Vite plugin 和 Wrangler 版本。建议在自己的 fork 或独立分支中完成；这些是需要执行的配置调整，仓库默认仍使用 Sites 配置。不要直接运行最新版框架初始化工具覆盖现有项目。

### 1. 准备环境与数据库

需要 Node.js 22.13 或以上版本、仓库声明的 pnpm 版本，以及可创建 Workers 和 D1 的 Cloudflare 账号。

```bash
git clone https://github.com/ora-ora/novel-writing-studio.git
cd novel-writing-studio
corepack enable
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler d1 create novel-studio-db
```

保存创建结果中的 `database_id`，下一步填入配置。D1 数据库 ID 和 Cloudflare API Token 不是同一个东西；不要把 API Token 或模型密钥写入配置文件。

### 2. 添加独立部署配置

在仓库根目录创建 `wrangler.jsonc`，将 `替换为真实的数据库UUID` 改为上一步返回的值。Worker 名称 `novel-studio` 可以自行修改，后续命令保持一致。

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "novel-studio",
  "main": "vinext/server/fetch-handler",
  "compatibility_date": "2026-05-15",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "novel-studio-db",
      "database_id": "替换为真实的数据库UUID",
      "migrations_dir": "drizzle"
    }
  ]
}
```

修改 `vite.config.ts`：

1. 删除 `hostingConfig` 和 `sites` 两个 import。
2. 删除占位数据库 ID、`const { d1, r2 } = hostingConfig` 和整个 `localBindingConfig` 对象。
3. 从 `plugins` 中删除 `sites({ mockAuth: !managedLinux })`。
4. 将 Cloudflare 插件的 `config: localBindingConfig` 改为 `configPath: "./wrangler.jsonc"`，保留其他 Vinext、Cloudflare 插件与环境设置。

调整后的插件部分应为：

```ts
plugins: [
  vinext(),
  cloudflare({
    viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    inspectorPort: false,
    configPath: "./wrangler.jsonc",
  }),
],
```

数据库绑定名称必须为 `DB`，因为服务端代码读取 `env.DB`。不要使用原配置中的全零占位数据库 ID，也不要手动编辑 `dist/server/wrangler.json`；它是构建产物，会被重新生成。独立部署不使用 `.openai/hosting.json` 中的 Sites 项目 ID，也不需要修改原站的 ID。

### 3. 初始化远程数据库

确认配置指向刚创建的、空的 D1 数据库后执行：

```bash
pnpm exec wrangler d1 migrations list DB --remote --config wrangler.jsonc
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

必须执行 `drizzle/` 中的全部未应用迁移，不能只运行第一份建表 SQL。后续发布也需要检查并应用新增迁移。现有迁移含旧版共享数据清理操作；如果目标库已有数据，先备份和检查 SQL，不要把这套初始化命令用于未确认的现有数据库。

### 4. 构建、部署与模型密钥

```bash
pnpm exec tsc --noEmit
pnpm run build
pnpm exec wrangler deploy --config dist/server/wrangler.json
```

部署使用构建后生成的 Worker 配置，而不是直接上传源码入口。成功后 Wrangler 会输出实际访问地址，例如 `https://novel-studio.<你的子域>.workers.dev`。

如果需要默认 DeepSeek 模型，部署后执行以下命令，并在交互提示中输入新密钥：

```bash
pnpm exec wrangler secret put DEEPSEEK_API_KEY --name novel-studio --config wrangler.jsonc
```

也可在 Cloudflare 控制台的对应 Worker → Settings → Variables and Secrets 中添加同名 Secret。密钥不要提交到 Git、写入 README、放入前端环境变量或直接带在命令参数中。当前默认模型名称与调用规则见 `app/api/generate/route.ts`；更换默认模型需同步修改前端和服务端默认值。

不配置 `DEEPSEEK_API_KEY` 时，用户仍可在页面“模型配置”中填写自己的兼容接口、模型名和密钥。默认密钥的全站/工作区每日限制由服务端代码控制，不是 Cloudflare 的计费配额。

### 5. 验收与后续更新

- 打开部署地址，创建测试作品，添加章节，编辑后刷新检查数据是否保留。
- 配置模型并测试连接，少量生成内容检查流式输出、停止和采用草稿。
- 用手机检查作品选择、章节目录、作品设定和 AI 助手。
- 需要自定义域名时，在对应 Worker 的 Settings → Domains & Routes 中配置；不要为同一匿名工作区随意切换域名。

后续更新先拉取代码、安装锁定依赖、检查迁移，再重新构建部署。`dist/` 不提交到 Git；不要直接修改构建产物。连接 GitHub 自动部署时，需要在 CI 中完成相同的构建/迁移/发布步骤，并把 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID` 配置为 CI 密钥，不要写入仓库。CI 发布凭据和应用运行时的 `DEEPSEEK_API_KEY` 分开管理。

## 本地独立运行与其他服务器

完成上面的 `wrangler.jsonc` 和 Vite 配置调整后，可使用本地 D1 开发：

```bash
pnpm exec wrangler d1 migrations apply DB --local --config wrangler.jsonc
pnpm run dev
```

本地默认入口为 `http://localhost:5173`，以终端实际输出为准。本地 D1 与远程 D1 互相独立，使用 `--local` 不会初始化线上数据库。不要把 `localhost` 换成普通局域网 HTTP 地址进行生产使用：工作区 Cookie 带有 `Secure` 属性，非 localhost 的访问应提供 HTTPS。

本地需要默认模型时，可在仓库根目录创建已被忽略的 `.env.local`，填写 `DEEPSEEK_API_KEY=你的密钥` 后重启开发服务；也可以仅在页面填写自定义模型配置。不要提交本地密钥文件。

`pnpm run start` 当前启动的是本地 Wrangler 预览，不是通用的 Node.js 生产服务器。当前代码直接导入 `cloudflare:workers` 并使用 D1 API，因此不能原样通过 `next start`、PM2、Nginx 静态托管或通用 Node Docker 镜像部署。若要完全脱离 Cloudflare，需要另外实现 Node 服务端适配、SQLite/PostgreSQL 数据访问层、迁移与 HTTPS/流式代理配置；本仓库暂未提供这条部署路径。

## 数据与部署注意事项

- 独立部署默认使用新数据库；Sites 站点中的作品、密钥和配置不会自动迁移。
- 当前没有完整的跨实例数据库导入或工作区找回入口。Markdown 导出用于内容备份，不等同于可直接恢复全部版本与草稿的数据库备份。
- 匿名工作区凭据保存在当前域名的浏览器 Cookie 中。换域名、换浏览器或清除 Cookie 后，即使数据库还在，也不会自动获得原工作区的访问权限。
- 网站保持免登录；只要公开地址可访问，就可能产生模型调用。请按使用范围设置调用限制并留意模型账单。
- 不要把公开流量/模型费用限制当作数据备份；生产数据应另行制定 D1 备份与恢复方案。

官方参考：[Cloudflare Vite 配置](https://developers.cloudflare.com/workers/vite-plugin/reference/programmatic-configuration/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)、[Wrangler D1 命令](https://developers.cloudflare.com/workers/wrangler/commands/d1/)、[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
