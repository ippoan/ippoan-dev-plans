# Flag conventions

feature flag 名の命名規則と運用ルール。consumer repo すべてで統一する。

## 命名規則

### 基本

- **snake_case**
- **scope prefix を必ず付ける**
- ASCII 英数字 + `_` のみ。先頭は英字
- 全長 64 文字以内

### scope prefix

| scope | prefix | 例 |
|---|---|---|
| rust-alc-api | `alc_` | `alc_kiosk_v2`, `alc_face_auth_v3` |
| auth-worker | `auth_` | `auth_passkey_login`, `auth_lineworks_v2` |
| nuxt-trouble | `trouble_` | `trouble_ai_summary`, `trouble_assignee_notify` |
| nuxt-notify | `notify_` | `notify_pdf_inline`, `notify_lineworks_groups` |
| ci-dashboard | `ci_` | `ci_org_issues_caching` |
| 跨る | `core_` | `core_audit_logging` |

## 良い例 / 悪い例

| 良い例 | 悪い例 | 理由 |
|---|---|---|
| `alc_kiosk_v2` | `kioskV2` | scope 不明、camelCase |
| `auth_passkey_login` | `enable_passkey` | scope 不明、`enable_` は冗長 |
| `trouble_ai_summary` | `aiSummary` | scope 不明、camelCase |
| `notify_pdf_inline` | `pdfInline2026` | 日付埋め込みは plan_id で表現する |

## アンチパターン

- ❌ `enable_*`, `use_*`, `new_*` のような **動作不明な接頭辞**
- ❌ 個人名 / プロジェクト内部用語
- ❌ flag の `id` と Issue の `plan_id` を混同しない (前者は flag のキー、後者は plan の管理 ID)

## コードでの参照

flag 名は **必ずリテラル文字列で書く**。動的生成 (`f"alc_{var}"` 等) は禁止 — `check-snapshot.js` の grep が漏れる。

```rust
// Rust (rust-alc-api)
if alc_core::if_flag!("alc_kiosk_v2") {
    // 新版
}
```

```ts
// Vue/TS (auth-worker / nuxt-*)
const enabled = useFeatureFlag('alc_kiosk_v2')
if (enabled.value) { /* 新版 */ }
```

## ライフサイクル運用

- 新規 flag は plan Issue の `definition` block に書き、snapshot を更新してから commit
- `stage:removed` の flag は **コードから完全に消えるまで snapshot に残す** (consumer repo の build がコケないように)
- `expires_at` を超過した flag は CI 警告 (将来実装)

## Grace period

| stage 遷移 | 推奨 grace period |
|---|---|
| GA → Deprecated | **最低 30 日** (deprecated 警告ログ → 利用減少を確認) |
| Deprecated → Removed | **最低 30 日** (コード参照 grep で 0 件かつ deprecated 通知から 30 日経過) |
| Removed → snapshot 削除 | **任意** (consumer repo の build がコケないことを確認できれば即削除可) |
