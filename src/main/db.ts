// 本地数据库：表结构与迁移。只依赖 node:sqlite，可以脱离 Electron 单独测试。
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

export const DB_FILE = 'workbench.db'

// 每个元素是一次迁移，下标 + 1 即迁移后的 user_version。只能在末尾追加，不能改已发布的条目。
const MIGRATIONS: string[] = [
  `
  CREATE TABLE source_papers (
    id          INTEGER PRIMARY KEY,
    url         TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    fetched_at  TEXT NOT NULL
  );

  -- 试题库原题：保持抓取时的原样，只能删除
  CREATE TABLE questions (
    id               INTEGER PRIMARY KEY,
    zujuan_qid       TEXT UNIQUE,
    source_paper_id  INTEGER REFERENCES source_papers(id),
    question_type    TEXT NOT NULL DEFAULT '',
    stem_html        TEXT NOT NULL,
    answer_html      TEXT,
    fingerprint      TEXT NOT NULL,
    created_at       TEXT NOT NULL
  );
  CREATE INDEX idx_questions_fingerprint ON questions(fingerprint);
  CREATE INDEX idx_questions_type ON questions(question_type);
  CREATE INDEX idx_questions_source ON questions(source_paper_id);
  CREATE TRIGGER questions_readonly BEFORE UPDATE ON questions
  BEGIN
    SELECT RAISE(ABORT, '试题库原题只读，不能修改');
  END;

  -- 试卷：draft_json 是当前草稿（大题与题目副本），实时自动保存
  CREATE TABLE papers (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    draft_json  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  -- 版本：只增不改；试卷存在时不能单独删除，删除试卷时随之删除
  CREATE TABLE paper_versions (
    id             INTEGER PRIMARY KEY,
    paper_id       INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    version_no     INTEGER NOT NULL CHECK (version_no >= 1),
    note           TEXT NOT NULL DEFAULT '',
    origin         TEXT NOT NULL CHECK (origin IN ('manual', 'download', 'before_restore')),
    snapshot_json  TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    UNIQUE (paper_id, version_no)
  );
  CREATE TRIGGER paper_versions_sequential BEFORE INSERT ON paper_versions
  WHEN NEW.version_no <> (SELECT COALESCE(MAX(version_no), 0) + 1 FROM paper_versions WHERE paper_id = NEW.paper_id)
  BEGIN
    SELECT RAISE(ABORT, '版本号必须按试卷连续递增');
  END;
  CREATE TRIGGER paper_versions_no_update BEFORE UPDATE ON paper_versions
  BEGIN
    SELECT RAISE(ABORT, '版本只增不改');
  END;
  CREATE TRIGGER paper_versions_no_delete BEFORE DELETE ON paper_versions
  WHEN EXISTS (SELECT 1 FROM papers WHERE id = OLD.paper_id)
  BEGIN
    SELECT RAISE(ABORT, '版本不能单独删除');
  END;

  -- 下载记录：挂在生成它的版本上
  CREATE TABLE exports (
    id            INTEGER PRIMARY KEY,
    version_id    INTEGER NOT NULL REFERENCES paper_versions(id) ON DELETE CASCADE,
    format        TEXT NOT NULL CHECK (format IN ('pdf', 'docx')),
    options_json  TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_exports_version ON exports(version_id);

  -- 图片：按内容哈希存放在数据目录 assets/<hash>.<ext>，同一张图只存一份
  CREATE TABLE assets (
    hash        TEXT PRIMARY KEY,
    ext         TEXT NOT NULL,
    bytes       INTEGER NOT NULL,
    created_at  TEXT NOT NULL
  );
  `,
  // 原题补充来源标签、在来源卷中的顺序、占用题号数（完形填空等多小题块大于 1）
  `
  ALTER TABLE questions ADD COLUMN source_label TEXT NOT NULL DEFAULT '';
  ALTER TABLE questions ADD COLUMN source_order INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE questions ADD COLUMN number_count INTEGER NOT NULL DEFAULT 1 CHECK (number_count >= 1);
  `,
  // 下载记录区分试卷与答题卡
  `
  ALTER TABLE exports ADD COLUMN kind TEXT NOT NULL DEFAULT 'paper' CHECK (kind IN ('paper', 'answer-sheet'));
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function openDatabase(dataDir: string): DatabaseSync {
  const db = new DatabaseSync(join(dataDir, DB_FILE))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (current > SCHEMA_VERSION) {
    db.close()
    throw new Error(`数据目录里的数据库由更新版本的组卷工作台创建（结构版本 ${current}），当前程序只支持到 ${SCHEMA_VERSION}，请升级程序后再打开。`)
  }
  for (let version = current; version < SCHEMA_VERSION; version++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      db.close()
      throw error
    }
  }
  return db
}

export function countRows(db: DatabaseSync, table: 'questions' | 'papers'): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
}
