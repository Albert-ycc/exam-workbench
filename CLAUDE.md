# 组卷工作台

Windows 桌面组卷应用：组卷网链接入库 → 拖拽组卷（试卷里放题目副本）→ 设分值、改题、存版本 → 下载试卷（PDF / Word）与答题卡（PDF）。命令、目录说明见 README.md；产品口径见 `/Volumes/外置中枢/如鱼得水/试卷捕手/组卷工作台方案.md`（第一版）与 `组卷工作台第二轮方案.md`（答题卡、结构与分值、界面方向 C）。

## 跑起来

- `npm run dev` 开发模式；`npm run typecheck`；`npm test`（5 组单元测试）
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
- 数据库结构改动加迁移（`src/main/db.ts`），并补 `scripts/test-*.ts` 用例。

## 不要做

- 不要驱动本机的 Word / WPS 等桌面应用做验证；Word 效果用 LibreOffice 转 PDF 看。
- 不访问或少访问组卷网：测试用 `test/fixtures` 的页面样本与离线拦截；不绕验证码、不伪装自动化。
- 并行开发时各自构建到 `out-<名称>/`，不覆盖别人的构建目录；不用 `pkill -f` 按名字杀进程。

## 现状与下一步

- 2026-10-25 交付 0.3.0（git `main` 首个提交 0b6a21b）：单元测试 183 项、端到端 15 套全过。
- 未验证：Windows 真机安装、Word / WPS 打开效果与打印；学科网真实登录后答案入库的页面结构（入库按「答案是 `.item.answer` 里一张图」假设）；真实触屏。
- 下一步等用户在 Windows 电脑上实测 0.3.0 后按反馈修改。
