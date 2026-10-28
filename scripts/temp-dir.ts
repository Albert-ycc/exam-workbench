// 测试脚本的临时目录统一从这里建：进程退出时一并删掉，正常结束、中途抛错、Ctrl-C / SIGTERM / SIGHUP 都算。
// 删之前先杀掉本进程拉起、还没退出的 Electron / Chrome 并等它们真正退出，免得边删边写、删完又被写回来。
// 退出处理在模块加载时就挂上，排在构建锁和 Playwright 自己的退出处理之前。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dirs = new Set<string>()
const evidenceDirs = new Set<string>()

export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.add(dir)
  return dir
}

// 证据目录：命令行给了就用它（用户指定的输出位置，不删）；没给就建临时目录，退出时连截图一起删
export function evidenceDir(given: string | undefined, prefix: string): string {
  if (given) {
    mkdirSync(given, { recursive: true })
    return given
  }
  const dir = makeTempDir(prefix)
  evidenceDirs.add(dir)
  return dir
}

// 退出处理里只能同步输出：stderr 接的是管道时 console.error 来不及写出去
const report = (text: string): void => {
  writeSync(2, `${text}\n`)
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

interface ProcRow {
  pid: number
  ppid: number
  pgid: number
  zombie: boolean
}

function listProcesses(): ProcRow[] {
  return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [pid, ppid, pgid, stat] = line.trim().split(/\s+/)
      return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), zombie: stat.startsWith('Z') }
    })
}

// Playwright 以 detached 启动 Electron / Chrome：每个都是本进程的直接子进程、自成进程组，GPU、网络、渲染等辅助进程都在组里。
// 本进程还没回收它们，组号不会被别的进程复用，按组杀不会误伤；僵尸不算活着，被杀的主进程要等本进程回收，僵尸也不会再写文件。
function stopLaunchedBrowsers(): void {
  if (process.platform === 'win32') return
  const groups = listProcesses()
    .filter((p) => p.ppid === process.pid && p.pid === p.pgid && !p.zombie)
    .map((p) => p.pgid)
  if (groups.length === 0) return
  for (const pgid of groups) {
    try {
      process.kill(-pgid, 'SIGKILL')
    } catch {
      // 组里的进程刚好自己退完了
    }
  }
  const deadline = Date.now() + 5000
  for (;;) {
    const alive = listProcesses().filter((p) => groups.includes(p.pgid) && !p.zombie)
    if (alive.length === 0) return
    if (Date.now() > deadline) {
      report(`子进程 ${alive.map((p) => p.pid).join('、')} 5 秒内没退出，照样删临时目录`)
      return
    }
    sleepSync(50)
  }
}

function cleanup(): void {
  try {
    stopLaunchedBrowsers()
  } catch (error) {
    report(`结束子进程失败：${(error as Error).message}`)
  }
  const dropped: string[] = []
  for (const dir of dirs) {
    try {
      if (evidenceDirs.has(dir) && existsSync(dir) && readdirSync(dir).length > 0) dropped.push(dir)
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      report(`临时目录没删掉：${dir}（${(error as Error).message}）`)
    }
  }
  if (dropped.length > 0) report(`没有指定证据目录，截图随临时目录一起删了：${dropped.join('、')}；要保留就把输出目录作为第一个参数传给脚本`)
}

process.on('exit', cleanup)
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) process.on(signal, () => process.exit(code))
