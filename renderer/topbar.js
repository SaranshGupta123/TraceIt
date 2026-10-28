// --- Trace state ---
let tracing = false;
const traceBtn = document.getElementById('traceBtn');

function setTraceUI(active) {
  tracing = active;
  traceBtn.classList.toggle('active', active);
  traceBtn.textContent = active ? 'Tracing' : 'Trace';
}

traceBtn.addEventListener('click', () => {
  if (window.electronAPI) window.electronAPI.traceToggle();
});

if (window.electronAPI) {
  window.electronAPI.onTraceState((active) => setTraceUI(active));
}

// --- Window & Action Button handlers ---
document.getElementById('uploadBtn').addEventListener('click', () => {
  if (window.electronAPI) window.electronAPI.uploadClicked();
});

const centerBtn = document.getElementById('centerBtn');
if (centerBtn) {
  centerBtn.addEventListener('click', () => {
    if (window.electronAPI) window.electronAPI.centerImage();
  });
}

document.getElementById('minBtn').addEventListener('click', () => {
  if (window.electronAPI) window.electronAPI.minimizeClicked();
});

const maxBtn = document.getElementById('maxBtn');
const maxIcon = document.getElementById('maxIcon');

function setMaximizedUI(maximized) {
  maxBtn.title = maximized ? 'Restore' : 'Maximize';
  if (maxIcon) {
    if (maximized) {
      // Overlapping squares icon (Restore)
      maxIcon.innerHTML = '<path d="M3 1v2H1v6h6V7h2V1H3zm3 7H2V4h4v4zm2-2h-1V3H4V2h4v4z" fill="currentColor"/>';
    } else {
      // Single square icon (Maximize)
      maxIcon.innerHTML = '<path d="M1 1v8h8V1H1zm7 7H2V2h6v6z" fill="currentColor"/>';
    }
  }
}

maxBtn.addEventListener('click', () => {
  if (window.electronAPI) window.electronAPI.maximizeToggle();
});

if (window.electronAPI && window.electronAPI.onMaximizedState) {
  window.electronAPI.onMaximizedState((maximized) => setMaximizedUI(maximized));
}

document.getElementById('exitBtn').addEventListener('click', () => {
  if (window.electronAPI) window.electronAPI.exitClicked();
});

// --- Drag (only from the spacer / empty area of bar) ---
const dragArea = document.getElementById('dragArea');
let dragging = false;

function startDrag(e) {
  if (e.button !== 0 || tracing) return; // block drag when tracing
  dragging = true;
  if (window.electronAPI) window.electronAPI.topBarDragStart(e.screenX, e.screenY);
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
}

function endDrag() {
  if (dragging) {
    dragging = false;
    if (window.electronAPI) window.electronAPI.topBarDragEnd();
  }
}

dragArea.addEventListener('pointerdown', startDrag);
dragArea.addEventListener('pointerup', endDrag);
dragArea.addEventListener('pointercancel', endDrag);

// Double-click spacer to toggle maximize / restore
dragArea.addEventListener('dblclick', () => {
  if (window.electronAPI) window.electronAPI.maximizeToggle();
});

// Also allow dragging from the bar background (areas not covered by children)
const bar = document.getElementById('bar');
bar.addEventListener('pointerdown', (e) => {
  if (e.target !== bar) return;
  startDrag(e);
});
bar.addEventListener('pointerup', (e) => {
  if (e.target !== bar) return;
  endDrag();
});
bar.addEventListener('pointercancel', endDrag);

// --- Scale and opacity controls ---
const scaleSlider = document.getElementById('scaleSlider');
const scaleValue = document.getElementById('scaleValue');
const opacitySlider = document.getElementById('opacitySlider');
const opacityValue = document.getElementById('opacityValue');

function clampPercent(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function updateScaleControls(value) {
  const pct = clampPercent(value, Number(scaleSlider.min), Number(scaleSlider.max));
  scaleSlider.value = String(pct);
  scaleValue.value = String(pct);
}

function updateOpacityControls(value) {
  const pct = clampPercent(value, Number(opacitySlider.min), Number(opacitySlider.max));
  opacitySlider.value = String(pct);
  opacityValue.value = String(pct);
}

if (window.electronAPI) {
  window.electronAPI.getInitialConfig().then((cfg) => {
    if (cfg && typeof cfg.overlayScale === 'number') {
      updateScaleControls(cfg.overlayScale * 100);
    }
    if (cfg && typeof cfg.opacity === 'number') {
      const pct = Math.round((cfg.opacity / 255) * 100);
      updateOpacityControls(pct);
    }
    if (cfg && typeof cfg.traceMode === 'boolean') {
      setTraceUI(cfg.traceMode);
    }
    if (cfg && typeof cfg.isMaximized === 'boolean') {
      setMaximizedUI(cfg.isMaximized);
    }
  });

  if (window.electronAPI.onSetScale) {
    window.electronAPI.onSetScale((scale) => {
      updateScaleControls(scale * 100);
    });
  }
}

scaleSlider.addEventListener('input', () => {
  const pct = parseInt(scaleSlider.value, 10);
  scaleValue.value = String(pct);
  if (window.electronAPI) window.electronAPI.setScale(pct / 100);
});

scaleValue.addEventListener('change', () => {
  const value = scaleValue.valueAsNumber;
  updateScaleControls(Number.isFinite(value) ? value : Number(scaleSlider.value));
  if (window.electronAPI) window.electronAPI.setScale(Number(scaleSlider.value) / 100);
});

scaleValue.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') scaleValue.blur();
});

opacitySlider.addEventListener('input', () => {
  const pct = parseInt(opacitySlider.value, 10);
  opacityValue.value = String(pct);
  if (window.electronAPI) window.electronAPI.setOpacity(Math.round((pct / 100) * 255));
});

opacityValue.addEventListener('change', () => {
  const value = opacityValue.valueAsNumber;
  updateOpacityControls(Number.isFinite(value) ? value : Number(opacitySlider.value));
  if (window.electronAPI) {
    window.electronAPI.setOpacity(Math.round((Number(opacitySlider.value) / 100) * 255));
  }
});

opacityValue.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') opacityValue.blur();
});

// Keyboard controls when top bar has focus
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const step = e.shiftKey ? 25 : 5;
  if (e.key === 'ArrowLeft') {
    if (window.electronAPI && window.electronAPI.nudgePan) window.electronAPI.nudgePan(-step, 0);
  } else if (e.key === 'ArrowRight') {
    if (window.electronAPI && window.electronAPI.nudgePan) window.electronAPI.nudgePan(step, 0);
  } else if (e.key === 'ArrowUp') {
    if (window.electronAPI && window.electronAPI.nudgePan) window.electronAPI.nudgePan(0, -step);
  } else if (e.key === 'ArrowDown') {
    if (window.electronAPI && window.electronAPI.nudgePan) window.electronAPI.nudgePan(0, step);
  } else if (e.key === 'Home' || e.key === '0') {
    if (window.electronAPI && window.electronAPI.centerImage) window.electronAPI.centerImage();
  }
});
