// 组卷网页面样本（test/fixtures/*.html）不随公开仓库发布：里面是学科网的试题内容。
// 本地有就用；没有时依赖它们的测试打印原因后以 0 退出——这是环境缺材料，不是测试失败。怎么补样本见 test/fixtures/README.md
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const FIXTURES_DIR = resolve(import.meta.dirname, '../test/fixtures')
export const FIXTURE_FILES = ['zujuan-math-7a.html', 'zujuan-english-7a.html', 'zujuan-physics-8a.html', 'zujuan-question-math.html'] as const

export function missingFixtures(): string[] {
  return FIXTURE_FILES.filter((name) => !existsSync(join(FIXTURES_DIR, name)))
}

export function skipWithoutFixtures(what: string): void {
  const missing = missingFixtures()
  if (missing.length === 0) return
  console.log(`跳过${what}：test/fixtures 缺 ${missing.join('、')}。组卷网页面样本不随公开仓库发布（含学科网试题内容），按 test/fixtures/README.md 补齐后再跑。`)
  process.exit(0)
}
