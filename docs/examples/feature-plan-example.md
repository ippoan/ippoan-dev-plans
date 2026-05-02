# Feature plan の書き方 (例)

実際の plan Issue body のサンプル。`Plan: Feature` template から作成した状態を想定。

---

## Plan ID

`20260502_010_alc_kiosk_v2`

## Flag name

`alc_kiosk_v2`

## Scope

- rust-alc-api
- nuxt-trouble (経由しない、影響なし)

## Summary

ALC キオスク画面を v2 にリニューアル。顔認証フローを 3 step → 1 step に短縮し、誤検知時のリトライ UI を簡素化する。

## Flag definition

```yaml
id: alc_kiosk_v2
plan_id: 20260502_010_alc_kiosk_v2
owner: "@yhonda-ohishi"
default_value: false
rollout:
  internal: true       # まず社内 tenant で ON
  early: false
  ga: false
expires_at: "2026-08-01"
notes: |
  Internal で 2 週間 OK だったら early に。
  GA 到達後は default_value を true に。
```

## Tasks

- [ ] backend: `/api/kiosk/v2/*` エンドポイント追加 (rust-alc-api)
- [ ] frontend: `KioskV2.vue` 実装 (`alc-app`)
- [ ] alc-core で `if_flag!("alc_kiosk_v2")` 切替
- [ ] スプリットテスト用ログ追加
- [ ] テスト追加 (unit + E2E)
- [ ] snapshot に flag 反映 (`scripts/build-snapshot.js`)
- [ ] consumer repo merge (rust-alc-api PR + alc-app PR)
- [ ] Issue を `stage:applied` に
- [ ] internal 開始 → `stage:internal`
- [ ] early 開始 → `stage:early`
- [ ] GA → `stage:ga` + `default_value: true`

## Rollback

- staging で問題発覚: snapshot の `default_value: false` のまま、PR を revert しない
- internal で問題発覚: snapshot の `rollout.internal: false` に戻す → re-deploy
- GA 後の問題発覚: snapshot の `default_value: false` + `rollout.*: false` に戻す
- 最悪: 関連 PR を `git revert` (alc-core が `if_flag!` で守っているので revert 容易)

## Test plan

1. **unit**: `cargo test -p alc-core flag::tests::kiosk_v2`
2. **E2E (staging)**: `playwright test tests/e2e/kiosk-v2.spec.ts`
3. **internal canary**: 社内 tenant で 2 週間運用 → エラーレート / 誤検知率を Grafana で確認
4. **early canary**: 1 早期顧客 tenant で 1 週間運用
5. **GA**: 全 tenant + Grafana 監視

## References

- 関連 Issue: #11 (顔認証 v3 と連携するため)
- 関連 PR: (実装中)
- Slack: #alc-dev
