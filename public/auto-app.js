// 室温連動の自動制御。センサー値を取得するたびに判定し、条件を満たしたらプリセットを送信する。
// ページを開いている間だけ動く（サーバー側のCron実装ではない）。
const AUTO_DEFAULT = { enabled: false, hotTemp: 27, hotPreset: 0, coldTemp: 25, coldPreset: 3 };
// 同じ条件で赤外線を連打しないためのクールダウン（同じプリセットは再送しない＋最低間隔）
const AUTO_COOLDOWN_MS = 3 * 60 * 1000;

let autoConfig = { ...AUTO_DEFAULT, ...JSON.parse(localStorage.getItem('auto_control') || '{}') };
let autoSending = false;

function saveAutoConfig() {
  localStorage.setItem('auto_control', JSON.stringify(autoConfig));
}

function presetSummary(index) {
  const preset = presets[index];
  return preset ? preset.temperature + '°C ' + fanLabel(preset.fanSpeed) : '—';
}

function buildAutoPresetSelect(selectId, selected) {
  const select = document.getElementById(selectId);
  select.innerHTML = '';
  presets.forEach((_, i) => {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = (i + 1) + '： ' + presetSummary(i);
    option.selected = i === selected;
    select.appendChild(option);
  });
}

function buildAutoControlUI() {
  document.getElementById('autoHotTemp').value = autoConfig.hotTemp;
  document.getElementById('autoColdTemp').value = autoConfig.coldTemp;
  buildAutoPresetSelect('autoHotPreset', autoConfig.hotPreset);
  buildAutoPresetSelect('autoColdPreset', autoConfig.coldPreset);
}

// 「いま実際に判定が回っているか」を1行で示す。判定はセンサー取得のたびに行うため、
// 自動制御ON・センサー自動更新ON・エアコンON の3つが揃ってはじめて稼働中になる
function autoStatusState() {
  if (!sensorAuto.enabled) {
    return { cls: 'wait', text: '待機中 — 自動更新がOFF', fix: 'sensor' };
  }
  if (document.hidden) {
    return { cls: 'stopped', text: '停止中 — タブが隠れています' };
  }
  if (sensorPauseInfo) {
    const at = new Date(sensorPauseInfo.hiddenAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    return { cls: 'stopped', text: `停止していました — ${at}から${formatDuration(sensorPauseInfo.ms)}` };
  }
  if (state.power !== 'on') {
    return { cls: 'wait', text: '待機中 — エアコンがOFF' };
  }
  const interval = SENSOR_INTERVALS.find((i) => i.value === sensorAuto.intervalSec);
  return { cls: 'live', text: `稼働中 — ${interval ? interval.label : sensorAuto.intervalSec + '秒'}ごとに室温を判定` };
}

function renderAutoStatus() {
  const row = document.getElementById('autoStatus');
  const status = autoStatusState();
  row.className = 'auto-status ' + status.cls;
  row.innerHTML = '';

  const dot = document.createElement('span');
  dot.className = 'auto-dot';
  row.appendChild(dot);

  const text = document.createElement('span');
  text.textContent = status.text;
  row.appendChild(text);

  // 原因がセンサーの自動更新なら、その場で直せるボタンを出す
  if (status.fix === 'sensor') {
    const btn = document.createElement('button');
    btn.className = 'auto-fix-btn';
    btn.textContent = '自動更新をON';
    btn.onclick = toggleSensorAuto;
    row.appendChild(btn);
  }
}

function renderAutoControl() {
  const toggle = document.getElementById('autoControlToggle');
  toggle.classList.toggle('on', autoConfig.enabled);
  toggle.setAttribute('aria-pressed', autoConfig.enabled ? 'true' : 'false');
  document.getElementById('autoControlBody').hidden = !autoConfig.enabled;
  buildAutoControlUI();
  renderAutoStatus();

  const lines = [];
  if (autoConfig.lastSentAt) {
    const at = new Date(autoConfig.lastSentAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    lines.push(`最終送信 ${at} — プリセット${autoConfig.lastPreset + 1}（${presetSummary(autoConfig.lastPreset)}）`);
  } else {
    lines.push('まだ送信していません');
  }
  lines.push('このページを開いている間だけ動きます');
  document.getElementById('autoControlStatus').innerHTML = lines.join('<br>');
}

function toggleAutoControl() {
  autoConfig.enabled = !autoConfig.enabled;
  saveAutoConfig();
  renderAutoControl();
}

function saveAutoRules() {
  autoConfig.hotTemp = parseFloat(document.getElementById('autoHotTemp').value) || AUTO_DEFAULT.hotTemp;
  autoConfig.coldTemp = parseFloat(document.getElementById('autoColdTemp').value) || AUTO_DEFAULT.coldTemp;
  autoConfig.hotPreset = parseInt(document.getElementById('autoHotPreset').value, 10) || 0;
  autoConfig.coldPreset = parseInt(document.getElementById('autoColdPreset').value, 10) || 0;
  saveAutoConfig();
  renderAutoControl();
}

async function sendAutoPreset(index, temperature) {
  autoSending = true;
  state.temperature = presets[index].temperature;
  state.fanSpeed = presets[index].fanSpeed;
  renderUI();
  try {
    const ok = await sendCommand();
    if (ok) {
      autoConfig.lastPreset = index;
      autoConfig.lastSentAt = Date.now();
      saveAutoConfig();
      showToast(`自動制御: ${temperature}°C → プリセット${index + 1}`);
    }
  } finally {
    autoSending = false;
    renderAutoControl();
  }
}

// センサー取得のたびに sensor-app.js から呼ばれる
function onSensorsUpdated(sensors) {
  if (!autoConfig.enabled || autoSending) return;
  // 画面のエアコンがOFFの間は何もしない（手動でOFFにしたら自動制御も止まる）
  // ただし赤外線のため、これはアプリが最後に送った状態であって実機の状態ではない
  if (state.power !== 'on') return;

  const temperature = sensors.map((s) => s.temperature).find((t) => typeof t === 'number');
  if (temperature === undefined) return;

  let target = null;
  if (temperature > autoConfig.hotTemp) target = autoConfig.hotPreset;
  else if (temperature < autoConfig.coldTemp) target = autoConfig.coldPreset;
  if (target === null) return; // 閾値の間（デッドバンド）は何もしない

  if (target === autoConfig.lastPreset) return; // 同じ設定の再送はしない（毎回ピッと鳴るため）
  if (autoConfig.lastSentAt && Date.now() - autoConfig.lastSentAt < AUTO_COOLDOWN_MS) return;

  sendAutoPreset(target, temperature);
}

renderAutoControl();
