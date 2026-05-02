# Plan lifecycle

plan は GitHub Issue の `stage:*` label で 9 段階のライフサイクルを表現する。
**`stage:*` label は排他** — 必ず 1 つだけ付ける。

## 9 stage 一覧

| stage | label | 意味 | 遷移条件 |
|---|---|---|---|
| Proposed | `stage:proposed` | 提案された。レビュー待ち | template から Issue が作成された直後 (デフォルト) |
| Approved | `stage:approved` | レビュー通過。実装着手 OK | reviewer が approve コメント or `gh issue edit --add-label` |
| Implementing | `stage:implementing` | 現在実装中 | 担当者が PR を draft で開いた / 着手宣言 |
| Applied | `stage:applied` | コードはマージ済 (ただし flag は default OFF) | 関連 PR が main に merge され、snapshot に反映 |
| Internal | `stage:internal` | 社内ユーザーのみ ON | snapshot で `rollout.internal: true` |
| Early | `stage:early` | early adopter (一部 tenant) ON | `rollout.early: true` |
| GA | `stage:ga` | 全ユーザー ON | `rollout.ga: true` (= default ON) |
| Deprecated | `stage:deprecated` | 廃止予定 (新規利用停止 / 旧 path 警告) | 後継 plan が GA 到達 |
| Removed | `stage:removed` | コードから削除済 | flag を参照するコードが消えてから |

## 遷移ルール

### Proposed → Approved

- レビュアーが Issue body の `definition`, `rollback`, `test_plan` を確認
- `priority` が適切か / `scope` が網羅されているか確認
- approve したら label を切り替え

```bash
gh issue edit <N> --repo ippoan/ippoan-dev-plans \
  --remove-label "stage:proposed" --add-label "stage:approved"
```

### Approved → Implementing

- 実装担当者が draft PR を開いたタイミングで自動的に変更 (将来は workflow 化)
- 手動の場合:
  ```bash
  gh issue edit <N> --remove-label "stage:approved" --add-label "stage:implementing"
  ```

### Implementing → Applied

- consumer repo の関連 PR が main に merge された時
- snapshot を再生成 → `manifests/production.snapshot.json` を commit
- flag は **default_value のまま** (まだ ON にしない)

### Applied → Internal → Early → GA

- 各 stage は **snapshot の `rollout.*: true`** で表現される
- stage を進める = snapshot 更新 + label 変更
- staging で十分に検証 → internal → 1 tenant → 数 tenant → 全社の順で広げる
- GA 到達後は `default_value: true` に変更可

### GA → Deprecated → Removed

- 後継 plan が GA に到達したら deprecated に
- deprecated 期間中は flag は残るが新規利用を警告 (ログ等)
- すべての参照が消えたら `stage:removed` + コード grep で 0 件確認 → snapshot から flag を物理削除

## type 別の扱い

| type | 適用される stage |
|---|---|
| `type:feature` | 全 9 stage |
| `type:bugfix` | proposed → approved → implementing → applied で完了 (rollout 不要) |
| `type:breaking` | expand/switch/contract の 3 plan に分けて管理 |
| `type:internal` | 全 9 stage (この repo 自身のセットアップ等) |

## 自動化ポイント

現状は手動運用。将来的に以下を `.github/workflows/` で自動化予定:

- [ ] PR merge → 関連 plan を `stage:applied` に
- [ ] GitHub Project の Status field 変更 → label 自動同期
- [ ] snapshot rebuild → drift があれば PR 自動作成
