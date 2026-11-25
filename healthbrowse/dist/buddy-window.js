// The same dialog owns chat, focus and attachments in either view.
export function setupBuddyWindow(dialog, close) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'buddy-window-toggle';
  toggle.textContent = 'Full window';
  toggle.setAttribute('aria-controls', dialog.id);
  close.before(toggle);
  toggle.onclick = () => {
    const full = dialog.classList.toggle('buddy-full-window');
    toggle.textContent = full ? 'Restore panel' : 'Full window';
  };

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'buddy-window-resize';
  handle.textContent = '⤡';
  handle.setAttribute('aria-label', 'Resize Buddy panel');
  handle.title = 'Drag to resize or use the arrow keys. Press Enter to reset the size.';
  handle.setAttribute('aria-description', handle.title);
  dialog.append(handle);

  function setSize(width, height) {
    const limit = (value, min, max) => Math.min(max, Math.max(min, value));
    dialog.style.setProperty('--buddy-width', limit(width, 400, window.innerWidth - 48) + 'px');
    dialog.style.setProperty('--buddy-height', limit(height, 420, window.innerHeight - 48) + 'px');
  }
  const steps = { ArrowLeft: [24, 0], ArrowRight: [-24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
  handle.addEventListener('keydown', event => {
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const rect = dialog.getBoundingClientRect();
    setSize(rect.width + step[0], rect.height + step[1]);
  });
  handle.addEventListener('click', event => {
    if (event.detail !== 0) return;
    dialog.style.removeProperty('--buddy-width');
    dialog.style.removeProperty('--buddy-height');
  });

  let start;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    const {width, height} = dialog.getBoundingClientRect();
    start = {id: event.pointerId, x: event.clientX, y: event.clientY, width, height};
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (start?.id !== event.pointerId) return;
    setSize(start.width + start.x - event.clientX, start.height + event.clientY - start.y);
  });
  handle.addEventListener('lostpointercapture', () => { start = undefined; });
}
