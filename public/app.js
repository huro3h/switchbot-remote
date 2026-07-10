const WORKER_URL = '/command';
const TEMP_MIN = 16, TEMP_MAX = 30;

const DEFAULT_STATE = { power: 'on', temperature: 26, mode: 2, fanSpeed: 1 };

let state = { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem('ac_state') || '{}') };

function saveState() {
  localStorage.setItem('ac_state', JSON.stringify(state));
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

renderUI();
