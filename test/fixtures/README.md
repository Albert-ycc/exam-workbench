# 组卷网页面样本（不随仓库发布）

这里放 4 份组卷网页面的本地保存件，入库单测（`scripts/test-import.ts`）与 `library`、`import-classify`、`pages`、`export-real` 四套端到端用它们代替真实组卷网离线跑。页面里是学科网的试题内容，所以 `*.html` 在 `.gitignore` 里，不进公开仓库；没有这些文件时上述测试会打印原因后跳过（退出码 0），其余测试不受影响。

| 文件 | 内容 | 来源 |
|---|---|---|
| `zujuan-math-7a.html` | 初中数学试卷页，23 题，每题带知识点与难度 | `https://zujuan.xkw.com/2p3543573.html`（山东德州市庆云县东郎务中学 2026-2027 学年七年级上月考） |
| `zujuan-english-7a.html` | 初中英语试卷页，20 题，含完形填空、阅读理解、书面表达 | 吉林东北师范大学附属实验学校七年级上阶段检测（组卷网试卷页） |
| `zujuan-physics-8a.html` | 初中物理试卷页，26 题，含两个实验题大题 | 第五章 透镜及其应用（单元分层自测，组卷网试卷页） |
| `zujuan-question-math.html` | 数学单题页（上面数学卷的一道题），答案区带知识点、只有难度系数 | `https://zujuan.xkw.com/2q17150767.html` |

补样本：先 `npm run build`，再用应用自己的抓取自检在内置浏览器会话里打开页面、等题目渲染后保存去掉脚本的 HTML（组卷网直接 curl 会被反爬壳挡）：

```bash
EWB_USER_DATA=/tmp/ewb-capture ./node_modules/.bin/electron . --selftest=capture --url=https://zujuan.xkw.com/2p3543573.html --out=test/fixtures/zujuan-math-7a.html
```

测试里的断言依赖这几份页面的具体内容（题数、题型、知识点），换成别的页面会失败。
