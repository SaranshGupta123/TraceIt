const img = document.getElementById('img');
const imgWrap = document.getElementById('imgWrap');

let currentScale = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let startX = 0;
let startY = 0;
let startPanX = 0;
let startPanY = 0;
let isTracing = false;

function applyTransform() {
  img.style.transform = `translate(${panX}px, ${panY}px) scale(${currentScale})`;
}

// Pan with mouse drag (left click)
imgWrap.addEventListener('pointerdown', (e) => {
  if (isTracing) return;
  if (e.button === 0) { // Left mouse button
    isPanning = true;
    startX = e.clientX;
    startY = e.clientY;
    startPanX = panX;
    startPanY = panY;
    imgWrap.classList.add('dragging');
    try { imgWrap.setPointerCapture(e.pointerId); } catch (_) {}
  }
});

imgWrap.addEventListener('pointermove', (e) => {
  if (!isPanning) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  panX = startPanX + dx;
  panY = startPanY + dy;
  applyTransform();
});

function endPan(e) {
  if (isPanning) {
    isPanning = false;
    imgWrap.classList.remove('dragging');
    try { imgWrap.releasePointerCapture(e.pointerId); } catch (_) {}
  }
}

imgWrap.addEventListener('pointerup', endPan);
imgWrap.addEventListener('pointercancel', endPan);

// Double-click to reset position back to center
imgWrap.addEventListener('dblclick', () => {
  if (isTracing) return;
  panX = 0;
  panY = 0;
  applyTransform();
});

// Mouse wheel scroll to pan / zoom
window.addEventListener('wheel', (e) => {
  if (isTracing) return;
  e.preventDefault();
  if (e.ctrlKey) {
    // Ctrl + Wheel: Zoom
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    const newScale = Math.max(0.49, Math.min(3, Math.round((currentScale + delta) * 100) / 100));
    if (window.electronAPI && window.electronAPI.setScale) {
      window.electronAPI.setScale(newScale);
    }
  } else {
    // Wheel: Pan
    panX -= e.deltaX;
    panY -= e.deltaY;
    applyTransform();
  }
}, { passive: false });

// Keyboard arrow keys to nudge position
window.addEventListener('keydown', (e) => {
  if (isTracing) return;
  const step = e.shiftKey ? 25 : 5;
  if (e.key === 'ArrowLeft') { panX -= step; applyTransform(); }
  else if (e.key === 'ArrowRight') { panX += step; applyTransform(); }
  else if (e.key === 'ArrowUp') { panY -= step; applyTransform(); }
  else if (e.key === 'ArrowDown') { panY += step; applyTransform(); }
  else if (e.key === 'Home' || e.key === '0') { panX = 0; panY = 0; applyTransform(); }
});

// IPC handlers
if (window.electronAPI) {
  window.electronAPI.onSetImage((fileUrl, scale) => {
    img.src = fileUrl;
    currentScale = scale || 1.0;
    panX = 0;
    panY = 0;
    applyTransform();
  });

  window.electronAPI.onSetScale((scale) => {
    currentScale = scale || 1.0;
    applyTransform();
  });

  if (window.electronAPI.onCenterImage) {
    window.electronAPI.onCenterImage(() => {
      panX = 0;
      panY = 0;
      applyTransform();
    });
  }

  if (window.electronAPI.onNudgePan) {
    window.electronAPI.onNudgePan((dx, dy) => {
      panX += dx;
      panY += dy;
      applyTransform();
    });
  }

  if (window.electronAPI.onTraceState) {
    window.electronAPI.onTraceState((active) => {
      isTracing = active;
      imgWrap.classList.toggle('tracing', active);
    });
  }
}
