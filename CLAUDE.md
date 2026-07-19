# switchbot-remote

SwitchBot API と Cloudflare Workers/Access を使ったエアコン・プラグ・照明 Web リモコン。

## 技術スタック

- **Worker**: `src/index.ts` — SwitchBot API への HMAC-SHA256 署名付きリクエスト中継
- **UI**: `public/index.html` 1ページに「家のエアコン」「家のプラグ」「家の照明（赤外線）」の3カードを縦に並べる構成。`public/app.js`（エアコン）・`public/plug-app.js`（プラグ）・`public/ir-light-app.js`（照明＝赤外線リモコン）を読み込む — Vanilla HTML/CSS/JS（フレームワークなし）
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
npx wrangler secret put PLUG_DEVICES
npx wrangler secret put IR_LIGHTS
```

`PLUG_DEVICES` / `IR_LIGHTS` はどちらも `{ "id": { "deviceId": "...", "label": "表示名" }, ... }` 形式のJSON文字列。デバイスを追加・削除する際はコード変更不要で、該当するsecretを更新して再デプロイするだけでよい。

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `src/index.ts` | Worker 本体。`POST /command`（エアコン）、`GET /plugs`・`POST /plug-command`（プラグ）、`GET /ir-lights`・`POST /ir-light-command`（照明＝赤外線）を受け取り SwitchBot API に転送 |
| `public/index.html` | エアコン・プラグ・照明 共通の1ページ UI + スタイル（`.remote` カードを3枚縦に並べる） |
| `public/app.js` | エアコンの状態管理・API 呼び出し・プリセット管理 |
| `public/plug-app.js` | プラグ一覧の取得・状態管理・API 呼び出し（`#plugList` にボタンを動的生成） |
| `public/ir-light-app.js` | 赤外線照明一覧の取得・状態管理・API 呼び出し（`#irLightList` にボタンを動的生成） |
| `wrangler.toml` | Cloudflare デプロイ設定 |

**注意**: `app.js` / `plug-app.js` / `ir-light-app.js` は同一ページで classic script として読み込まれ、グローバルスコープを共有する。関数名の衝突を避けるため、プラグ側は `Plug` 系（`setPlugPower` 等）、赤外線照明側は `IrLight` 系（`setIrLightPower`/`sendIrLightCommand`/`loadIrLightState`/`saveIrLightState`/`initIrLights`/`adjustIrBrightness`）の接頭辞・接尾辞を付けて命名している。`showToast`（`app.js`）と `renderButtons`（`plug-app.js`、ON/OFFボタンのハイライト処理）は共通利用しており、`ir-light-app.js` はそれらに依存するため **`app.js` → `plug-app.js` → `ir-light-app.js` の読み込み順を変更しないこと**。新しく家電を追加する場合も同様に、共有ページ内で関数名が衝突しないよう命名すること。

## UI の仕様メモ

### エアコン（`app.js`）
- **電源**: ON/OFF を独立したボタンとして分離（トグル式ではない）。冪等性のため、現在の状態に関わらずボタンは常に対応する `power` 値を明示的に送信する
- **温度**: `−` / `＋` で相対変更。SwitchBot API は `setAll`（絶対値）のみ対応のため、毎回 temperature/mode/fanSpeed/power をすべて送信する
- **プリセット温度**: `public/app.js` の `DEFAULT_PRESETS = [18, 22, 25, 27]` で初期値を管理。ユーザーが変更した値は `localStorage('ac_presets')` に保存される
- **状態の永続化**: 最後に送信した状態を `localStorage('ac_state')` に保存（エアコンは IR のため API から状態取得不可）

### プラグ（`plug-app.js`）
- 実体は SwitchBot プラグ（Plug Mini）による通電のON/OFF。明るさ・色温度などの制御は非対応
- 複数プラグに対応。ページ読み込み時に `GET /plugs` で `{id, label}` の一覧を取得し、プラグごとに ON/OFF ボタンを動的生成する（`deviceId` はサーバー側のみで保持し、フロントには渡さない）
- 電源は ON/OFF を独立したボタンとして分離（トグル式ではない）。冪等性のため、現在の状態に関わらずボタンは常に対応するコマンド（`turnOn`/`turnOff`）を明示的に送信する
- エアコンと同様、状態はプラグごとに `localStorage('plug_state_<id>')` に保存（プラグ自体はステータス取得APIに対応しているが、エアコンと構成を揃えるため未使用）
- プラグを増やす場合: SwitchBot API の `GET /v1.1/devices` で新しいプラグの `deviceId` を確認 → `PLUG_DEVICES` secret に追記して再デプロイ（フロント・Worker コード変更不要）。デバイス一覧確認用スクリプトは認証情報を含むためリポジトリには置かず、必要な都度ローカルで用意する

### 赤外線照明（`ir-light-app.js`）
- 実体は Hub 経由の赤外線バーチャルリモコン（`remoteType: "Light"`）。SwitchBot公式ドキュメントの対応コマンドは `turnOn` / `turnOff` / `brightnessUp` / `brightnessDown` の4つのみ（明るさの絶対値指定は不可、実機リモコンと同じ相対操作）
- Worker側で `IR_LIGHT_COMMANDS` ホワイトリストにより、上記4コマンド以外は `400` で拒否する（任意のコマンド文字列をSwitchBot APIにそのまま転送しないための安全対策）
- UIはON/OFFボタン＋明るさ`−`/`＋`ボタン（AC温度調整と同じ`.temp-btn`スタイルを流用）。明るさは相対操作のため数値表示は持たない
- ON/OFF状態のみ `localStorage('ir_light_state_<id>')` に保存（明るさは状態を持たないため保存対象外）
- プラグと同様、`IR_LIGHTS` secretを更新するだけでデバイス追加可能（コード変更不要）

## 制約

- 送風モード（`mode: 4`）は Panasonic AC 非対応 → UI で `disabled`
- 風量 5（最大風量）は公式ドキュメント外だが実機で動作確認済み
- API 呼び出し上限: 10,000回 / 日
