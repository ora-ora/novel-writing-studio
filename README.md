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

仓库已提供独立配置 `wrangler.cloudflare.jsonc` 与 GitHub Actions 流水线 `.github/workflows/cloudflare.yml`。独立构建使用 `cloudflare` 模式；普通 `build` 保留 Sites 配置，两者分别管理数据库与站点。以下步骤基于仓库锁定的依赖版本，不要用最新版框架初始化工具覆盖项目。

### 1. 准备环境与数据库

需要 Node.js 22.13 或以上版本、仓库声明的 pnpm 版本，以及可创建 Workers 和 D1 的 Cloudflare 账号。

```bash
git clone https://github.com/ora-ora/novel-writing-studio.git
cd novel-writing-studio
corepack enable
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler d1 create novel_studio_db
```

保存创建结果中的 `database_id`，下一步填入配置。D1 数据库 ID 和 Cloudflare API Token 不是同一个东西；不要把 API Token 或模型密钥写入配置文件。

### 2. 检查独立部署配置

当前 `wrangler.cloudflare.jsonc` 已配置 Worker `novel-studio`、数据库 `novel_studio_db`，数据库 ID 为 `2b4baeb5-c2e4-480c-aa74-2a72d5302576`。使用当前账号部署无需重复创建数据库；部署到其他账号时，必须先创建自己的数据库并替换 ID。

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
      "database_name": "novel_studio_db",
      "database_id": "替换为真实的数据库UUID",
      "migrations_dir": "drizzle"
    }
  ]
}
```

`vite.config.ts` 已按构建模式选择配置：`build:cloudflare` / `dev:cloudflare` 使用独立 Wrangler 配置；默认模式仍使用 Sites 绑定。无需删除 Sites 插件或修改默认配置。

数据库绑定名称必须为 `DB`，因为服务端代码读取 `env.DB`。不要使用原配置中的全零占位数据库 ID，也不要手动编辑 `dist/server/wrangler.json`；它是构建产物，会被重新生成。独立部署不使用 `.openai/hosting.json` 中的 Sites 项目 ID，也不需要修改原站的 ID。

### 3. 初始化远程数据库

确认配置指向刚创建的、空的 D1 数据库后执行：

```bash
pnpm exec wrangler d1 migrations list DB --remote --config wrangler.cloudflare.jsonc
pnpm run db:migrate:cloudflare
```

必须执行 `drizzle/` 中的全部未应用迁移，不能只运行第一份建表 SQL。后续发布也需要检查并应用新增迁移。现有迁移含旧版共享数据清理操作；如果目标库已有数据，先备份和检查 SQL，不要把这套初始化命令用于未确认的现有数据库。

### 4. 构建、部署与模型密钥

```bash
pnpm exec tsc --noEmit
pnpm run build:cloudflare
pnpm run deploy:cloudflare
```

部署使用构建后生成的 Worker 配置，而不是直接上传源码入口。成功后 Wrangler 会输出实际访问地址，例如 `https://novel-studio.<你的子域>.workers.dev`。

如果需要默认 DeepSeek 模型，部署后执行以下命令，并在交互提示中输入新密钥：

```bash
pnpm exec wrangler secret put DEEPSEEK_API_KEY --name novel-studio --config wrangler.cloudflare.jsonc
```

也可在 Cloudflare 控制台的对应 Worker → Settings → Variables and Secrets 中添加同名 Secret。密钥不要提交到 Git、写入 README、放入前端环境变量或直接带在命令参数中。当前默认模型名称与调用规则见 `app/api/generate/route.ts`；更换默认模型需同步修改前端和服务端默认值。

不配置 `DEEPSEEK_API_KEY` 时，用户仍可在页面“模型配置”中填写自己的兼容接口、模型名和密钥。默认密钥的全站/工作区每日限制由服务端代码控制，不是 Cloudflare 的计费配额。

### 5. 验收与后续更新

- 打开部署地址，创建测试作品，添加章节，编辑后刷新检查数据是否保留。
- 配置模型并测试连接，少量生成内容检查流式输出、停止和采用草稿。
- 用手机检查作品选择、章节目录、作品设定和 AI 助手。
- 需要自定义域名时，在对应 Worker 的 Settings → Domains & Routes 中配置；不要为同一匿名工作区随意切换域名。

后续更新先拉取代码、安装锁定依赖、检查迁移，再重新构建部署。`dist/` 不提交到 Git；不要直接修改构建产物。CI 发布凭据和应用运行时的 `DEEPSEEK_API_KEY` 分开管理。

### GitHub Actions 自动更新

在 GitHub 仓库的 Settings → Secrets and variables → Actions 添加以下 repository secrets：

| 名称 | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 限定目标账号的 Workers 部署 Token，执行迁移还需 D1 编辑权限。 |
| `CLOUDFLARE_ACCOUNT_ID` | 目标 Cloudflare 账号 ID。 |
| `DEEPSEEK_API_KEY`（可选） | 默认 DeepSeek 模型密钥；生产部署后通过标准输入同步为 Worker Secret，不写入代码、构建文件或日志。 |

进入 Actions → Cloudflare CI/CD 可以查看日志或点击 Run workflow 手动发布。PR 只做类型检查、独立构建与部署目标校验；推送到 `main` 或手动运行 `main` 时，在检查成功后执行 D1 迁移与 Worker 部署。只有 Markdown 文档变化不会自动触发；文档更新需要发布时可手动运行。部署并发串行执行，不会中途取消正在执行的迁移。首次运行若提示 GitHub Actions 被禁用，先在仓库中启用 Actions。

部署成功的实际地址在 `Deploy Worker` 步骤日志中。`Sync DeepSeek API key` 步骤会在生产部署后同步 GitHub repository secret `DEEPSEEK_API_KEY`；PR 不读取此密钥。GitHub 未设置或留空时跳过同步，保留 Cloudflare 已有密钥；需要删除已有密钥时请在 Cloudflare 中显式删除。同步失败会使流水线失败，但此前的代码发布可能已完成。更新 GitHub Secret 不会自动触发流水线，请在 Actions 中手动 Run workflow（选择 `main`）或等待下一次代码发布。若同时在 Cloudflare 手动管理同名密钥，下次同步会以 GitHub 中的值覆盖。

也可以不在 GitHub 配置模型密钥，只在对应 Worker 的 Secrets 配置一次，后续普通代码发布会保留。首次发布未配置默认模型密钥时，可先测试创建作品和自定义模型。

## 本地独立运行与其他服务器

检查 `wrangler.cloudflare.jsonc` 后，可使用本地 D1 开发：

```bash
pnpm exec wrangler d1 migrations apply DB --local --config wrangler.cloudflare.jsonc
pnpm run dev:cloudflare
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
