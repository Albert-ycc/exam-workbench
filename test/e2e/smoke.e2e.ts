// 冒烟测试：应用能启动、四个导航页能切换、试题库能读到样例题、图片协议可用
// 用法：node test/e2e/smoke.e2e.ts [证据目录]
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTo, launchApp } from '../../scripts/e2e/app.ts'
import { seedDataDir } from '../../scripts/seed-dev.ts'

const evidence = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'ewb-smoke-'))
mkdirSync(evidence, { recursive: true })
buildTo('out-smoke')
const dataDir = mkdtempSync(join(tmpdir(), 'ewb-smoke-data-'))
seedDataDir(dataDir)
const { app, window } = await launchApp({ outDir: 'out-smoke', dataDir })
try {
  for (const label of ['试题库', '试卷库', '设置', '采集']) {
    await window.getByRole('button', { name: label, exact: true }).click()
  }
  const page = await window.evaluate(() => window.workbench.library.listQuestions({}))
  assert.equal(page.total, 6)
  const image = page.items.map((q) => q.stemHtml.match(/ewb-asset:\/\/[^"]+/)?.[0]).find(Boolean)
  assert.ok(image, '样例题应含本地图片')
  // 界面只允许 <img> 读取本地图片（CSP img-src），用真实图片加载验证协议
  const width = await window.evaluate(
    (url) =>
      new Promise<number>((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img.naturalWidth)
        img.onerror = () => resolve(-1)
        img.src = url as string
      }),
    image
  )
  assert.ok(width > 0, `本地图片应能加载，实际 naturalWidth=${width}`)
  await window.getByRole('button', { name: '设置', exact: true }).click()
  await window.getByText('试题库题目').waitFor()
  await window.screenshot({ path: join(evidence, 'smoke-settings.png') })
  console.log(`冒烟测试通过，截图在 ${evidence}`)
} finally {
  await app.close()
}
