# switchbot-remote

SwitchBot APIとCloudflare Workers/Accessを使ったエアコンWebリモコン。  
GitHub認証付きのURLにアクセスするだけでスマホ・PCから自宅のエアコンを操作できる。

<img width="200" alt="s" src="https://github.com/user-attachments/assets/6f05a0ab-58dc-4e1b-adb7-bedaf86ace09" />

---

## システム全体像

```mermaid
flowchart LR
    subgraph Client["クライアント"]
        Browser["ブラウザ\n（スマホ / PC）"]
    end

    subgraph Cloudflare["Cloudflare"]
        Access["Cloudflare Access\nGitHub OAuth認証"]
        Worker["Cloudflare Workers\nswitchbot-remote"]
    end

    subgraph SwitchBot["SwitchBot"]
        API["SwitchBot API v1.1\napi.switch-bot.com"]
        Hub["Hub Mini"]
    end

    AC["エアコン\n（赤外線受信）"]

    Browser -->|"① HTTPS アクセス"| Access
    Access -->|"② JWT Cookie 発行"| Browser
    Browser -->|"③ リモコンUI 取得 / コマンド送信"| Worker
    Worker -->|"④ HMAC-SHA256 署名付きリクエスト"| API
    API -->|"⑤ IR 信号送出指示"| Hub
    Hub -->|"⑥ 赤外線"| AC
```

---

## 認証フロー

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant Access as Cloudflare Access
    participant GitHub
    participant Worker as Cloudflare Workers

    User->>Access: URL にアクセス
    Access->>User: GitHub ログイン画面にリダイレクト
    User->>GitHub: 認証・認可
    GitHub->>Access: OAuth コールバック
    Access->>Access: 許可メールアドレスと照合
    Access->>User: JWT セッション Cookie 発行
    User->>Worker: リクエスト（Cookie 付き）
    Worker->>User: UI または API レスポンス
```

---

## コマンド送信フロー

```mermaid
sequenceDiagram
    actor User as ユーザー
    participant UI as リモコン UI（HTML/JS）
    participant Worker as Cloudflare Workers
    participant API as SwitchBot API
    participant Hub as Hub Mini
    participant AC as エアコン

    User->>UI: ボタン操作（例：冷房 26°C）
    UI->>UI: localStorage から現在の状態を取得
    UI->>Worker: POST /command\n{ temperature, mode, fanSpeed, power }
    Worker->>Worker: HMAC-SHA256 署名を生成
    Worker->>API: POST /v1.1/devices/{deviceId}/commands\nsetAll: "26,2,1,on"
    API->>Hub: IR 信号送出指示
    Hub->>AC: 赤外線送信
    API->>Worker: { statusCode: 100, message: "success" }
    Worker->>UI: 成功レスポンス
    UI->>User: トースト通知「送信しました ✓」
```

---

## 技術選定

| 領域 | 採用技術 | 理由 |
|---|---|---|
| API 中継 | Cloudflare Workers (TypeScript) | エッジで動作・無料枠が大きい・Web Crypto API が使えるため外部ライブラリ不要 |
| 認証 | Cloudflare Access + GitHub OAuth | 設定のみで実装ゼロ・無料枠50ユーザー・個人利用に最適 |
| UI 配信 | Workers Static Assets | Workers と同一オリジンで配信できるため CORS 不要・別途 Pages デプロイも不要 |
| フロントエンド | Vanilla HTML/CSS/JS | 操作UIが単純なためフレームワーク不要・依存ゼロ |
| 状態管理 | localStorage | エアコンは IR のため API からリアルタイム状態取得不可。最後に送信した値をブラウザに保持する |
| HMAC 署名 | Web Crypto API (SHA-256) | Workers ランタイムのネイティブ API。外部ライブラリ不要 |

---

## 制約・既知の仕様

- **エアコンの状態は単方向**  
  Hub Mini は IR 信号を送るだけで、エアコン本体からのフィードバックはない。  
  アプリ側リモコン・本体リモコンで操作した場合、Web UI の表示と実際の設定がズレる可能性がある。

- **温度の相対変更（+1/-1°C）は API 非対応**  
  SwitchBot API のエアコンコマンドは `setAll`（絶対値指定）のみ。  
  温度・モード・風量・電源をまとめて毎回送信する必要がある。

- **1日あたりのAPI呼び出し上限: 10,000回**

- **風量はAPIドキュメント外の値が存在する**  
  公式ドキュメントの風量値は `1=auto, 2=low, 3=medium, 4=high` の4種だが、  
  実機検証により `fanSpeed: 5` が存在し、最大風量として動作することを確認。  
  アプリ上の表示は「自動・風量1・風量2・風量3・風量4」の5択。

- **送風モード（`mode: 4`）はPanasonic AC非対応**  
  APIに送信すると `failed to query command by mode: not match mode` エラーが返る。  
  UIでは `disabled` 表示とし、選択不可にしている。

---

## ディレクトリ構成

```
switchbot-remote/
├── src/
│   └── index.ts          # Cloudflare Workers（API中継）
├── public/
│   └── index.html        # リモコン UI
└── wrangler.toml         # Cloudflare デプロイ設定
```

---

## Workers API 仕様

### `POST /command`

エアコンへ `setAll` コマンドを送信する。

**リクエストボディ**

```json
{
  "temperature": 26,
  "mode": 2,
  "fanSpeed": 1,
  "power": "on"
}
```

| フィールド | 型 | 値 |
|---|---|---|
| temperature | number | 16〜30（°C） |
| mode | number | 1: 自動 / 2: 冷房 / 3: 除湿 / 4: 送風 / 5: 暖房 |
| fanSpeed | number | 1: 自動 / 2: 弱 / 3: 中 / 4: 強 |
| power | string | `"on"` / `"off"` |

**レスポンス例**

```json
{ "statusCode": 100, "body": {}, "message": "success" }
```

---

## セットアップ手順

### 前提条件

- Cloudflare アカウント
- GitHub アカウント（OAuth App 作成済み）
- SwitchBot アカウント（トークン・シークレット発行済み）
- Node.js / npm

### 1. 依存インストール・デプロイ

```bash
cd switchbot-remote
npm install
npx wrangler secret put SWITCHBOT_TOKEN
npx wrangler secret put SWITCHBOT_SECRET
npx wrangler deploy
```

### 2. Cloudflare Access 設定

1. Zero Trust → インテグレーション → ID プロバイダー → GitHub を追加
2. Access コントロール → アプリケーション → 新規作成（Self-hosted）
3. ドメインに `switchbot-remote.<team>.workers.dev` を設定
4. ポリシーで自分のメールアドレスのみ許可
