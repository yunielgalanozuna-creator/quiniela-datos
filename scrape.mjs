// Robot de Quiniela al Día: lee resultados de páginas oficiales y mantiene data.json e history.json.
import { chromium } from 'playwright';
import fs from 'fs';

const TZ = 'America/Santo_Domingo';
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const hist = load('history.json', { draws: [] });
const nowRD = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
const pad = (n) => String(n).padStart(2, '0');
const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };

const MAP = {
  'Leidsa/Loto': { co: 'leidsa', n: 'Loto Leidsa y Loto Más', x: 2 },
  'Leidsa/KinoTV': { co: 'leidsa', n: 'Super Kino TV' },
  'Leidsa/Loto Pool': { co: 'leidsa', n: 'Loto Pool' },
  'Leidsa/Quiniela Pale': { co: 'leidsa', n: 'Quiniela Leidsa' },
  'Leidsa/Pega3Mas': { co: 'leidsa', n: 'Pega 3 Más' },
  'Loteka/Quiniela Pale': { co: 'loteka', n: 'Quiniela Loteka', dn: true },
  'Loteria Real/Quiniela Pale': { co: 'real', n: 'Quiniela Real', dn: true },
  'La Suerte/Quiniela Pale': { co: 'other', n: 'La Suerte', dn: true },
  'Lotedom/Quiniela Pale': { co: 'other', n: 'LoteDom', dn: true },
  'La Primera/Quiniela Pale': { co: 'other', n: 'La Primera', dn: true },
};

function add(co, n, d, t, b, x) {
  if (!b || !b.length) return;
  const id = n + '|' + d + '|' + t;
  if (hist.draws.some((r) => r.id === id)) return;
  const r = { id, co, n, d, t, b };
  if (x) r.x = x;
  hist.draws.push(r);
  console.log('nuevo:', id, b.join(' '));
}

async function leidsa(page) {
  await page.goto('https://www.leidsa.com/results', { waitUntil: 'networkidle', timeout: 60000 });
  const cards = await page.evaluate(() => {
    const isVer = (a) => /VER RESULTADOS/i.test(a.innerText);
    const out = [];
    for (const a of document.querySelectorAll('main a')) {
      if (!isVer(a)) continue;
      let c = a;
      while (c.parentElement && [...c.parentElement.querySelectorAll('a')].filter(isVer).length === 1) c = c.parentElement;
      out.push({ href: decodeURIComponent(a.getAttribute('href')), text: c.innerText });
    }
    return out;
  });
  for (const c of cards) {
    const seg = c.href.split('/').filter(Boolean);
    const m = MAP[seg[1] + '/' + seg[2]];
    if (!m) continue;
    const lines = c.text.split('\n').map((s) => s.trim()).filter(Boolean);
    const b = lines.filter((s) => /^\d{1,2}$/.test(s)).map(Number);
    const dm = c.text.match(/(\d{1,2})\s+([a-záéíóú]{3})[a-z.]*\s+(\d{1,2}):(\d{2})\s*([ap])\.?\s*m/i);
    if (!dm || !b.length) continue;
    const mes = MESES[dm[2].toLowerCase()];
    let y = nowRD.getFullYear();
    if (mes > nowRD.getMonth() + 1) y -= 1;
    let h = Number(dm[3]) % 12; if (dm[5].toLowerCase() === 'p') h += 12;
    const d = y + '-' + pad(mes) + '-' + pad(dm[1]);
    const t = pad(h) + ':' + dm[4];
    const name = m.dn ? m.n + (h < 16 ? ' Día' : ' Noche') : m.n;
    add(m.co, name, d, t, b, m.x);
  }
}

async function nacional(page) {
  await page.goto('https://www.loterianacional.gob.do/', { waitUntil: 'networkidle', timeout: 60000 });
  const r = await page.evaluate(() => {
    const leer = (etiqueta) => {
      const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === etiqueta);
      if (!el) return null;
      let p = el;
      for (let i = 0; i < 6 && p; i++) {
        p = p.parentElement;
        const t = p.innerText.replace(/\s+/g, ' ');
        const m = t.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})\s+(\d{2})\s+(\d{2})/);
        if (m) return { d: m[3] + '-' + m[2] + '-' + m[1], b: [m[4], m[5], m[6]].map(Number) };
      }
      return null;
    };
    return { tarde: leer('Bancas (Tarde)'), noche: leer('Bancas (Noche)') };
  });
  if (r.tarde) add('nacional', 'Gana Más', r.tarde.d, '14:30', r.tarde.b);
  if (r.noche) add('nacional', 'Nacional Noche', r.noche.d, '21:00', r.noche.b);
}

async function ny() {
  const get = (id) => fetch('https://data.ny.gov/resource/' + id + '.json?$order=draw_date%20DESC&$limit=3').then((r) => r.json());
  const rows = await get('hsys-3def');
  const q = (p3, w4) => { const a = String(p3).padStart(3, '0'), w = String(w4).padStart(4, '0'); return [Number(a.slice(-2)), Number(w.slice(0, 2)), Number(w.slice(-2))]; };
  for (const r of rows) {
    const d = r.draw_date.slice(0, 10);
    if (r.midday_daily && r.midday_win_4) add('ny', 'New York Tarde', d, '14:30', q(r.midday_daily, r.midday_win_4));
    if (r.evening_daily && r.evening_win_4) add('ny', 'New York Noche', d, '22:30', q(r.evening_daily, r.evening_win_4));
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'es-DO', timezoneId: TZ });
const page = await ctx.newPage();
for (const [nombre, f] of [['leidsa', () => leidsa(page)], ['nacional', () => nacional(page)], ['ny', () => ny()]]) {
  try { await f(); } catch (e) { console.log('FALLÓ', nombre, String(e).slice(0, 200)); }
}
await browser.close();

hist.draws.sort((a, b) => (a.d + a.t < b.d + b.t ? 1 : -1));
hist.draws = hist.draws.slice(0, 6000);
fs.writeFileSync('history.json', JSON.stringify(hist));

const GROUPS = [
  ['leidsa', 'Leidsa', ['Quiniela Leidsa', 'Pega 3 Más', 'Loto Pool', 'Super Kino TV', 'Loto Leidsa y Loto Más'], '/p/resultados-de-leidsa-hoy-quiniela-pega.html'],
  ['nacional', 'Lotería Nacional', ['Gana Más', 'Nacional Noche'], '/p/loteria-nacional-gana-mas.html'],
  ['loteka', 'Loteka', ['Quiniela Loteka Día', 'Quiniela Loteka Noche'], '/p/resultados-de-loteka-hoy-quiniela-y.html'],
  ['real', 'Lotería Real', ['Quiniela Real Día', 'Quiniela Real Noche'], ''],
  ['other', 'La Primera, La Suerte y LoteDom', ['La Primera Día', 'La Primera Noche', 'La Suerte Día', 'La Suerte Noche', 'LoteDom Día', 'LoteDom Noche'], ''],
  ['ny', 'Lotería New York', ['New York Tarde', 'New York Noche'], '/p/loteria-new-york-tarde-y-noche.html'],
];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MN = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function etiqueta(r) {
  const [y, m, d] = r.d.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  let s = DIAS[dt.getDay()] + ' ' + d + ' ' + MN[m - 1];
  if (r.co === 'ny' || r.n === 'Nacional Noche') return s;
  const [h, mi] = r.t.split(':').map(Number);
  return s + ', ' + (h % 12 || 12) + ':' + pad(mi) + ' ' + (h >= 12 ? 'p. m.' : 'a. m.');
}
const c = [];
for (const [k, n, juegos, u] of GROUPS) {
  const g = [];
  for (const j of juegos) {
    const r = hist.draws.find((x) => x.n === j);
    if (r) { const o = { n: j, d: etiqueta(r), b: r.b }; if (r.x) o.x = r.x; g.push(o); }
  }
  if (g.length) c.push({ k, n, u, g });
}
const fecha = nowRD.toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const hora = nowRD.toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit', hour12: true });
fs.writeFileSync('data.json', JSON.stringify({ u: fecha + ', ' + hora + ' (hora de República Dominicana)', c }));
console.log('listo', c.length, 'grupos');
