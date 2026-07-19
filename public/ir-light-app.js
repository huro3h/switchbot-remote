function loadIrLightState(id) {
  return JSON.parse(localStorage.getItem('ir_light_state_' + id) || '{}').power || 'off';
}

function saveIrLightState(id, power) {
  localStorage.setItem('ir_light_state_' + id, JSON.stringify({ power }));
}

async function sendIrLightCommand(id, command) {
  const res = await fetch('/ir-light-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, command }),
  });
  return res.json();
}

async function setIrLightPower(id, power, onBtn, offBtn) {
  renderButtons(onBtn, offBtn, power);
  const command = power === 'on' ? 'turnOn' : 'turnOff';
  try {
    const data = await sendIrLightCommand(id, command);
    if (data.statusCode === 100) {
      saveIrLightState(id, power);
      showToast('送信しました ✓');
    } else {
      renderButtons(onBtn, offBtn, loadIrLightState(id));
      showToast('エラー: ' + data.message, true);
    }
  } catch {
    renderButtons(onBtn, offBtn, loadIrLightState(id));
    showToast('通信エラーが発生しました', true);
  }
}

async function adjustIrBrightness(id, command) {
  try {
    const data = await sendIrLightCommand(id, command);
    if (data.statusCode === 100) {
      showToast('送信しました ✓');
    } else {
      showToast('エラー: ' + data.message, true);
    }
  } catch {
    showToast('通信エラーが発生しました', true);
  }
}

function buildIrLightRow(light) {
  const row = document.createElement('div');
  row.className = 'ir-light-row';

  const label = document.createElement('div');
  label.className = 'device-label';
  label.textContent = light.label;

  const group = document.createElement('div');
  group.className = 'power-group';

  const onBtn = document.createElement('button');
  onBtn.className = 'power-btn on';
  onBtn.textContent = 'ON';

  const offBtn = document.createElement('button');
  offBtn.className = 'power-btn off';
  offBtn.textContent = 'OFF';

  renderButtons(onBtn, offBtn, loadIrLightState(light.id));
  onBtn.onclick = () => setIrLightPower(light.id, 'on', onBtn, offBtn);
  offBtn.onclick = () => setIrLightPower(light.id, 'off', onBtn, offBtn);

  group.appendChild(offBtn);
  group.appendChild(onBtn);

  const brightnessRow = document.createElement('div');
  brightnessRow.className = 'brightness-row';

  const downBtn = document.createElement('button');
  downBtn.className = 'temp-btn';
  downBtn.textContent = '−';
  downBtn.onclick = () => adjustIrBrightness(light.id, 'brightnessDown');

  const brightnessLabel = document.createElement('span');
  brightnessLabel.className = 'brightness-label';
  brightnessLabel.textContent = '明るさ';

  const upBtn = document.createElement('button');
  upBtn.className = 'temp-btn';
  upBtn.textContent = '＋';
  upBtn.onclick = () => adjustIrBrightness(light.id, 'brightnessUp');

  brightnessRow.appendChild(downBtn);
  brightnessRow.appendChild(brightnessLabel);
  brightnessRow.appendChild(upBtn);

  row.appendChild(label);
  row.appendChild(group);
  row.appendChild(brightnessRow);
  return row;
}

async function initIrLights() {
  const list = document.getElementById('irLightList');
  try {
    const res = await fetch('/ir-lights');
    const lights = await res.json();
    if (lights.length === 0) {
      list.textContent = '登録されている照明がありません';
      return;
    }
    lights.forEach((light) => list.appendChild(buildIrLightRow(light)));
  } catch {
    list.textContent = '照明一覧の取得に失敗しました';
  }
}

initIrLights();
