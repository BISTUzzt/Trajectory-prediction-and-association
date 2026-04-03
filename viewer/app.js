const canvas = document.getElementById('trajCanvas');
const ctx = canvas.getContext('2d');
const mapEl = document.getElementById('map');

const playPauseBtn = document.getElementById('playPauseBtn');
const resetBtn = document.getElementById('resetBtn');
const speedSelect = document.getElementById('speedSelect');
const assocDelayRange = document.getElementById('assocDelayRange');
const assocDelayText = document.getElementById('assocDelayText');
const fileInput = document.getElementById('fileInput');

const statusText = document.getElementById('statusText');
const timeText = document.getElementById('timeText');
const pointCountText = document.getElementById('pointCountText');
const trajCountText = document.getElementById('trajCountText');
const pointsPreviewMeta = document.getElementById('pointsPreviewMeta');
const pointsPreviewBody = document.getElementById('pointsPreviewBody');

let allPoints = [];
let sortedByTime = [];
let extent = null;

let running = false;
let cursor = 0;
let simTime = 0;
let lastFrame = 0;
let displayedCount = 0;

const pendingAssociations = [];
const tracks = new Map();
const allTrajIds = new Set();

let speed = Number(speedSelect.value);
let assocDelayMs = Number(assocDelayRange.value);
let canvasCssWidth = 0;
let canvasCssHeight = 0;
let map = null;
let mapReady = false;
let tileLayer = null;
let tileProviderIndex = 0;

const TILE_PROVIDERS = [
  {
    name: '高德地图',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    options: { subdomains: ['1', '2', '3', '4'], maxZoom: 18 },
  },
  {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { subdomains: ['a', 'b', 'c'], maxZoom: 19 },
  },
];

function parseTimeToSeconds (ts) {
  if (ts == null) return NaN;
  const raw = String(ts).trim();
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw);

  const parts = raw.split(':');
  if (parts.length === 2) {
    const mm = Number(parts[0]);
    const ss = Number(parts[1]);
    if (!Number.isNaN(mm) && !Number.isNaN(ss)) return mm * 60 + ss;
  }
  if (parts.length === 3) {
    const hh = Number(parts[0]);
    const mm = Number(parts[1]);
    const ss = Number(parts[2]);
    if (!Number.isNaN(hh) && !Number.isNaN(mm) && !Number.isNaN(ss)) return hh * 3600 + mm * 60 + ss;
  }
  return NaN;
}

function parseCsv (text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map(h => h.trim());
  const index = Object.fromEntries(header.map((h, i) => [h, i]));
  const required = ['ts', 'x', 'y', 'tra_id'];

  for (const k of required) {
    if (!(k in index)) {
      throw new Error(`CSV缺少字段: ${k}`);
    }
  }

  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length < header.length) continue;

    const tsRaw = cells[index.ts];
    const t = parseTimeToSeconds(tsRaw);
    const x = Number(cells[index.x]);
    const y = Number(cells[index.y]);
    const traId = Number(cells[index.tra_id]);

    if ([t, x, y, traId].some(Number.isNaN)) continue;

    data.push({
      t,
      tsRaw,
      x,
      y,
      traId,
    });
  }

  return data;
}

function colorForTraj (id) {
  const hue = (id * 47) % 360;
  return `hsl(${hue} 90% 62%)`;
}

function resetState () {
  cursor = 0;
  simTime = sortedByTime.length ? sortedByTime[0].t : 0;
  lastFrame = 0;
  displayedCount = 0;

  pendingAssociations.length = 0;
  tracks.clear();
  allTrajIds.clear();

  for (const p of sortedByTime) {
    if (!tracks.has(p.traId)) tracks.set(p.traId, []);
  }

  draw();
  updateHud();
}

function setTileProvider (index) {
  if (!map) return;
  tileProviderIndex = index;

  if (tileLayer) {
    tileLayer.off();
    map.removeLayer(tileLayer);
    tileLayer = null;
  }

  const provider = TILE_PROVIDERS[tileProviderIndex];
  let tileErrors = 0;

  tileLayer = L.tileLayer(provider.url, {
    ...provider.options,
    attribution: '&copy; map data providers',
  });

  tileLayer.on('tileerror', () => {
    tileErrors += 1;
    if (tileErrors > 8 && tileProviderIndex < TILE_PROVIDERS.length - 1) {
      setTileProvider(tileProviderIndex + 1);
      statusText.textContent = `地图源切换为 ${TILE_PROVIDERS[tileProviderIndex].name}`;
    }
  });

  tileLayer.addTo(map);
}

function initMap () {
  if (typeof L === 'undefined') {
    statusText.textContent = '地图脚本加载失败，请检查网络后刷新页面。';
    return;
  }

  map = L.map(mapEl, {
    zoomControl: true,
    preferCanvas: true,
  });

  setTileProvider(0);

  map.setView([35.8617, 104.1954], 4);
  mapReady = true;

  map.on('move zoom resize', () => {
    draw();
  });
}

function focusMapToData () {
  if (!mapReady || !extent) return;

  const sameLng = Math.abs(extent.maxX - extent.minX) < 1e-9;
  const sameLat = Math.abs(extent.maxY - extent.minY) < 1e-9;

  if (sameLng && sameLat) {
    map.setView([extent.minY, extent.minX], 15);
    return;
  }

  const southWest = L.latLng(extent.minY, extent.minX);
  const northEast = L.latLng(extent.maxY, extent.maxX);
  map.fitBounds(L.latLngBounds(southWest, northEast), {
    padding: [30, 30],
    maxZoom: 16,
    animate: false,
  });
}

function loadData (points) {
  allPoints = points;
  sortedByTime = [...allPoints].sort((a, b) => a.t - b.t);

  if (!sortedByTime.length) {
    statusText.textContent = '数据为空，无法播放。';
    return;
  }

  const xs = sortedByTime.map(p => p.x);
  const ys = sortedByTime.map(p => p.y);
  extent = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };

  focusMapToData();

  resetState();
  renderPointsPreview();
  statusText.textContent = `已加载 ${sortedByTime.length} 个点，点击“播放”开始动画。`;
}

function renderPointsPreview () {
  if (!sortedByTime.length) {
    pointsPreviewMeta.textContent = '暂无数据';
    pointsPreviewBody.innerHTML = '';
    return;
  }

  const start = sortedByTime[0].tsRaw;
  const end = sortedByTime[sortedByTime.length - 1].tsRaw;
  pointsPreviewMeta.textContent = `共 ${sortedByTime.length} 点，时间范围 ${start} ~ ${end}`;

  const previewCount = Math.min(60, sortedByTime.length);
  const rows = sortedByTime.slice(0, previewCount).map((p) => {
    return `<tr><td>${p.tsRaw}</td><td>${p.traId}</td><td>${p.x.toFixed(6)}</td><td>${p.y.toFixed(6)}</td></tr>`;
  }).join('');

  pointsPreviewBody.innerHTML = rows;
}

function worldToCanvas (lng, lat) {
  if (!mapReady) {
    return { x: 0, y: 0 };
  }
  const point = map.latLngToContainerPoint([lat, lng]);
  return { x: point.x, y: point.y };
}

function formatSec (sec) {
  const total = Math.max(0, sec);
  const mm = Math.floor(total / 60);
  const ss = (total % 60).toFixed(1).padStart(4, '0');
  return `${String(mm).padStart(2, '0')}:${ss}`;
}

function updateHud () {
  timeText.textContent = formatSec(simTime);
  pointCountText.textContent = String(displayedCount);
  trajCountText.textContent = String(allTrajIds.size);
}

function step (now) {
  if (!running) return;
  if (!lastFrame) lastFrame = now;
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;

  simTime += dt * speed;

  while (cursor < sortedByTime.length && sortedByTime[cursor].t <= simTime) {
    const p = sortedByTime[cursor++];
    displayedCount++;

    pendingAssociations.push({
      dueAt: now + assocDelayMs,
      point: { ...p },
    });
  }

  while (pendingAssociations.length && pendingAssociations[0].dueAt <= now) {
    const { point } = pendingAssociations.shift();
    tracks.get(point.traId).push(point);
    allTrajIds.add(point.traId);
  }

  if (cursor >= sortedByTime.length && pendingAssociations.length === 0) {
    running = false;
    playPauseBtn.textContent = '播放';
    statusText.textContent = '播放完成。可点击“重置”重新播放。';
  }

  draw(now);
  updateHud();
  requestAnimationFrame(step);
}

function draw (now = performance.now()) {
  if (!extent || !mapReady) return;

  ctx.clearRect(0, 0, canvasCssWidth, canvasCssHeight);

  for (let i = 0; i < cursor; i++) {
    const p = sortedByTime[i];
    const cv = worldToCanvas(p.x, p.y);

    ctx.beginPath();
    ctx.fillStyle = 'rgba(24, 35, 58, 0.75)';
    ctx.arc(cv.x, cv.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.8;

  for (const [trajId, pts] of tracks.entries()) {
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = colorForTraj(trajId);
    const first = worldToCanvas(pts[0].x, pts[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const cv = worldToCanvas(pts[i].x, pts[i].y);
      ctx.lineTo(cv.x, cv.y);
    }
    ctx.stroke();
  }

  if (cursor > 0) {
    const p = sortedByTime[Math.max(0, cursor - 1)];
    const cv = worldToCanvas(p.x, p.y);
    ctx.beginPath();
    ctx.fillStyle = colorForTraj(p.traId);
    ctx.arc(cv.x, cv.y, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function resizeCanvas () {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvasCssWidth = Math.max(1, Math.floor(rect.width));
  canvasCssHeight = Math.max(1, Math.floor(rect.height));
  canvas.width = Math.max(1, Math.floor(canvasCssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvasCssHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (mapReady) {
    map.invalidateSize();
  }

  draw();
}

async function tryLoadDefaultCsv () {
  try {
    const resp = await fetch('../data/output/1_associated.csv');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const points = parseCsv(text);
    loadData(points);
  } catch (err) {
    statusText.textContent = '默认CSV加载失败，请使用“导入CSV”。';
  }
}

playPauseBtn.addEventListener('click', () => {
  if (!sortedByTime.length) return;
  running = !running;
  playPauseBtn.textContent = running ? '暂停' : '播放';
  statusText.textContent = running ? '播放中…' : '已暂停。';

  if (running) {
    lastFrame = 0;
    requestAnimationFrame(step);
  }
});

resetBtn.addEventListener('click', () => {
  running = false;
  playPauseBtn.textContent = '播放';
  resetState();
  statusText.textContent = '已重置。点击“播放”开始。';
});

speedSelect.addEventListener('change', () => {
  speed = Number(speedSelect.value);
});

assocDelayRange.addEventListener('input', () => {
  assocDelayMs = Number(assocDelayRange.value);
  assocDelayText.textContent = `${assocDelayMs}ms`;
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const points = parseCsv(text);
    loadData(points);
    statusText.textContent = `已导入 ${file.name}，点数 ${points.length}。`;
  } catch (err) {
    statusText.textContent = `导入失败：${err.message}`;
  }
});

window.addEventListener('resize', resizeCanvas);

(async function init () {
  initMap();
  resizeCanvas();
  await tryLoadDefaultCsv();
})();
