# switchbot-remote

SwitchBot API と Cloudflare Workers/Access を使ったエアコン・プラグ・照明 Web リモコン。

## 技術スタック

- **Worker**: `src/index.ts` — SwitchBot API への HMAC-SHA256 署名付きリクエスト中継
- **UI**: `public/index.html` 1ページにエアコン・センサー（部屋の環境）・「家のプラグ」・「家の照明（赤外線）」の4カードを縦に並べる構成（エアコンとセンサーのカードは見出しなし）。`public/app.js`（エアコン）・`public/plug-app.js`（プラグ）・`public/ir-light-app.js`（照明＝赤外線リモコン）・`public/sensor-app.js`（センサー）を読み込む — Vanilla HTML/CSS/JS（フレームワークなし）
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
npx wrangler secret put SENSOR_DEVICES
```

`PLUG_DEVICES` / `IR_LIGHTS` / `SENSOR_DEVICES` はいずれも `{ "id": { "deviceId": "...", "label": "表示名" }, ... }` 形式のJSON文字列。デバイスを追加・削除する際はコード変更不要で、該当するsecretを更新して再デプロイするだけでよい。

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `src/index.ts` | Worker 本体。`POST /command`（エアコン）、`GET /plugs`・`POST /plug-command`（プラグ）、`GET /ir-lights`・`POST /ir-light-command`（照明＝赤外線）、`GET /sensors`（温湿度・CO2）を受け取り SwitchBot API に転送 |
| `public/index.html` | エアコン・プラグ・照明 共通の1ページ UI + スタイル（`.remote` カードを3枚縦に並べる） |
| `public/app.js` | エアコンの状態管理・API 呼び出し・プリセット管理 |
| `public/plug-app.js` | プラグ一覧の取得・状態管理・API 呼び出し（`#plugList` にボタンを動的生成） |
| `public/ir-light-app.js` | 赤外線照明一覧の取得・状態管理・API 呼び出し（`#irLightList` にボタンを動的生成） |
| `public/sensor-app.js` | センサーの計測値取得・表示（`#sensorList` に室温／湿度／CO2を動的生成。読み取り専用） |
| `public/auto-app.js` | 室温連動の自動制御（閾値判定 → プリセット送信。ブラウザ側で動作） |
| `wrangler.toml` | Cloudflare デプロイ設定 |

**注意**: `app.js` / `plug-app.js` / `ir-light-app.js` は同一ページで classic script として読み込まれ、グローバルスコープを共有する。関数名の衝突を避けるため、プラグ側は `Plug` 系（`setPlugPower` 等）、赤外線照明側は `IrLight` 系（`setIrLightPower`/`sendIrLightCommand`/`loadIrLightState`/`saveIrLightState`/`initIrLights`/`adjustIrBrightness`）、センサー側は `Sensor` 系（`initSensors`/`refreshSensors`/`buildSensorRow`/`buildSensorMetric`）、自動制御側は `Auto` 系（`toggleAutoControl`/`saveAutoRules`/`sendAutoPreset`/`renderAutoControl`）の接頭辞・接尾辞を付けて命名している。`showToast`（`app.js`）と `renderButtons`（`plug-app.js`、ON/OFFボタンのハイライト処理）は共通利用しており、`ir-light-app.js` / `sensor-app.js` はそれらに依存するため **`app.js` → `plug-app.js` → `ir-light-app.js` → `sensor-app.js` → `auto-app.js` の読み込み順を変更しないこと**。`auto-app.js` は最後に読み込まれるため、`sensor-app.js` の `onSensorsUpdated()` 呼び出しと `app.js` の `saveAndClosePresets()` からの `renderAutoControl()` 呼び出しは `typeof ... === 'function'` で存在チェックしてから行う。新しく家電を追加する場合も同様に、共有ページ内で関数名が衝突しないよう命名すること。

## UI の仕様メモ

### エアコン（`app.js`）
- **電源**: ON/OFF を独立したボタンとして分離（トグル式ではない）。冪等性のため、現在の状態に関わらずボタンは常に対応する `power` 値を明示的に送信する
- **モード**: 普段は「モード：冷房」のようにテキスト表示のみ。右の「変更」でボタン群を開き、選ぶと送信して自動的に閉じる（頻繁に切り替えるものではないため常時表示しない）。表示名は `MODE_LABELS` で管理
- **温度**: `−` / `＋` で相対変更。SwitchBot API は `setAll`（絶対値）のみ対応のため、毎回 temperature/mode/fanSpeed/power をすべて送信する
- **プリセット（温度＋風量）**: 「20°C 自動」「26°C 風量4」のように温度と風量の組み合わせを5つ保存できる。数は `DEFAULT_PRESETS` の要素数で決まり、保存済みが足りない場合はデフォルトで補われるため、配列に足すだけで増やせる。`public/app.js` の `DEFAULT_PRESETS`（`{ temperature, fanSpeed }` の配列）で初期値を管理し、ユーザーが変更した値は `localStorage('ac_presets')` に保存される。旧形式（`[18, 22, 25, 27]` のような数値配列）は `normalizePreset()` で `{ temperature, fanSpeed: 1 }` に自動移行する
- **モードはプリセットに含めない**: プリセット適用時は温度・風量のみ書き換え、`mode` は画面で現在選択中の値（`state.mode`）をそのまま送信する（`setAll` は全項目必須のため）。現在の温度・風量と一致するプリセットボタンはハイライトされる
- **状態の永続化**: 最後に送信した状態を `localStorage('ac_state')` に保存（エアコンは IR のため API から状態取得不可）

### プラグ（`plug-app.js`）
- 実体は SwitchBot プラグ（Plug Mini）による通電のON/OFF。明るさ・色温度などの制御は非対応
- 複数プラグに対応。ページ読み込み時に `GET /plugs` で `{id, label, power}` の一覧を取得し、プラグごとに ON/OFF ボタンを動的生成する（`deviceId` はサーバー側のみで保持し、フロントには渡さない）
- **実際の電源状態をAPIから取得（エアコンとの違い）**: プラグは双方向通信のため、Worker が `GET /plugs` 内でプラグごとに SwitchBot API の `GET /v1.1/devices/{deviceId}/status` を呼び出し、実際の `power` 値を返す。エアコン（IR、単方向）と違い本体・アプリ操作とのズレが生じない。ステータス取得に失敗した場合（`statusCode !== 100` や通信エラー）は `power: null` を返し、フロント側で `localStorage('plug_state_<id>')` にフォールバックする
- 電源は ON/OFF を独立したボタンとして分離（トグル式ではない）。冪等性のため、現在の状態に関わらずボタンは常に対応するコマンド（`turnOn`/`turnOff`）を明示的に送信する
- コマンド送信成功時は `localStorage('plug_state_<id>')` にも保存する（フォールバック用のキャッシュとして維持）
- プラグを増やす場合: SwitchBot API の `GET /v1.1/devices` で新しいプラグの `deviceId` を確認 → `PLUG_DEVICES` secret に追記して再デプロイ（フロント・Worker コード変更不要）。デバイス一覧確認用スクリプトは認証情報を含むためリポジトリには置かず、必要な都度ローカルで用意する

### 赤外線照明（`ir-light-app.js`）
- 実体は Hub 経由の赤外線バーチャルリモコン（`remoteType: "Light"`）。SwitchBot公式ドキュメントの対応コマンドは `turnOn` / `turnOff` / `brightnessUp` / `brightnessDown` の4つのみ（明るさの絶対値指定は不可、実機リモコンと同じ相対操作）
- Worker側で `IR_LIGHT_COMMANDS` ホワイトリストにより、上記4コマンド以外は `400` で拒否する（任意のコマンド文字列をSwitchBot APIにそのまま転送しないための安全対策）
- UIはON/OFFボタン＋明るさ`−`/`＋`ボタン（AC温度調整と同じ`.temp-btn`スタイルを流用）。明るさは相対操作のため数値表示は持たない
- ON/OFF状態のみ `localStorage('ir_light_state_<id>')` に保存（明るさは状態を持たないため保存対象外）
- プラグと同様、`IR_LIGHTS` secretを更新するだけでデバイス追加可能（コード変更不要）

### センサー（`sensor-app.js`）
- 実体は温湿度計Pro CO2（`deviceType: MeterPro(CO2)`）。ページ読み込み時に `GET /sensors` を呼び、室温・湿度・CO2・電池残量を表示する（コマンド送信はない読み取り専用カード）
- センサーが1台のときはデバイス名ラベルを出さない（`buildSensorRow(sensor, showLabel)`。2台以上登録された場合のみ表示する）
- **Hub Mini 自体はセンサーを持たない**（公式ドキュメントに Device Status の定義がない）。室温・湿度は Meter / MeterPlus / MeterPro / Hub 2 / Hub 3、CO2 は `MeterPro(CO2)` のみ取得可能。Hub Mini はセンサー値をクラウドへ中継する役割
- Worker は SwitchBot の `GET /v1.1/devices/{deviceId}/status` を呼び、`temperature` / `humidity` / `CO2`（レスポンスは大文字）/ `battery` を `{id, label, temperature, humidity, co2, battery}` に整形して返す。取得失敗時は各値 `null` で、フロントは `—` を表示する
- `SENSOR_DEVICES` secret が未設定でもページが壊れないよう、Worker 側は空オブジェクト扱い（`getSensorDevices()` が try/catch）、フロント側は空配列ならカードごと `hidden` にする
- CO2 は 1000ppm 以上でオレンジ、1500ppm 以上で赤く表示（`CO2_WARN` / `CO2_BAD`）
- **更新**: カード右下に「更新」（手動再取得）と「自動更新」トグル、間隔プリセット（`SENSOR_INTERVALS` = 30秒/1分/5分。自動更新ONのときだけ表示）を置く。設定は `localStorage('sensor_auto')` に `{enabled, intervalSec}` で保存する
- 自動更新は `setInterval` ではなく毎回 `setTimeout` を張り直す方式（`scheduleSensorAuto()`）。取得が遅れてもリクエストが重ならない
- **タブが非表示・非アクティブの間は停止**（`visibilitychange` で `stopSensorAuto()`）、復帰時に即座に再取得してからタイマーを再開する。開きっぱなしでも API 呼び出しを消費しない
- API 上限は 10,000回/日。`GET /sensors` はセンサー1台につき1リクエストを消費するため、30秒間隔×1台＝2,880回/日が目安（タブの数だけ倍増する）
- デバイス一覧（`deviceId` の確認）は SwitchBot の `GET /v1.1/devices` で取得する。認証情報を含むためスクリプトはリポジトリに置かず、必要な都度ローカルで用意する

### 自動制御・室温連動（`auto-app.js`）
- **稼働状態のバッジ**: 自動制御ON時、`#autoStatus` に「稼働中 — 30秒ごとに室温を判定」（緑・点滅ドット）、「待機中 — 自動更新がOFF / エアコンがOFF」（オレンジ）、「停止中 — タブが隠れています」（赤）を表示する。隠れている間はバッジを見られないため、復帰直後 `SENSOR_PAUSE_NOTICE_MS`（6秒）だけ「停止していました — 12:30から15分間」を残してから通常表示に戻す。タブが隠れて実際に停止しているときは `document.title` に `⏸` を付ける（PCのタブバーなら非表示中も見える。`renderPageTitle()`。自動更新OFFのときは元から動いていないので付けない）。原因がセンサーの自動更新なら、その場で直せる「自動更新をON」ボタンを出す（`autoStatusState()`）
- センサーカード側も自動更新中は「● 30秒ごとに更新中 · 04:22」と表示する（`renderSensorUpdatedAt()`）
- **表示の連動**: 稼働状態は「自動制御ON」「センサー自動更新ON」「エアコンON」の3つに依存するため、`renderSensorControls()`（センサー側）と `renderUI()`（エアコン側）の両方から `renderAutoControl()` を呼ぶ。どれかを忘れると表示が古いまま残る
- **ブラウザ側の実装。ページを開いている間だけ動く**（サーバー側のCronではない）。`sensor-app.js` が `GET /sensors` を取得するたびに `onSensorsUpdated()` が呼ばれ、そこで判定する。したがって**センサーの自動更新がOFFだと事実上動かない**
- ルール: 「N℃を上回ったらプリセットX」「M℃を下回ったらプリセットY」。設定は `localStorage('auto_control')` に `{enabled, hotTemp, hotPreset, coldTemp, coldPreset, lastPreset, lastSentAt}` で保存
- **画面のエアコンがONのときだけ動く**（`state.power !== 'on'` なら何もしない）。手動でOFFにすれば自動制御も止まり、自動制御が勝手に電源を入れることはない。ただし `state.power` はアプリが最後に送った状態であり、付属リモコンで消した場合は画面上ONのまま＝動作し続ける点に注意。温度・風量はプリセット値、モードは画面で選択中の `state.mode` を送る
- 誤動作・赤外線の連打を防ぐ3段構え: ①閾値の間（デッドバンド）は何もしない ②エアコンが既に目標プリセットと同じ温度・風量なら送らない（毎回ピッと鳴るため）。判定は「前回送ったプリセット（`lastPreset`）」ではなく画面の現在値（`state`）と比較する — `lastPreset` と比べると、自動送信のあと手動で温度・風量を変えたときに実態とズレて再送されなくなる ③`AUTO_COOLDOWN_MS`（3分）以内は送らない。③があるため、逆方向の条件を満たしても最大3分は待つ
- サーバー側（Cron Trigger + D1）に移す構想は `docs/schedule-design.md` の構成と揃える想定

## バージョニング

セマンティックバージョニング（`MAJOR.MINOR.PATCH`）で管理する。現在 `1.0.0`。

- **破壊的変更**（既存の `localStorage` キーの意味が変わる、secret の形式が変わる等）は MAJOR
- **機能追加**（新しいデバイス種別、新しいUI機能）は MINOR
- **バグ修正・表示調整**は PATCH

変更を加えたら、まず `CHANGELOG.md` の `## [Unreleased]` に追記していく（`### 追加` / `### 変更` / `### 修正` / `### 削除`）。リリース時に `[Unreleased]` をバージョン見出しに置き換える。

リリース手順:

```bash
npm version <major|minor|patch> --no-git-tag-version   # package.json を更新
# CHANGELOG.md の [Unreleased] を ## [X.Y.Z] - YYYY-MM-DD にし、
#   新しい空の [Unreleased] と、最下部の比較リンクを追加する
git commit -am "vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
npx wrangler deploy
```

**画面のバージョン表示は `package.json` から自動で入る**（二重管理を避けるため）。`src/index.ts` が `package.json` を import し、`HTMLRewriter` で `#appVersion` の中身に `v{version}` を流し込む。HTML に数値を直書きしないこと。

この仕組みのため `wrangler.toml` の `[assets]` に `run_worker_first = ["/", "/index.html"]` を指定している。**これがないと HTML はWorkerを経由せずアセットサーバーから直接配信され、バージョンが空のままになる**（JS・CSS・画像は従来どおり直接配信）。

手で書く必要があるのは `package.json` の `version` と `CHANGELOG.md` の見出しの2か所のみ。

Cloudflare 側の Version ID（`wrangler deploy` が出力）はデプロイごとに変わる別物で、アプリのバージョンとは対応しない。

## 制約

- 送風モード（`mode: 4`）は Panasonic AC 非対応 → UI で `disabled`
- 風量 5（最大風量）は公式ドキュメント外だが実機で動作確認済み
- API 呼び出し上限: 10,000回 / 日
