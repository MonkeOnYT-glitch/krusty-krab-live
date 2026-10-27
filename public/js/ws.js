// Auto-reconnecting WebSocket client shared by the control panel and overlays.
export function connect({ onState, onScene, onStatus }) {
  let ws, seq = 0; const pending = new Map();
  const open = () => {
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => onStatus?.(true);
    ws.onclose = () => { onStatus?.(false); for (const p of pending.values()) p.reject(new Error('disconnected')); pending.clear(); setTimeout(open, 1500); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'state') onState?.(m.state);
      else if (m.t === 'scene') onScene?.(m);
      else if (m.t === 'res') { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error)); } }
    };
  };
  open();
  return {
    req(action, data = {}) {
      return new Promise((resolve, reject) => {
        if (ws.readyState !== 1) return reject(new Error('Not connected to the Krusty Krab server'));
        const id = ++seq; pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ t: 'req', id, action, data }));
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Request timed out')); } }, 120000);
      });
    },
  };
}
