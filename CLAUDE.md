# 组卷工作台

Windows 桌面组卷应用：组卷网链接入库 → 拖拽组卷（试卷里放题目副本）→ 设分值、改题、存版本 → 下载试卷（PDF / Word）与答题卡（PDF）。命令、目录说明见 README.md；产品口径见 `/Volumes/外置中枢/如鱼得水/试卷捕手/组卷工作台方案.md`（第一版）、`组卷工作台第二轮方案.md`（答题卡、结构与分值、界面方向 C）与 `组卷工作台第三轮方案.md`（试题库章节 / 知识点 / 难度 / 标签，试卷库分类与标签）。

## 跑起来

- `npm run dev` 开发模式；`npm run typecheck`；`npm test`（6 组单元测试）
- 端到端：`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --disable-warning=ExperimentalWarning test/e2e/<名称>.e2e.ts [证据目录]`，各套构建到自己的 `out-<名称>/`；共用构建目录的几套由 `scripts/e2e/app.ts` 的目录锁排队，启动默认屏蔽外网，`library` 加 `--online` 才联网
- 测试脚本（含临时写的排查脚本）建临时目录一律用 `scripts/temp-dir.ts` 的 `makeTempDir` / `evidenceDir`，不直接 `mkdtempSync`：退出时（正常、抛错、Ctrl-C / SIGTERM / SIGHUP）先杀本进程拉起的 Electron 再删目录。没传证据目录时截图随退出一起删，要看截图就传目录；`kill -9` 测试进程仍会留下目录
- 版本管理在 GitHub：`origin` = https://github.com/Albert-ycc/exam-workbench（公开仓库，MIT）。提交后 `git push`；提交作者用 `Albert <197743926+Albert-ycc@users.noreply.github.com>`，仓库里不放真名、学校名、外置盘路径之外的个人信息（公开页面的规矩见记忆 feedback_public_profile_no_real_name）。
- 打包：`npm run dist:win` → `release/组卷工作台-<version>-安装程序.exe`，交付时拷到 `/Volumes/外置中枢/如鱼得水/试卷捕手/安装包/`（拷完用 `cmp` 核对；外置盘会多出 `._` 开头的元数据文件，删掉）；旧版安装程序由用户自己删，自动删除会被权限拦下

## 技术栈

Electron 44 + electron-vite 5 + React 19 + TypeScript 5.9；SQLite 用内置 `node:sqlite`（没有原生模块，Mac 直接交叉打 Windows 包）；docx 9.14 生成 Word，Electron printToPDF 生成 PDF 与答题卡；@dnd-kit 拖拽；Playwright `_electron` 做端到端。

## 约定

- 大题序号、题号、分值合计与分值说明只用 `src/shared/numbering.ts`（题目块占的题号数 `numberCountOf`、展开题号 `blockNos`、「有没有内容」`hasVisibleContent` 也在这里；导出排版上「这段要不要排出来」是 `export/html-tree.ts` 的 `hasRenderableContent`，用途不同）；复制题目副本、按题型找大题只用 `src/shared/draft.ts`。界面与导出不另写一套。
- IPC 入口的来源与 id 校验只用 `src/main/ipc-guard.ts`；界面的时间格式与错误文案只用 `src/renderer/src/components/ui/format.ts`。
- 试卷正文的写法照手排的单元测试卷：题号「1．」（全角句点，`export/document.ts` 的 `questionNoText`）、分值说明 `paperSectionNote`「（共10小题，每小题4分，共40分）」与 `paperItemNote`「(本题4分)」（数字两侧不留空格，都在 `shared/numbering.ts`）；答题卡沿用带空格的 `sectionScoreNote` / `boxScoreLabel`，照本地答题卡。编辑器界面显示的仍是带空格的写法。
- 分值按题号计：`item.score` 覆盖 `section.defaultScore`，只在设了时写进草稿（旧草稿序列化不变）。
- 草稿里题目 id、大题 id 必须唯一：`saveDraft` / `saveEdits` 遇到重复直接拒绝，读库时给重复的那份按原 id 加序号派生新 id（确定性，同一份数据每次读出来一样，否则草稿永远与最新版本对不上）。
- 题干不含开头题号；多小题块用 `<span data-ewb-qno="k">` 占位；图片地址 `ewb-asset://<sha256>.<ext>`；存储 HTML 走白名单，版式语义用 `data-role`。
- 界面守方向 C「红笔校样」：蓝黑管操作与选中，红只标改动和错误，琥珀管提示，圆角不超过 3px；新界面用 `src/renderer/src/components/ui/` 的组件。
- 归类：名称规整（`cleanClassName` 去零宽与不可见字符，`classNameLength` 按字素计数，写入前 `checkClassName` 超长报错不截断）与难度档位（`difficultyTier`，按组卷网难度系数换算）只用 `src/shared/classify.ts`。原题表只读，知识点、难度、章节、标签都放附表；知识点与难度入库后只增不改，再入同一链接只补缺。分类与标签只用于整理，不进版本快照、不改试卷修改时间。
- 数据库结构改动加迁移（`src/main/db.ts`），并补 `scripts/test-*.ts` 用例。

## 不要做

- 不要驱动本机的 Word / WPS 等桌面应用做验证；Word 效果用 LibreOffice 转 PDF 看。
- 不访问或少访问组卷网：测试用 `test/fixtures` 的页面样本与离线拦截；不绕验证码、不伪装自动化。样本 `*.html` 含学科网试题内容，在 .gitignore 里、不进公开仓库（2026-10-26 已从历史里抹掉），没有样本时依赖它的测试走 `scripts/fixtures.ts` 的 `skipWithoutFixtures` 跳过并说明。
- 并行开发时各自构建到 `out-<名称>/`，不覆盖别人的构建目录（现有端到端的构建目录写死在各脚本里，同一目录由 `buildTo` 的锁排队，整套跑完才轮到下一套）；不用 `pkill -f` 按名字杀进程。

## 现状与下一步

- 现役 0.4.4（2026-10-26；0.4.0 → 0.4.4 各版改了什么见 `git log`，每条提交说明都写全了）。`npm test` 6 组 243 项、端到端 19 套全过（`export-real` / `export-card-real` 要联网或真实数据，不在常跑之列）。安装包在外置盘 `试卷捕手/安装包/`，仓库 https://github.com/Albert-ycc/exam-workbench 与本地 main 同步。
- 未验证：Windows 真机安装与更新（`build/installer.nsh` 的关闭流程只编译校验过，要从 0.4.1 更新到 0.4.2 以上时看）；Word / WPS 打开效果与打印（只用 LibreOffice 看过）；学科网真实登录后答案与知识点在页面上的位置（入库按未登录页面的结构读取）；真实触屏；难度系数 0.41–0.56 区间没见过样本，适中与困难暂按 0.50 划分；只有 viewBox 没宽高的 SVG 在 Word 导出的尺寸读取要在 Electron 里实测。
- 没做与待拍板：升级前入库的无编号题指纹按旧算法，再入同一道会多一道（无法重算；样本里无编号题从未出现）；答题卡对实验、作图、综合、作文类题型一律按填空横线排（用户 2026-10-26 定先维持，Windows 实测后再定）；大题未设分时试卷标题不写「（共 N 小题）」而答题卡写，规则分在 `export/document.ts` 与 `shared/numbering.ts` 两处；应用没有自己的图标。
- 端到端不依赖会话暂存目录里的数据：需要真实题目时用 `test/fixtures` 经离线拦截入库（`pages.e2e.ts` 的写法）；样本不在仓库里，缺样本时相关测试跳过。
- 下一步等用户在 Windows 电脑上实测 0.4.4 后按反馈修改。
