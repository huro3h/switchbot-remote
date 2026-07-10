const SWITCHBOT_API_BASE = 'https://api.switch-bot.com';

export interface Env {
  SWITCHBOT_TOKEN: string;
  SWITCHBOT_SECRET: string;
  AC_DEVICE_ID: string;
  ASSETS: Fetcher;
}

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

    return env.ASSETS.fetch(request);
  },
};
