// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, round
// score, kill feed, minimap, buy menu and banners. It never touches the
// simulation; game.js pushes numbers in and reads callbacks out.
import { WEAPONS, SHOP } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playBtn = $('play');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorFill = $('armor-fill');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyEl = $('money');
  const timerEl = $('timer');
  const roundScoreEl = $('round-score');
  const killfeedEl = $('killfeed');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const bannerEl = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const deployBtn = $('deploy');
  const minimap = $('minimap');
  const mapCtx = minimap.getContext('2d');
  const flashEl = $('flash');
  const vignette = $('vignette');
  const damageDir = $('damage-dir');
  const plantWrap = $('plant-wrap');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const hintEl = $('hint');
  const scopeEl = $('scope');
  const spikeEl = $('spike-status');

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let buyHandler = null;
  let mapData = null;

  function setHealth(hp, armor) {
    if (hp === lastHealth && armor === lastArmor) return;
    lastHealth = hp;
    lastArmor = armor;
    healthFill.style.width = `${Math.max(0, hp)}%`;
    healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
    armorFill.style.width = `${Math.max(0, Math.min(100, armor))}%`;
    vignette.style.opacity = hp < 35 ? String(0.55 - hp * 0.01) : '0';
  }

  function setAmmo(mag, reserve, name) {
    if (mag === lastMag && reserve === lastReserve && name === lastWeapon) return;
    lastMag = mag;
    lastReserve = reserve;
    lastWeapon = name;
    ammoMag.textContent = String(mag);
    ammoReserve.textContent = `/ ${reserve}`;
    weaponName.textContent = name;
  }

  function setMoney(value) {
    if (value === lastMoney) return;
    lastMoney = value;
    moneyEl.textContent = `$${value}`;
    buyMoney.textContent = `$${value}`;
  }

  function setTimer(seconds, planted) {
    const s = Math.max(0, Math.ceil(seconds));
    const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const key = text + (planted ? 'P' : '');
    if (key === lastTimer) return;
    lastTimer = key;
    timerEl.textContent = text;
    timerEl.classList.toggle('planted', !!planted);
  }

  function setRoundScore(v, c, round) {
    const text = `VANGUARD ${v} — ${c} CINDER · ROUND ${round}`;
    if (text === lastScore) return;
    lastScore = text;
    roundScoreEl.textContent = text;
  }

  function killfeed(killerName, killerTeam, victimName, victimTeam, headshot) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    const kc = killerTeam === 'V' ? 'team-v' : 'team-c';
    const vc = victimTeam === 'V' ? 'team-v' : 'team-c';
    row.innerHTML = `<span class="${kc}">${killerName}</span> <span class="feed-x">${headshot ? '◎' : '✕'}</span> <span class="${vc}">${victimName}</span>`;
    killfeedEl.prepend(row);
    while (killfeedEl.children.length > 5) killfeedEl.lastChild.remove();
    setTimeout(() => row.remove(), 5200);
  }

  function hitMarker(killed) {
    hitmarker.classList.add('on');
    hitmarker.classList.toggle('kill', !!killed);
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), killed ? 260 : 120);
  }

  function damageFrom(angleDeg) {
    damageDir.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
    damageDir.classList.add('on');
    setTimeout(() => damageDir.classList.remove('on'), 450);
  }

  function flashScreen(seconds) {
    flashEl.style.transition = 'none';
    flashEl.style.opacity = '0.95';
    requestAnimationFrame(() => {
      flashEl.style.transition = `opacity ${seconds}s ease-out`;
      flashEl.style.opacity = '0';
    });
  }

  function showBanner(title, sub, color) {
    bannerTitle.textContent = title;
    bannerSub.textContent = sub || '';
    bannerEl.style.setProperty('--banner-color', color || '#efe8d8');
    bannerEl.classList.add('on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.remove('on'), 2600);
  }

  function setCrosshairSpread(px) {
    crosshair.style.setProperty('--gap', `${Math.max(3, Math.min(26, px))}px`);
  }

  function setPlantProgress(label, progress) {
    if (label == null) {
      plantWrap.hidden = true;
      return;
    }
    plantWrap.hidden = false;
    plantLabel.textContent = label;
    plantFill.style.width = `${Math.round(progress * 100)}%`;
  }

  function setHint(text) {
    hintEl.textContent = text || '';
    hintEl.hidden = !text;
  }

  function setScope(on) {
    scopeEl.hidden = !on;
  }

  function setSpike(text) {
    spikeEl.textContent = text || '';
    spikeEl.hidden = !text;
  }

  function buildBuyMenu(money) {
    buyList.innerHTML = '';
    const items = [];
    for (const def of Object.values(WEAPONS)) {
      if (def.id === 'pistol') continue;
      items.push({ key: String(items.length + 1), label: def.name, price: def.price, id: def.id, kind: 'weapon', desc: `DMG ${def.damage} · MAG ${def.mag}` });
    }
    items.push({ key: '5', label: 'Kevlar Vest', price: SHOP.armorPrice, id: 'armor', kind: 'armor', desc: '+50 armour' });
    items.push({ key: '6', label: 'Spark Grenade', price: SHOP.grenadePrice, id: 'grenade', kind: 'grenade', desc: 'Flash + blast' });
    items.push({ key: '7', label: 'Refill Ammo', price: 200, id: 'ammo', kind: 'ammo', desc: 'Full reserve for current weapons' });
    for (const item of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'buy-row';
      row.dataset.id = item.id;
      row.dataset.key = item.key;
      row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.label}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
      row.addEventListener('click', () => buyHandler && buyHandler(item));
      buyList.appendChild(row);
    }
    setMoney(money);
  }

  function refreshBuyAffordability(money) {
    for (const row of buyList.children) {
      const price = Number(row.querySelector('.buy-price').textContent.slice(1));
      row.classList.toggle('poor', price > money);
    }
    setMoney(money);
  }

  function drawMinimap(agents, player, spike) {
    if (!mapData) return;
    const W = minimap.width;
    const H = minimap.height;
    const { minX, maxX, minZ, maxZ, walls, sites } = mapData;
    const px = (x) => ((x - minX) / (maxX - minX)) * W;
    const py = (z) => ((z - minZ) / (maxZ - minZ)) * H;
    mapCtx.clearRect(0, 0, W, H);
    mapCtx.fillStyle = 'rgba(20,22,26,0.85)';
    mapCtx.fillRect(0, 0, W, H);
    mapCtx.fillStyle = '#4a4238';
    for (const w of walls) mapCtx.fillRect(px(w.x0), py(w.z0), Math.max(2, px(w.x1) - px(w.x0)), Math.max(2, py(w.z1) - py(w.z0)));
    mapCtx.font = 'bold 13px monospace';
    mapCtx.textAlign = 'center';
    for (const s of sites) {
      mapCtx.fillStyle = '#ff9a3c';
      mapCtx.fillText(s.letter, px(s.x), py(s.z) + 4);
      mapCtx.strokeStyle = 'rgba(255,154,60,0.6)';
      mapCtx.beginPath();
      mapCtx.arc(px(s.x), py(s.z), 8, 0, Math.PI * 2);
      mapCtx.stroke();
    }
    if (spike && spike.planted) {
      mapCtx.fillStyle = '#ff3b30';
      mapCtx.beginPath();
      mapCtx.arc(px(spike.x), py(spike.z), 5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    for (const a of agents) {
      if (!a.alive) continue;
      const p = a.mover.body.position;
      mapCtx.fillStyle = a.team === 'V' ? '#2ec4b6' : '#ff5a3c';
      mapCtx.beginPath();
      mapCtx.arc(px(p.x), py(p.z), a.isPlayer ? 4 : 3, 0, Math.PI * 2);
      mapCtx.fill();
    }
    if (player && player.alive) {
      const p = player.mover.body.position;
      mapCtx.strokeStyle = '#efe8d8';
      mapCtx.beginPath();
      mapCtx.arc(px(p.x), py(p.z), 6, 0, Math.PI * 2);
      mapCtx.stroke();
      const yaw = player.mover.body.yaw;
      mapCtx.beginPath();
      mapCtx.moveTo(px(p.x), py(p.z));
      mapCtx.lineTo(px(p.x) - Math.sin(yaw) * 10, py(p.z) - Math.cos(yaw) * 10);
      mapCtx.stroke();
    }
  }

  const COPY = {
    start: { title: 'DUSTLINE', copy: 'Yard Siege — Vanguard attacks, Cinder holds. Plant the spike at A or B, or wipe the other team. First to 5 rounds takes the yard.', action: 'Click to play' },
    paused: { title: 'DUSTLINE', copy: 'Paused. Click to resume.', action: 'Click to resume' },
    match: { title: '', copy: '', action: 'Play again' },
  };

  return {
    setHealth,
    setAmmo,
    setMoney,
    setTimer,
    setRoundScore,
    killfeed,
    hitMarker,
    damageFrom,
    flashScreen,
    showBanner,
    setCrosshairSpread,
    setPlantProgress,
    setHint,
    setScope,
    setSpike,
    drawMinimap,
    setMapData(data) { mapData = data; },
    showBuyMenu(money, handler) {
      buyHandler = handler;
      buildBuyMenu(money);
      buyMenu.hidden = false;
    },
    buyKey(num) {
      const row = buyList.querySelector(`[data-key="${num}"]`);
      if (row) row.click();
    },
    hideBuyMenu() { buyMenu.hidden = true; },
    refreshBuy(money) { refreshBuyAffordability(money); },
    isBuyOpen() { return !buyMenu.hidden; },
    showOverlay(mode, scoreText) {
      const text = COPY[mode];
      if (mode === 'match') {
        overlayTitle.textContent = scoreText || 'Match over';
        overlayCopy.textContent = 'The yard is decided. Play again to run it back.';
      } else {
        overlayTitle.textContent = text.title;
        overlayCopy.textContent = text.copy;
      }
      playBtn.textContent = text.action;
      overlay.hidden = false;
      playBtn.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { playBtn.addEventListener('click', handler); },
    onDeploy(handler) { deployBtn.addEventListener('click', handler); },
  };
}
