// Gift catalog. Official names, coin values and artwork come only from TikTok's gift list
// (fetched via the connector while a room is live). Seed entries are marked unverified.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './settings.js';

const FILE = path.join(DATA_DIR, 'gift-catalog.json');
const SEED = [
  { key: 'rose', name: 'Rose', verified: false },
  { key: 'donut', name: 'Donut', verified: false },
  { key: 'galaxy', name: 'Galaxy', verified: false },
];
const normGift = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

let catalog = { fetchedAt: null, gifts: SEED.map(g => ({ ...g, id: null, coins: null, image: '' })) };
try { const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (saved?.gifts?.length) catalog = saved; } catch { /* first run */ }

export function getCatalog() { return catalog; }

export function mergeCatalog(list) {
  const byKey = new Map(catalog.gifts.map(g => [g.key, g]));
  let n = 0;
  for (const g of list) {
    const name = g.name; if (!name) continue;
    const key = normGift(name);
    byKey.set(key, {
      key, name, id: g.id ?? null, coins: g.diamond_count ?? g.diamondCount ?? null,
      image: g.image?.url_list?.[0] || g.image?.urlList?.[0] || g.icon?.url_list?.[0] || '',
      type: g.type ?? null, verified: true,
    });
    n++;
  }
  catalog = { fetchedAt: Date.now(), gifts: [...byKey.values()].sort((a, b) => (a.coins ?? 1e9) - (b.coins ?? 1e9) || a.name.localeCompare(b.name)) };
  fs.writeFileSync(FILE, JSON.stringify(catalog, null, 1));
  return n;
}
