# ippoan-dev-plans

ippoan org の plan (= リリース計画 / 機能追加 / 互換性破壊変更) を Issue で集中管理する repo。Claude Code はこの CLAUDE.md と `docs/` に従って plan を読み解き、consumer repo の実装に展開する。

## この repo の使い方

- Issue 1 つ = plan 1 つ。必ず `plan` label が付いている
- ライフサイクルは `stage:*` label で表現される (proposed → ga → removed の 9 段階)
- `manifests/production.snapshot.json` が **feature flag の真実** で、consumer repo はこれを取り込んで実行時 / build 時に flag 値を解決する
- `scripts/build-snapshot.js` / `check-snapshot.js` / `.githooks/pre-commit` は **consumer repo にコピーして使う雛形**

## Claude Code の動作指針

### plan Issue を読むとき

1. `gh issue view <N> --repo ippoan/ippoan-dev-plans` で本文を取得
2. labels から stage / type / scope / priority を判定
3. body 中の `definition` YAML block (` ```yaml ... ``` `) が flag 定義
4. `tasks` checkbox を見て未完了タスクを実装する

### consumer repo 側で実装するとき

1. plan Issue の `flag_name` を grep 可能なリテラルとしてコードに書く
   - Rust: `if_flag!("alc_xxx")` (alc-core crate を使う)
   - Vue/TS: `useFeatureFlag('alc_xxx')`
2. flag を追加したら snapshot を更新
   ```bash
   node scripts/build-snapshot.js
   git add manifests/production.snapshot.json
   ```
3. PR 作成。`.githooks/pre-commit` が drift / flag 漏れを検出する

### plan の stage を進めるとき

- `gh issue edit <N> --remove-label "stage:proposed" --add-label "stage:approved"`
- stage:* label は **排他**。常に 1 つだけ付ける
- snapshot は close 後も生き続ける (close してから `stage:removed` を付け、grace period 後にコードからも消す)

## ファイル構成

```
.
├── .github/ISSUE_TEMPLATE/      # plan 作成用 template (feature/bugfix/breaking)
├── .githooks/pre-commit         # consumer repo にコピーする pre-commit 雛形
├── docs/
│   ├── plan-lifecycle.md        # 9 stage の遷移ルール
│   ├── flag-conventions.md      # flag 命名規則
│   └── examples/
│       └── feature-plan-example.md
├── manifests/production.snapshot.json
└── scripts/
    ├── build-snapshot.js        # GitHub API → snapshot 生成
    ├── check-snapshot.js        # drift / flag 漏れ検出
    └── package.json
```

## ブランチ運用

- 初回 bootstrap commit のみ main 直接 push
- 以降の変更は **必ず PR 経由** (gh pr create → CI auto-merge)
- worktree 不要 (コードはほぼ template/docs のみで競合しにくい。直接 branch 作って OK)

## label 体系

詳細は `docs/plan-lifecycle.md`。要点:

- `plan` (必須)
- `stage:*` (排他、9 種)
- `type:*` (排他、4 種: feature/bugfix/breaking/internal)
- `scope:*` (複数可、6 種)
- `priority:*` (排他、4 種)
- meta: `needs-review`, `blocked`

label は GitHub UI または `gh label` で管理。新 scope を追加するときは README, 全 ISSUE_TEMPLATE, `docs/flag-conventions.md` も更新する。

## snapshot 生成・検証

```bash
cd scripts && npm install
GITHUB_TOKEN=$(gh auth token) node build-snapshot.js \
  --owner ippoan --repo ippoan-dev-plans
node check-snapshot.js  # drift があれば exit 1
```

`build-snapshot.js` は close 含む全 plan Issue を fetch し、body の `definition` YAML を抽出する。`yaml` block が無い Issue は flag 定義としては無視される (Issue 自体は記録される)。

## 関連 repo

- ippoan/rust-alc-api — Rust backend
- ippoan/auth-worker — OAuth Worker
- ippoan/nuxt-trouble — トラブル管理 frontend
- ippoan/nuxt-notify — 通知配信 frontend
- ippoan/ci-dashboard — CI / Issue 集約 (MCP server)
