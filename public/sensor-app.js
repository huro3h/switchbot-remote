// 自動更新の間隔プリセット（秒）。30秒でも1日2,880回で、API上限10,000回/日には収まる
const SENSOR_INTERVALS = [
  { value: 30, label: '30秒' },
  { value: 60, label: '1分' },
  { value: 300, label: '5分' },
];
const SENSOR_AUTO_DEFAULT = { enabled: false, intervalSec: 60 };

// CO2濃度の目安（ppm）: 1000未満＝良好 / 1500未満＝換気推奨 / それ以上＝要換気
const CO2_WARN = 1000, CO2_BAD = 1500;

let sensorAuto = { ...SENSOR_AUTO_DEFAULT, ...JSON.parse(localStorage.getItem('sensor_auto') || '{}') };
if (!SENSOR_INTERVALS.some((i) => i.value === sensorAuto.intervalSec)) {
  sensorAuto.intervalSec = SENSOR_AUTO_DEFAULT.intervalSec;
}
let sensorTimer = null;
let sensorLastUpdated = null;

// タブが隠れている間はポーリングを止めるため、その事実をタイトルとバッジに出す
const PAGE_TITLE = document.title;
const SENSOR_PAUSE_NOTICE_MS = 6000;
let sensorHiddenAt = null;
let sensorPauseInfo = null; // 復帰直後だけ保持する { hiddenAt, ms }
let sensorPauseTimer = null;

function renderPageTitle() {
  // 止まっているものがあるときだけ印を付ける（自動更新OFFなら元から動いていない）
  document.title = document.hidden && sensorAuto.enabled ? '⏸ ' + PAGE_TITLE : PAGE_TITLE;
}

function formatDuration(ms) {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return sec + '秒間';
  const min = Math.round(sec / 60);
  if (min < 60) return min + '分間';
  return Math.floor(min / 60) + '時間' + (min % 60) + '分間';
}

function saveSensorAuto() {
  localStorage.setItem('sensor_auto', JSON.stringify(sensorAuto));
}

function renderSensorUpdatedAt() {
  const el = document.getElementById('sensorUpdatedAt');
  if (!sensorLastUpdated) {
    el.innerHTML = '';
    return;
  }
  const at = sensorLastUpdated.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (!sensorAuto.enabled) {
    el.textContent = at + ' 時点';
    return;
  }
  const interval = SENSOR_INTERVALS.find((i) => i.value === sensorAuto.intervalSec);
  el.innerHTML =
    `<span class="sensor-live"><span class="auto-dot"></span>${interval ? interval.label : sensorAuto.intervalSec + '秒'}ごとに更新中</span> · ${at}`;
}

function co2Class(co2) {
  if (co2 === null) return '';
  if (co2 >= CO2_BAD) return 'bad';
  if (co2 >= CO2_WARN) return 'warn';
  return '';
}

function buildSensorMetric(value, unit, extraClass = '') {
  const metric = document.createElement('div');
  metric.className = 'metric' + (extraClass ? ' ' + extraClass : '');

  const valueEl = document.createElement('span');
  valueEl.className = 'metric-value';
  valueEl.textContent = value === null ? '—' : value;
  metric.appendChild(valueEl);

  const unitEl = document.createElement('span');
  unitEl.className = 'metric-unit';
  unitEl.textContent = unit;
  metric.appendChild(unitEl);

  return metric;
}

// センサーが1台だけならラベルは自明なので出さない（複数台のときだけ表示する）
function buildSensorRow(sensor, showLabel) {
  const row = document.createElement('div');
  row.className = 'sensor-row';

  if (showLabel) {
    const label = document.createElement('div');
    label.className = 'device-label';
    label.textContent = sensor.label;
    row.appendChild(label);
  }

  const metrics = document.createElement('div');
  metrics.className = 'sensor-metrics';
  metrics.appendChild(buildSensorMetric(sensor.temperature, '°C'));
  metrics.appendChild(buildSensorMetric(sensor.humidity, '%'));
  metrics.appendChild(buildSensorMetric(sensor.co2, 'ppm', co2Class(sensor.co2)));
  row.appendChild(metrics);

  return row;
}

// センサーは読み取り専用。取得できなければカードごと隠す（未登録時にsecret未設定でも崩れないように）
async function initSensors(showErrorToast = false) {
  const card = document.getElementById('sensorCard');
  const list = document.getElementById('sensorList');
  try {
    const res = await fetch('/sensors');
    const sensors = await res.json();
    if (sensors.length === 0) {
      card.hidden = true;
      return;
    }
    list.innerHTML = '';
    sensors.forEach((sensor) => list.appendChild(buildSensorRow(sensor, sensors.length > 1)));
    sensorLastUpdated = new Date();
    renderSensorUpdatedAt();
    card.hidden = false;
    // 室温連動の自動制御（auto-app.js）。読み込み順の都合で存在チェックしてから呼ぶ
    if (typeof onSensorsUpdated === 'function') onSensorsUpdated(sensors);
  } catch {
    if (showErrorToast) showToast('センサーの取得に失敗しました', true);
    if (!list.hasChildNodes()) card.hidden = true;
  }
}

function refreshSensors() {
  initSensors(true);
}

function buildSensorIntervals() {
  const group = document.getElementById('sensorIntervalGroup');
  group.innerHTML = '';
  SENSOR_INTERVALS.forEach((interval) => {
    const btn = document.createElement('button');
    btn.className = 'interval-btn';
    btn.id = 'sensorInterval' + interval.value;
    btn.textContent = interval.label;
    btn.onclick = () => setSensorInterval(interval.value);
    group.appendChild(btn);
  });
}

function renderSensorControls() {
  renderSensorUpdatedAt();
  renderPageTitle();
  // 自動制御（auto-app.js）の稼働状態表示もセンサーの自動更新に依存する
  if (typeof renderAutoControl === 'function') renderAutoControl();
  document.getElementById('sensorAutoBtn').classList.toggle('active', sensorAuto.enabled);
  document.getElementById('sensorIntervalGroup').hidden = !sensorAuto.enabled;
  SENSOR_INTERVALS.forEach((interval) => {
    document
      .getElementById('sensorInterval' + interval.value)
      .classList.toggle('active', interval.value === sensorAuto.intervalSec);
  });
}

function stopSensorAuto() {
  clearTimeout(sensorTimer);
  sensorTimer = null;
}

// setInterval ではなく毎回タイマーを張り直して、取得が遅れてもリクエストが重ならないようにする
function scheduleSensorAuto() {
  stopSensorAuto();
  if (!sensorAuto.enabled || document.hidden) return;
  sensorTimer = setTimeout(async () => {
    await initSensors();
    scheduleSensorAuto();
  }, sensorAuto.intervalSec * 1000);
}

function toggleSensorAuto() {
  sensorAuto.enabled = !sensorAuto.enabled;
  saveSensorAuto();
  renderSensorControls();
  if (sensorAuto.enabled) initSensors();
  scheduleSensorAuto();
}

function setSensorInterval(sec) {
  sensorAuto.intervalSec = sec;
  saveSensorAuto();
  renderSensorControls();
  scheduleSensorAuto();
}

function renderAutoControlIfPresent() {
  if (typeof renderAutoControl === 'function') renderAutoControl();
}

// タブが非表示・非アクティブの間は止め、戻ってきたら即座に取り直す（古い値を見せないため）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    sensorHiddenAt = Date.now();
    stopSensorAuto();
    renderPageTitle();
    renderAutoControlIfPresent();
    return;
  }

  // 隠れている間はバッジを見られないので、復帰直後だけ「停止していた」ことを残す
  if (sensorHiddenAt && sensorAuto.enabled) {
    sensorPauseInfo = { hiddenAt: sensorHiddenAt, ms: Date.now() - sensorHiddenAt };
    clearTimeout(sensorPauseTimer);
    sensorPauseTimer = setTimeout(() => {
      sensorPauseInfo = null;
      renderAutoControlIfPresent();
    }, SENSOR_PAUSE_NOTICE_MS);
  }
  sensorHiddenAt = null;
  renderPageTitle();

  if (sensorAuto.enabled) {
    initSensors();
    scheduleSensorAuto();
  }
  renderAutoControlIfPresent();
});

buildSensorIntervals();
renderSensorControls();
initSensors();
scheduleSensorAuto();
