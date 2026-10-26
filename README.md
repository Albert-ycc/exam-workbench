# 组卷工作台

Windows 桌面应用：从组卷网入库试题，拖拽组卷，在应用内修改题目、设分值，按配置下载试卷（PDF / Word）与答题卡（PDF），每份试卷有版本记录。产品方案见 `/Volumes/外置中枢/如鱼得水/试卷捕手/组卷工作台方案.md`（第一版）与 `组卷工作台第二轮方案.md`（答题卡、试卷结构与分值、界面方向 C「红笔校样」）。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式启动（界面热更新） |
| `npm run typecheck` | 主进程与界面的类型检查 |
| `npm test` | 单元测试：数据库约束、试卷结构与分值、试卷与版本、下载规则（含答题卡与下载前检查）、入库拆题（入库拆题在 Electron 页面环境里跑） |
| `npm run e2e:smoke` / `e2e:editor` / `e2e:editor-touch` / `e2e:library` / `e2e:export` / `e2e:export-dialog` | 端到端测试（Playwright 启动应用）；`e2e:library` 默认离线拦截，加参数 `online` 访问真实组卷网 |
| `node test/e2e/<名称>.e2e.ts [证据目录]` | 其余端到端测试：`ui-kit`、`ui-shell`、`editor-repo`、`editor-structure`、`editor-ops`、`editor-review`、`export-card`、`pages`；`export-card-real` 需环境变量 `EWB_REAL_DATA=<真实数据目录>` |
| `npm run seed -- <数据目录>` | 往数据目录写入 6 道样例题 |
| `npm run dist:win` | 打 Windows x64 安装程序，输出到 `release/` |

端到端测试各自构建到 `out-<名称>/`，用独立的用户目录与数据目录，互不干扰。

## 目录

| 路径 | 内容 |
|---|---|
| `src/shared/domain.ts` | 领域模型与题目内容约定（题号占位符、图片地址、存储 HTML 白名单） |
| `src/shared/numbering.ts` | 大题序号、全卷题号、分值合计与分值说明的唯一算法（界面与导出共用） |
| `src/shared/draft.ts` | 从试题库复制题目副本、按题型找大题放置（编辑器与试题库页共用） |
| `src/shared/library.ts` / `papers.ts` / `export.ts` | 三个功能模块的接口与 IPC 通道名 |
| `src/main/index.ts` | 程序入口：单实例、主窗口、IPC 注册、退出前保存、自检 |
| `src/main/browser.ts` | 采集用内置浏览器（会话分区 `persist:zujuan`，登录 Cookie 即时转持久，公式图按 SVG 获取） |
| `src/main/db.ts` | SQLite 表结构与迁移（node:sqlite，无原生模块；触发器保证原题只读、版本只增不改） |
| `src/main/assets.ts` / `asset-protocol.ts` | 图片按内容哈希存储与 `ewb-asset://` 协议 |
| `src/main/library/` | 入库：拆题脚本 `extract-script.ts`、图片下载、去重、入库任务 |
| `src/main/papers/` | 试卷、草稿、版本、下载记录的数据操作；草稿里题目 id、大题 id 必须唯一 |
| `src/main/export/` | 下载：内容规则 `document.ts`、PDF `pdf.ts`、Word `docx.ts`、答题卡 `card.ts` / `render-card-html.ts`、下载前检查 `check.ts`、文件名 `file-name.ts`、下载流程 `service.ts` |
| `src/renderer/src/pages/` | 采集、试题库、试卷库、编辑器、设置五个页面 |
| `src/renderer/src/components/ui/` | 界面底座：方向 C 色板下的按钮、表单、弹窗、抽屉、提示条、红笔记号等通用组件 |
| `src/renderer/src/components/` | 题目显示 `QuestionHtml`、编辑器（含试卷结构栏与分值表）、版本历史、试题库、下载弹窗 |
| `test/fixtures/` | 组卷网真实页面样本（数学、英语、物理试卷页，数学单题页） |

## 登录保持自检

学科网登录使用会话 Cookie，程序重启后会丢失；Cookie 写入时即转为 30 天有效，退出前再兜底转换一次。

```bash
EWB_USER_DATA=/tmp/ewb-test ./node_modules/.bin/electron . --selftest=cookie-write-raw
EWB_USER_DATA=/tmp/ewb-test ./node_modules/.bin/electron . --selftest=cookie-check
```

第一条写入会话 Cookie 后跳过退出流程直接结束（模拟崩溃），第二条输出「Cookie 仍在」即通过。

## 打包说明

在 Apple Silicon Mac 上交叉打包需使用原生 arm64 工具链，`package.json` 的 `build.toolsets` 已指定 `nsis: 1.2.1`、`winCodeSign: 1.1.0`。程序不依赖原生模块，无需针对 Windows 重新编译。
