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
  `,
  // 归类：试题库的知识点、难度（组卷网自带，只增不改）与章节、标签（老师维护），试卷库的分类与标签。
  // 原题表保持只读，归类都放在附表里；删除原题或试卷时归类随之删除。
  `
  CREATE TABLE knowledge_points (
    id       INTEGER PRIMARY KEY,          -- 组卷网知识点编号
    name     TEXT NOT NULL,
    subject  TEXT NOT NULL DEFAULT ''      -- 组卷网学科代码，如 czsx
  );
  CREATE TABLE question_knowledge (
    question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    knowledge_id  INTEGER NOT NULL REFERENCES knowledge_points(id),
    position      INTEGER NOT NULL DEFAULT 0,  -- 页面上的顺序
    PRIMARY KEY (question_id, knowledge_id)
  );
  CREATE INDEX idx_question_knowledge_kp ON question_knowledge(knowledge_id);
  CREATE TABLE question_difficulty (
    question_id  INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
    coefficient  REAL NOT NULL CHECK (coefficient >= 0 AND coefficient <= 1)
  );
  CREATE INDEX idx_question_difficulty_coef ON question_difficulty(coefficient);
  CREATE TRIGGER question_knowledge_readonly BEFORE UPDATE ON question_knowledge
  BEGIN
    SELECT RAISE(ABORT, '知识点入库后只读，不能修改');
  END;
  CREATE TRIGGER question_difficulty_readonly BEFORE UPDATE ON question_difficulty
  BEGIN
    SELECT RAISE(ABORT, '难度入库后只读，不能修改');
  END;

  -- 章节：两级目录，parent_id 为空是章，否则是该章下的节；删除章连同其下各节
  CREATE TABLE chapters (
    id          INTEGER PRIMARY KEY,
    parent_id   INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
    name        TEXT NOT NULL COLLATE NOCASE,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_chapters_sibling_name ON chapters(IFNULL(parent_id, 0), name);
  CREATE TRIGGER chapters_two_levels BEFORE INSERT ON chapters
  WHEN NEW.parent_id IS NOT NULL AND (SELECT parent_id FROM chapters WHERE id = NEW.parent_id) IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, '章节只有章、节两级');
  END;
  CREATE TRIGGER chapters_two_levels_update BEFORE UPDATE OF parent_id ON chapters
  WHEN NEW.parent_id IS NOT NULL AND ((SELECT parent_id FROM chapters WHERE id = NEW.parent_id) IS NOT NULL OR EXISTS (SELECT 1 FROM chapters WHERE parent_id = NEW.id))
  BEGIN
    SELECT RAISE(ABORT, '章节只有章、节两级');
  END;
  -- 一题只属于一个章节；章节删除后题回到「未归章节」
  CREATE TABLE question_chapter (
    question_id  INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
    chapter_id   INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_question_chapter_chapter ON question_chapter(chapter_id);

  -- 标签：题目标签与试卷标签各自一套，同一套里同名（不分英文大小写）只有一个
  CREATE TABLE tags (
    id          INTEGER PRIMARY KEY,
    scope       TEXT NOT NULL CHECK (scope IN ('question', 'paper')),
    name        TEXT NOT NULL COLLATE NOCASE,
    created_at  TEXT NOT NULL,
    UNIQUE (scope, name)
  );
  CREATE TABLE question_tags (
    question_id  INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    tag_id       INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (question_id, tag_id)
  );
  CREATE INDEX idx_question_tags_tag ON question_tags(tag_id);
  CREATE TRIGGER question_tags_scope BEFORE INSERT ON question_tags
  WHEN (SELECT scope FROM tags WHERE id = NEW.tag_id) IS NOT 'question'
  BEGIN
    SELECT RAISE(ABORT, '只能给题目打题目标签');
  END;
  CREATE TABLE paper_tags (
    paper_id  INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (paper_id, tag_id)
  );
  CREATE INDEX idx_paper_tags_tag ON paper_tags(tag_id);
  CREATE TRIGGER paper_tags_scope BEFORE INSERT ON paper_tags
  WHEN (SELECT scope FROM tags WHERE id = NEW.tag_id) IS NOT 'paper'
  BEGIN
    SELECT RAISE(ABORT, '只能给试卷打试卷标签');
  END;

  -- 试卷分类：一份试卷属于一个分类；分类删除后试卷回到「未分类」
  CREATE TABLE paper_categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  ALTER TABLE papers ADD COLUMN category_id INTEGER REFERENCES paper_categories(id) ON DELETE SET NULL;
  CREATE INDEX idx_papers_category ON papers(category_id);
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
