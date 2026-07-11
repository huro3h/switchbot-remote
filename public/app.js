const WORKER_URL = '/command';
const TEMP_MIN = 16, TEMP_MAX = 30;

const DEFAULT_STATE = { power: 'on', temperature: 26, mode: 2, fanSpeed: 1 };
const DEFAULT_PRESETS = [18, 22, 25, 27];

let state = { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem('ac_state') || '{}') };
let presets = JSON.parse(localStorage.getItem('ac_presets') || 'null') || [...DEFAULT_PRESETS];

function saveState() {
  localStorage.setItem('ac_state', JSON.stringify(state));
}

function savePresets() {
  localStorage.setItem('ac_presets', JSON.stringify(presets));
}

function buildPresetUI() {
  // セット用ボタン行
  const btnRow = document.getElementById('presetBtnRow');
  btnRow.innerHTML = '';
  presets.forEach((temp, i) => {
    const btn = document.createElement('button');
    btn.className = 'preset-tap-btn';
    btn.textContent = temp + '°C';
    btn.onclick = () => applyPreset(i);
    btnRow.appendChild(btn);
  });

  // 編集エリア内の入力欄（ボタン行と同じ横並び）
  const inner = document.getElementById('presetEditInner');
  inner.innerHTML = '';
  presets.forEach((temp, i) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'preset-edit-input';
    input.id = 'presetEditInput' + i;
    input.min = TEMP_MIN;
    input.max = TEMP_MAX;
    input.value = temp;
    inner.appendChild(input);
  });
}

function togglePresetEdit() {
  const area = document.getElementById('presetEditArea');
  const btn = document.getElementById('presetEditToggle');
  const isOpen = area.classList.toggle('open');
  btn.textContent = isOpen ? 'キャンセル' : '編集';
}

function saveAndClosePresets() {
  presets = Array.from({ length: 4 }, (_, i) => {
    const el = document.getElementById('presetEditInput' + i);
    return Math.min(TEMP_MAX, Math.max(TEMP_MIN, parseInt(el.value, 10) || DEFAULT_PRESETS[i]));
  });
  savePresets();
  buildPresetUI();

  const area = document.getElementById('presetEditArea');
  area.classList.remove('open');
  document.getElementById('presetEditToggle').textContent = '編集';
}

function applyPreset(index) {
  state.temperature = presets[index];
  renderUI();
  sendCommand();
}

function renderUI() {
  const powerBtn = document.getElementById('powerBtn');
  powerBtn.classList.toggle('off', state.power === 'off');
  powerBtn.title = state.power === 'on' ? 'ONで動作中（タップでOFF）' : 'OFFです（タップでON）';

  document.getElementById('tempValue').textContent = state.temperature;

  document.querySelectorAll('#modeGroup button').forEach((btn, i) => {
    btn.classList.toggle('active', [1, 2, 3, 5, null][i] === state.mode);
  });

  document.querySelectorAll('#fanGroup button').forEach((btn, i) => {
    btn.classList.toggle('active', [1, 2, 3, 4, 5][i] === state.fanSpeed);
  });
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = ''; }, 2200);
}

async function sendCommand() {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    const data = await res.json();
    if (data.statusCode === 100) {
      saveState();
      showToast('送信しました ✓');
    } else {
      showToast('エラー: ' + data.message, true);
    }
  } catch {
    showToast('通信エラーが発生しました', true);
  }
}

function togglePower() {
  state.power = state.power === 'on' ? 'off' : 'on';
  renderUI();
  sendCommand();
}

function changeTemp(delta) {
  const next = state.temperature + delta;
  if (next < TEMP_MIN || next > TEMP_MAX) return;
  state.temperature = next;
  renderUI();
  sendCommand();
}

function setMode(mode) {
  state.mode = mode;
  renderUI();
  sendCommand();
}

function setFan(fan) {
  state.fanSpeed = fan;
  renderUI();
  sendCommand();
}

buildPresetUI();
renderUI();
