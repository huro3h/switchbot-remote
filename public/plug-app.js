function loadPlugState(id) {
  return JSON.parse(localStorage.getItem('plug_state_' + id) || '{}').power || 'off';
}

function savePlugState(id, power) {
  localStorage.setItem('plug_state_' + id, JSON.stringify({ power }));
}

function renderButtons(onBtn, offBtn, power) {
  onBtn.classList.toggle('active', power === 'on');
  offBtn.classList.toggle('active', power === 'off');
}

async function sendPlugCommand(id, power) {
  const res = await fetch('/plug-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, power }),
  });
  return res.json();
}

async function setPlugPower(id, power, onBtn, offBtn) {
  renderButtons(onBtn, offBtn, power);
  try {
    const data = await sendPlugCommand(id, power);
    if (data.statusCode === 100) {
      savePlugState(id, power);
      showToast('送信しました ✓');
    } else {
      renderButtons(onBtn, offBtn, loadPlugState(id));
      showToast('エラー: ' + data.message, true);
    }
  } catch {
    renderButtons(onBtn, offBtn, loadPlugState(id));
    showToast('通信エラーが発生しました', true);
  }
}

function buildPlugRow(plug) {
  const row = document.createElement('div');
  row.className = 'plug-row';

  const label = document.createElement('div');
  label.className = 'device-label';
  label.textContent = plug.label;

  const group = document.createElement('div');
  group.className = 'power-group';

  const onBtn = document.createElement('button');
  onBtn.className = 'power-btn on';
  onBtn.textContent = 'ON';

  const offBtn = document.createElement('button');
  offBtn.className = 'power-btn off';
  offBtn.textContent = 'OFF';

  renderButtons(onBtn, offBtn, loadPlugState(plug.id));
  onBtn.onclick = () => setPlugPower(plug.id, 'on', onBtn, offBtn);
  offBtn.onclick = () => setPlugPower(plug.id, 'off', onBtn, offBtn);

  group.appendChild(offBtn);
  group.appendChild(onBtn);
  row.appendChild(label);
  row.appendChild(group);
  return row;
}

async function initPlugs() {
  const list = document.getElementById('plugList');
  try {
    const res = await fetch('/plugs');
    const plugs = await res.json();
    if (plugs.length === 0) {
      list.textContent = '登録されているプラグがありません';
      return;
    }
    plugs.forEach((plug) => list.appendChild(buildPlugRow(plug)));
  } catch {
    list.textContent = 'プラグ一覧の取得に失敗しました';
  }
}

initPlugs();
