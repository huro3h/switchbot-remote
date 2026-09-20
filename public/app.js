const WORKER_URL = '/command';
const TEMP_MIN = 16, TEMP_MAX = 30;

const DEFAULT_STATE = { power: 'on', temperature: 26, mode: 2, fanSpeed: 1 };
// プリセットは「温度 + 風量」の組み合わせ。モードはプリセットに含めず、送信時に画面で選択中の値を使う
const MODE_LABELS = { 1: '自動', 2: '冷房', 3: '除湿', 4: '送風', 5: '暖房' };
const DEFAULT_PRESETS = [
  { temperature: 18, fanSpeed: 1 },
  { temperature: 22, fanSpeed: 1 },
  { temperature: 25, fanSpeed: 1 },
  { temperature: 27, fanSpeed: 1 },
];
const FAN_OPTIONS = [
  { value: 1, label: '自動' },
  { value: 2, label: '風量1' },
  { value: 3, label: '風量2' },
  { value: 4, label: '風量3' },
  { value: 5, label: '風量4' },
];

function fanLabel(fanSpeed) {
  const opt = FAN_OPTIONS.find((o) => o.value === fanSpeed);
  return opt ? opt.label : '自動';
}

// 旧形式（数値のみの配列）で保存されたプリセットも読めるように正規化する
function normalizePreset(preset, index) {
  const fallback = DEFAULT_PRESETS[index] || DEFAULT_PRESETS[0];
  const raw = typeof preset === 'number' ? { temperature: preset } : (preset || {});
  const temperature = Math.min(TEMP_MAX, Math.max(TEMP_MIN, parseInt(raw.temperature, 10) || fallback.temperature));
  const fanSpeed = FAN_OPTIONS.some((o) => o.value === raw.fanSpeed) ? raw.fanSpeed : fallback.fanSpeed;
  return { temperature, fanSpeed };
}

let state = { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem('ac_state') || '{}') };
let presets = (JSON.parse(localStorage.getItem('ac_presets') || 'null') || DEFAULT_PRESETS).map(normalizePreset);

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
  presets.forEach((preset, i) => {
    const btn = document.createElement('button');
    btn.className = 'preset-tap-btn';
    btn.id = 'presetTapBtn' + i;

    const temp = document.createElement('span');
    temp.className = 'preset-temp';
    temp.textContent = preset.temperature + '°C';
    btn.appendChild(temp);

    const fan = document.createElement('span');
    fan.className = 'preset-fan';
    fan.textContent = fanLabel(preset.fanSpeed);
    btn.appendChild(fan);

    btn.onclick = () => applyPreset(i);
    btnRow.appendChild(btn);
  });

  // 編集エリア内の入力欄（プリセットごとに1行）
  const inner = document.getElementById('presetEditInner');
  inner.innerHTML = '';
  presets.forEach((preset, i) => {
    const row = document.createElement('div');
    row.className = 'preset-edit-row';

    const num = document.createElement('span');
    num.className = 'preset-edit-index';
    num.textContent = i + 1;
    row.appendChild(num);

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'preset-edit-input';
    input.id = 'presetEditInput' + i;
    input.min = TEMP_MIN;
    input.max = TEMP_MAX;
    input.value = preset.temperature;
    row.appendChild(input);

    const unit = document.createElement('span');
    unit.className = 'preset-edit-unit';
    unit.textContent = '°C';
    row.appendChild(unit);

    const select = document.createElement('select');
    select.className = 'preset-edit-select';
    select.id = 'presetEditFan' + i;
    FAN_OPTIONS.forEach((o) => {
      const option = document.createElement('option');
      option.value = o.value;
      option.textContent = o.label;
      option.selected = o.value === preset.fanSpeed;
      select.appendChild(option);
    });
    row.appendChild(select);

    inner.appendChild(row);
  });
}

function toggleModeEdit() {
  const group = document.getElementById('modeGroup');
  group.hidden = !group.hidden;
  document.getElementById('modeEditToggle').textContent = group.hidden ? '変更' : '閉じる';
}

function togglePresetEdit() {
  const area = document.getElementById('presetEditArea');
  const btn = document.getElementById('presetEditToggle');
  const isOpen = area.classList.toggle('open');
  btn.textContent = isOpen ? 'キャンセル' : '編集';
}

function saveAndClosePresets() {
  presets = presets.map((_, i) => {
    const tempEl = document.getElementById('presetEditInput' + i);
    const fanEl = document.getElementById('presetEditFan' + i);
    return normalizePreset({
      temperature: parseInt(tempEl.value, 10),
      fanSpeed: parseInt(fanEl.value, 10),
    }, i);
  });
  savePresets();
  buildPresetUI();
  renderUI();
  // 自動制御のプリセット選択肢も作り直す（auto-app.js は後から読み込まれる）
  if (typeof renderAutoControl === 'function') renderAutoControl();

  const area = document.getElementById('presetEditArea');
  area.classList.remove('open');
  document.getElementById('presetEditToggle').textContent = '編集';
}

// プリセット適用時も mode は画面で現在選択中の値（state.mode）をそのまま送信する
function applyPreset(index) {
  state.temperature = presets[index].temperature;
  state.fanSpeed = presets[index].fanSpeed;
  renderUI();
  sendCommand();
}

function renderUI() {
  document.getElementById('powerOnBtn').classList.toggle('active', state.power === 'on');
  document.getElementById('powerOffBtn').classList.toggle('active', state.power === 'off');

  document.getElementById('tempValue').textContent = state.temperature;

  presets.forEach((preset, i) => {
    const btn = document.getElementById('presetTapBtn' + i);
    if (!btn) return;
    btn.classList.toggle('active', preset.temperature === state.temperature && preset.fanSpeed === state.fanSpeed);
  });

  document.getElementById('modeLabel').textContent = 'モード：' + (MODE_LABELS[state.mode] || '—');

  document.querySelectorAll('#modeGroup button').forEach((btn, i) => {
    btn.classList.toggle('active', [1, 2, 3, 5, null][i] === state.mode);
  });

  document.querySelectorAll('#fanGroup button').forEach((btn, i) => {
    btn.classList.toggle('active', [1, 2, 3, 4, 5][i] === state.fanSpeed);
  });

  // 自動制御は電源ONのときだけ動くため、状態表示を追従させる（auto-app.js は後から読み込まれる）
  if (typeof renderAutoControl === 'function') renderAutoControl();
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
      return true;
    }
    showToast('エラー: ' + data.message, true);
    return false;
  } catch {
    showToast('通信エラーが発生しました', true);
    return false;
  }
}

function setPower(power) {
  state.power = power;
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
  toggleModeEdit(); // 選んだら閉じる（頻繁に変えるものではないため）
}

function setFan(fan) {
  state.fanSpeed = fan;
  renderUI();
  sendCommand();
}

buildPresetUI();
renderUI();
