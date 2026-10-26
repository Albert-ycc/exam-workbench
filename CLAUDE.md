# 组卷工作台

Windows 桌面组卷应用：组卷网链接入库 → 拖拽组卷（试卷里放题目副本）→ 设分值、改题、存版本 → 下载试卷（PDF / Word）与答题卡（PDF）。命令、目录说明见 README.md；产品口径见 `/Volumes/外置中枢/如鱼得水/试卷捕手/组卷工作台方案.md`（第一版）、`组卷工作台第二轮方案.md`（答题卡、结构与分值、界面方向 C）与 `组卷工作台第三轮方案.md`（试题库章节 / 知识点 / 难度 / 标签，试卷库分类与标签）。

## 跑起来

- `npm run dev` 开发模式；`npm run typecheck`；`npm test`（6 组单元测试）
- 端到端：`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --disable-warning=ExperimentalWarning test/e2e/<名称>.e2e.ts [证据目录]`，各套构建到自己的 `out-<名称>/`
- 打包：`npm run dist:win` → `release/组卷工作台-<version>-安装程序.exe`，交付时拷到 `/Volumes/外置中枢/如鱼得水/试卷捕手/安装包/` 并替换旧版

## 技术栈

Electron 44 + electron-vite 5 + React 19 + TypeScript 5.9；SQLite 用内置 `node:sqlite`（没有原生模块，Mac 直接交叉打 Windows 包）；docx 9.14 生成 Word，Electron printToPDF 生成 PDF 与答题卡；@dnd-kit 拖拽；Playwright `_electron` 做端到端。

## 约定

- 大题序号、题号、分值合计与分值说明只用 `src/shared/numbering.ts`；复制题目副本、按题型找大题只用 `src/shared/draft.ts`。界面与导出不另写一套。
- 分值按题号计：`item.score` 覆盖 `section.defaultScore`，只在设了时写进草稿（旧草稿序列化不变）。
- 草稿里题目 id、大题 id 必须唯一：`saveDraft` / `saveEdits` 遇到重复直接拒绝，读库时给重复的那份换新 id。
- 题干不含开头题号；多小题块用 `<span data-ewb-qno="k">` 占位；图片地址 `ewb-asset://<sha256>.<ext>`；存储 HTML 走白名单，版式语义用 `data-role`。
- 界面守方向 C「红笔校样」：蓝黑管操作与选中，红只标改动和错误，琥珀管提示，圆角不超过 3px；新界面用 `src/renderer/src/components/ui/` 的组件。
- 归类：名称规整（`cleanClassName` 去零宽与不可见字符，`classNameLength` 按字素计数，写入前 `checkClassName` 超长报错不截断）与难度档位（`difficultyTier`，按组卷网难度系数换算）只用 `src/shared/classify.ts`。原题表只读，知识点、难度、章节、标签都放附表；知识点与难度入库后只增不改，再入同一链接只补缺。分类与标签只用于整理，不进版本快照、不改试卷修改时间。
- 数据库结构改动加迁移（`src/main/db.ts`），并补 `scripts/test-*.ts` 用例。

## 不要做

- 不要驱动本机的 Word / WPS 等桌面应用做验证；Word 效果用 LibreOffice 转 PDF 看。
- 不访问或少访问组卷网：测试用 `test/fixtures` 的页面样本与离线拦截；不绕验证码、不伪装自动化。
- 并行开发时各自构建到 `out-<名称>/`，不覆盖别人的构建目录（现有端到端的构建目录写死在各脚本里，几条线同跑同一套要先加锁）；不用 `pkill -f` 按名字杀进程。

## 现状与下一步

- 2026-10-26 交付 0.4.0（第三轮：试题库章节、知识点、难度、标签，试卷库分类与标签）：单元测试 6 组 227 项、端到端 19 套全过；知识点与难度在 3 份真实组卷网试卷页（未登录）上逐题核对过。
- 端到端不依赖会话暂存目录里的数据：需要真实题目时用 `test/fixtures` 经离线拦截入库（`pages.e2e.ts` 的写法）。
- 未验证：Windows 真机安装、Word / WPS 打开效果与打印；学科网真实登录后答案与知识点在页面上的位置（入库按未登录页面的结构读取）；真实触屏；难度系数 0.41–0.56 区间没见过样本，适中与困难暂按 0.50 划分。
- 下一步等用户在 Windows 电脑上实测 0.4.0 后按反馈修改。
