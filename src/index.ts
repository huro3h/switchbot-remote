const SWITCHBOT_API_BASE = 'https://api.switch-bot.com';

interface LightDevice {
  deviceId: string;
  label: string;
}

export interface Env {
  SWITCHBOT_TOKEN: string;
  SWITCHBOT_SECRET: string;
  AC_DEVICE_ID: string;
  // JSON文字列: { "id": { "deviceId": "...", "label": "表示名" }, ... }
  LIGHT_DEVICES: string;
  // JSON文字列: { "id": { "deviceId": "...", "label": "表示名" }, ... }（赤外線リモコンの照明）
  IR_LIGHTS: string;
  ASSETS: Fetcher;
}

function getLightDevices(env: Env): Record<string, LightDevice> {
  return JSON.parse(env.LIGHT_DEVICES);
}

function getIrLights(env: Env): Record<string, LightDevice> {
  return JSON.parse(env.IR_LIGHTS);
}

const IR_LIGHT_COMMANDS = new Set(['turnOn', 'turnOff', 'brightnessUp', 'brightnessDown']);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function buildSwitchBotHeaders(token: string, secret: string): Promise<Record<string, string>> {
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const stringToSign = `${token}${t}${nonce}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(stringToSign));
  const sign = btoa(String.fromCharCode(...new Uint8Array(signature))).toUpperCase();

  return {
    Authorization: token,
    sign,
    t,
    nonce,
    'Content-Type': 'application/json',
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const { pathname } = new URL(request.url);
    const sbHeaders = await buildSwitchBotHeaders(env.SWITCHBOT_TOKEN, env.SWITCHBOT_SECRET);

    // POST /command — エアコンへコマンド送信
    // body: { temperature: number, mode: number, fanSpeed: number, power: "on"|"off" }
    if (pathname === '/command' && request.method === 'POST') {
      const { temperature, mode, fanSpeed, power } = await request.json<{
        temperature: number;
        mode: number;
        fanSpeed: number;
        power: 'on' | 'off';
      }>();

      const res = await fetch(`${SWITCHBOT_API_BASE}/v1.1/devices/${env.AC_DEVICE_ID}/commands`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          command: 'setAll',
          parameter: `${temperature},${mode},${fanSpeed},${power}`,
          commandType: 'command',
        }),
      });
      return jsonResponse(await res.json());
    }

    // GET /lights — 登録済み照明一覧（deviceIdは非公開、id/labelのみ返す）
    if (pathname === '/lights' && request.method === 'GET') {
      const lights = Object.entries(getLightDevices(env)).map(([id, d]) => ({ id, label: d.label }));
      return jsonResponse(lights);
    }

    // POST /light-command — 照明（プラグ）へ電源コマンド送信
    // body: { id: string, power: "on"|"off" }
    if (pathname === '/light-command' && request.method === 'POST') {
      const { id, power } = await request.json<{ id: string; power: 'on' | 'off' }>();

      const device = getLightDevices(env)[id];
      if (!device) {
        return jsonResponse({ message: `unknown light id: ${id}` }, 404);
      }

      const res = await fetch(`${SWITCHBOT_API_BASE}/v1.1/devices/${device.deviceId}/commands`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          command: power === 'on' ? 'turnOn' : 'turnOff',
          parameter: 'default',
          commandType: 'command',
        }),
      });
      return jsonResponse(await res.json());
    }

    // GET /ir-lights — 登録済み赤外線照明一覧（deviceIdは非公開、id/labelのみ返す）
    if (pathname === '/ir-lights' && request.method === 'GET') {
      const lights = Object.entries(getIrLights(env)).map(([id, d]) => ({ id, label: d.label }));
      return jsonResponse(lights);
    }

    // POST /ir-light-command — 赤外線照明へコマンド送信
    // body: { id: string, command: "turnOn"|"turnOff"|"brightnessUp"|"brightnessDown" }
    if (pathname === '/ir-light-command' && request.method === 'POST') {
      const { id, command } = await request.json<{ id: string; command: string }>();

      if (!IR_LIGHT_COMMANDS.has(command)) {
        return jsonResponse({ message: `unsupported command: ${command}` }, 400);
      }

      const device = getIrLights(env)[id];
      if (!device) {
        return jsonResponse({ message: `unknown light id: ${id}` }, 404);
      }

      const res = await fetch(`${SWITCHBOT_API_BASE}/v1.1/devices/${device.deviceId}/commands`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          command,
          parameter: 'default',
          commandType: 'command',
        }),
      });
      return jsonResponse(await res.json());
    }

    return env.ASSETS.fetch(request);
  },
};
