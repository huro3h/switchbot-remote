# switchbot-remote

SwitchBot API と Cloudflare Workers/Access を使ったエアコン・照明 Web リモコン。

## 技術スタック

- **Worker**: `src/index.ts` — SwitchBot API への HMAC-SHA256 署名付きリクエスト中継
- **UI**: `public/index.html` 1ページに「家のエアコン」「家の照明」の2カードを縦に並べる構成。`public/app.js`（エアコン）と `public/light-app.js`（照明）を両方読み込む — Vanilla HTML/CSS/JS（フレームワークなし）
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
npx wrangler secret put AC_DEVICE_ID
npx wrangler secret put LIGHT_DEVICES
```

`LIGHT_DEVICES` は `{ "id": { "deviceId": "...", "label": "表示名" }, ... }` 形式のJSON文字列。照明を追加・削除する際はコード変更不要で、このsecretを更新して再デプロイするだけでよい。

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `src/index.ts` | Worker 本体。`POST /command`（エアコン）、`GET /lights`・`POST /light-command`（照明）を受け取り SwitchBot API に転送 |
| `public/index.html` | エアコン・照明 共通の1ページ UI + スタイル（`.remote` カードを2枚縦に並べる） |
| `public/app.js` | エアコンの状態管理・API 呼び出し・プリセット管理 |
| `public/light-app.js` | 照明一覧の取得・状態管理・API 呼び出し（`#lightList` にボタンを動的生成） |
| `wrangler.toml` | Cloudflare デプロイ設定 |

**注意**: `app.js` と `light-app.js` は同一ページで classic script として読み込まれ、グローバルスコープを共有する。関数名の衝突を避けるため、照明側の関数は `setLightPower` / `sendLightCommand` / `loadLightState` / `saveLightState` / `initLights` のように `Light` 系の接頭辞・接尾辞を付けて命名している（`showToast` はエアコン側 `app.js` の定義を共有）。新しく家電を追加する場合も同様に、共有ページ内で関数名が衝突しないよう命名すること。

## UI の仕様メモ

### エアコン（`app.js`）
- **電源**: ON/OFF を独立したボタンとして分離（トグル式ではない）。冪等性のため、現在の状態に関わらずボタンは常に対応する `power` 値を明示的に送信する
- **温度**: `−` / `＋` で相対変更。SwitchBot API は `setAll`（絶対値）のみ対応のため、毎回 temperature/mode/fanSpeed/power をすべて送信する
- **プリセット温度**: `public/app.js` の `DEFAULT_PRESETS = [18, 22, 25, 27]` で初期値を管理。ユーザーが変更した値は `localStorage('ac_presets')` に保存される
- **状態の永続化**: 最後に送信した状態を `localStorage('ac_state')` に保存（エアコンは IR のため API から状態取得不可）

### 照明（`light-app.js`）
- 実体は SwitchBot プラグ（Plug Mini）による通電のON/OFF。明るさ・色温度などの制御は非対応
- 複数照明に対応。ページ読み込み時に `GET /lights` で `{id, label}` の一覧を取得し、照明ごとに ON/OFF ボタンを動的生成する（`deviceId` はサーバー側のみで保持し、フロントには渡さない）
- 電源は ON/OFF を独立したボタンとして分離（トグル式ではない）。冪等性のため、現在の状態に関わらずボタンは常に対応するコマンド（`turnOn`/`turnOff`）を明示的に送信する
- エアコンと同様、状態は照明ごとに `localStorage('light_state_<id>')` に保存（プラグ自体はステータス取得APIに対応しているが、エアコンと構成を揃えるため未使用）
- 照明を増やす場合: SwitchBot API の `GET /v1.1/devices` で新しいプラグの `deviceId` を確認 → `LIGHT_DEVICES` secret に追記して再デプロイ（フロント・Worker コード変更不要）。デバイス一覧確認用スクリプトは認証情報を含むためリポジトリには置かず、必要な都度ローカルで用意する

## 制約

- 送風モード（`mode: 4`）は Panasonic AC 非対応 → UI で `disabled`
- 風量 5（最大風量）は公式ドキュメント外だが実機で動作確認済み
- API 呼び出し上限: 10,000回 / 日
