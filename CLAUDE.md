# switchbot-remote

SwitchBot API と Cloudflare Workers/Access を使ったエアコン Web リモコン。

## 技術スタック

- **Worker**: `src/index.ts` — SwitchBot API への HMAC-SHA256 署名付きリクエスト中継
- **UI**: `public/index.html` + `public/app.js` — Vanilla HTML/CSS/JS（フレームワークなし）
- **ホスティング**: Cloudflare Workers Static Assets（同一オリジン配信、CORS 不要）
- **認証**: Cloudflare Access + GitHub OAuth（Workers の前段で処理、Worker 側の実装不要）

## デプロイ

```bash
npx wrangler deploy
```

ビルドステップなし。wrangler が TypeScript のコンパイルも込みで実行する。  
デプロイ先: `https://switchbot-remote.huro3h-cloudflare.workers.dev`

## Secrets（初回のみ設定済み、再設定は不要）

```bash
npx wrangler secret put SWITCHBOT_TOKEN
npx wrangler secret put SWITCHBOT_SECRET
```

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `src/index.ts` | Worker 本体。`POST /command` を受け取り SwitchBot API に転送 |
| `public/index.html` | UI + スタイル |
| `public/app.js` | 状態管理・API 呼び出し・プリセット管理 |
| `wrangler.toml` | Cloudflare デプロイ設定 |

## UI の仕様メモ

- **温度**: `−` / `＋` で相対変更。SwitchBot API は `setAll`（絶対値）のみ対応のため、毎回 temperature/mode/fanSpeed/power をすべて送信する
- **プリセット温度**: `public/app.js` の `DEFAULT_PRESETS = [18, 22, 25, 27]` で初期値を管理。ユーザーが変更した値は `localStorage('ac_presets')` に保存される
- **状態の永続化**: 最後に送信した状態を `localStorage('ac_state')` に保存（エアコンは IR のため API から状態取得不可）

## 制約

- 送風モード（`mode: 4`）は Panasonic AC 非対応 → UI で `disabled`
- 風量 5（最大風量）は公式ドキュメント外だが実機で動作確認済み
- API 呼び出し上限: 10,000回 / 日
