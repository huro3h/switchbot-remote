function loadLightState(id) {
  return JSON.parse(localStorage.getItem('light_state_' + id) || '{}').power || 'off';
}

function saveLightState(id, power) {
  localStorage.setItem('light_state_' + id, JSON.stringify({ power }));
}

function renderButtons(onBtn, offBtn, power) {
  onBtn.classList.toggle('active', power === 'on');
  offBtn.classList.toggle('active', power === 'off');
}

async function sendLightCommand(id, power) {
  const res = await fetch('/light-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, power }),
  });
  return res.json();
}

async function setLightPower(id, power, onBtn, offBtn) {
  renderButtons(onBtn, offBtn, power);
  try {
    const data = await sendLightCommand(id, power);
    if (data.statusCode === 100) {
      saveLightState(id, power);
      showToast('送信しました ✓');
    } else {
      renderButtons(onBtn, offBtn, loadLightState(id));
      showToast('エラー: ' + data.message, true);
    }
  } catch {
    renderButtons(onBtn, offBtn, loadLightState(id));
    showToast('通信エラーが発生しました', true);
  }
}

function buildLightRow(light) {
  const row = document.createElement('div');
  row.className = 'light-row';

  const label = document.createElement('div');
  label.className = 'light-label';
  label.textContent = light.label;

  const group = document.createElement('div');
  group.className = 'power-group';

  const onBtn = document.createElement('button');
  onBtn.className = 'power-btn on';
  onBtn.textContent = 'ON';

  const offBtn = document.createElement('button');
  offBtn.className = 'power-btn off';
  offBtn.textContent = 'OFF';

  renderButtons(onBtn, offBtn, loadLightState(light.id));
  onBtn.onclick = () => setLightPower(light.id, 'on', onBtn, offBtn);
  offBtn.onclick = () => setLightPower(light.id, 'off', onBtn, offBtn);

  group.appendChild(offBtn);
  group.appendChild(onBtn);
  row.appendChild(label);
  row.appendChild(group);
  return row;
}

async function initLights() {
  const list = document.getElementById('lightList');
  try {
    const res = await fetch('/lights');
    const lights = await res.json();
    if (lights.length === 0) {
      list.textContent = '登録されている照明がありません';
      return;
    }
    lights.forEach((light) => list.appendChild(buildLightRow(light)));
  } catch {
    list.textContent = '照明一覧の取得に失敗しました';
  }
}

initLights();
