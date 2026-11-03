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
  console.log('leidsa página:', await page.title(), '|', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200));
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
    if (!m) { console.log('sin mapa:', seg[1] + '/' + seg[2]); continue; }
    const lines = c.text.split('\n').map((s) => s.trim()).filter(Boolean);
    const b = lines.filter((s) => /^\d{1,2}$/.test(s)).map(Number);
    const dm = c.text.match(/(\d{1,2})\s+([a-záéíóú]{3})[a-z.]*\s+(\d{1,2}):(\d{2})\s*([ap])\.?\s*m/i);
    console.log('leidsa card:', seg[1] + '/' + seg[2], dm ? dm[0] : 'SIN-FECHA', b.join(' '));
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

async function loteka(page) {
  await page.goto('https://loteka.com.do/', { waitUntil: 'networkidle', timeout: 60000 });
  const txt = await page.evaluate(() => {
    const h = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /Resultados anteriores/i.test(e.textContent));
    if (!h) return '';
    let p = h;
    for (let i = 0; i < 6 && p.parentElement; i++) { p = p.parentElement; if (/\d{2}\/\d{2}\/\d{4}/.test(p.innerText) && p.innerText.length > 150) break; }
    return p.innerText.replace(/\s+/g, ' ');
  });
  const parts = txt.split(/(\d{2}\/\d{2}\/\d{4})/);
  for (let i = 1; i < parts.length; i += 2) {
    const [dd, mm, yy] = parts[i].split('/');
    const d = yy + '-' + mm + '-' + dd;
    const chunk = parts[i + 1] || '';
    const q = chunk.match(/1er\.\s*(\d+)\s*2do\.\s*(\d+)\s*3er\.\s*(\d+)/);
    if (q) {
      if ([q[1], q[2], q[3]].some((x) => x.length < 2)) continue; // otro juego de un solo dígito
      const b = [q[1], q[2], q[3]].map(Number);
      const dup = hist.draws.find((r) => /^Quiniela Loteka (Día|Noche)$/.test(r.n) && r.d === d && r.b.join() === b.join());
      if (dup) continue;
      if (nowRD.getHours() < 18) add('loteka', 'Quiniela Loteka Día', d, '13:30', b);
      else add('loteka', 'Quiniela Loteka Noche', d, '20:05', b);
      continue;
    }
    const nums = (chunk.split(/Avenida/)[0].match(/\d+/g) || []).map(Number);
    if (nums.length === 8) add('loteka', 'Mega Lotto', d, '19:55', nums);
    else if (nums.length === 5) add('loteka', 'Mega Chances', d, '20:04', nums);
    else if (nums.length === 1) add('loteka', 'Repartidera Mega Chances', d, '20:05', nums);
  }
}

async function nacional(page) {
  await page.goto('https://www.loterianacional.gob.do/', { waitUntil: 'networkidle', timeout: 60000 });
  console.log('nacional página:', await page.title(), '|', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200));
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
  console.log('nacional leyó:', JSON.stringify(r));
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

async function florida(page) {
  await page.goto('https://floridalottery.com/games/winning-numbers', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => /Fireball/.test(document.body.innerText), null, { timeout: 30000 });
  const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const MN3 = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  const fecha = (m) => m[3] + '-' + MN3[m[1].toUpperCase()] + '-' + pad(m[2]);
  const re4 = /[A-Z]{3}, ([A-Z]{3}) (\d{1,2}), (\d{4}) (\d) (\d) (\d) (\d) Fireball/g;
  const re3 = /[A-Z]{3}, ([A-Z]{3}) (\d{1,2}), (\d{4}) (\d) (\d) (\d) Fireball/g;
  const p4 = [...txt.matchAll(re4)].map((m) => ({ d: fecha(m), v: m.slice(4, 8).join('') }));
  const p3 = [...txt.matchAll(re3)].map((m) => ({ d: fecha(m), v: m.slice(4, 7).join('') }));
  // orden en la página: primero mediodía, luego noche
  const turnos = [['Florida Día', '14:30'], ['Florida Noche', '22:45']];
  for (let i = 0; i < 2; i++) {
    if (p3[i] && p4[i] && p3[i].d === p4[i].d) {
      const a = p3[i].v, w = p4[i].v;
      add('fl', turnos[i][0], p3[i].d, turnos[i][1], [Number(a.slice(-2)), Number(w.slice(0, 2)), Number(w.slice(-2))]);
    }
  }
}

async function georgia(page) {
  await page.goto('https://www.galottery.com/en-us/winning-numbers.html', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => /LATEST DRAW RESULTS/i.test(document.body.innerText), null, { timeout: 30000 });
  const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const sec = (a, b) => { const i = txt.indexOf(a); const j = txt.indexOf(b, i + 1); return i < 0 ? '' : txt.slice(i, j < 0 ? i + 300 : j); };
  const c3 = sec('Play Cash 3', 'Play Cash 4'), c4 = sec('Play Cash 4', 'Play Cash Pop');
  const re = (n) => new RegExp('(MIDDAY|EVENING|NIGHT)\\s+(\\d{2})/(\\d{2})/(\\d{4})\\s+' + Array(n).fill('(\\d)').join('\\s+'), 'g');
  const g3 = [...c3.matchAll(re(3))], g4 = [...c4.matchAll(re(4))];
  const NOM = { MIDDAY: ['Georgia Día', '13:29'], EVENING: ['Georgia Tarde', '19:59'], NIGHT: ['Georgia Noche', '23:34'] };
  for (const m3 of g3) {
    const m4 = g4.find((m) => m[1] === m3[1] && m[2] === m3[2] && m[3] === m3[3] && m[4] === m3[4]);
    if (!m4) continue;
    const a = m3.slice(5, 8).join(''), w = m4.slice(5, 9).join('');
    add('ga', NOM[m3[1]][0], m3[4] + '-' + m3[2] + '-' + m3[3], NOM[m3[1]][1], [Number(a.slice(-2)), Number(w.slice(0, 2)), Number(w.slice(-2))]);
  }
}

async function usa() {
  const get = (id) => fetch('https://data.ny.gov/resource/' + id + '.json?$order=draw_date%20DESC&$limit=3').then((r) => r.json());
  const nums = (s) => String(s).trim().split(/\s+/).map(Number);
  for (const r of await get('d6yy-54nr')) {
    const d = r.draw_date.slice(0, 10);
    add('usa', 'Powerball', d, '22:59', nums(r.winning_numbers), 1);
    if (r.double_play_winning_numbers) add('usa', 'Powerball Double Play', d, '23:00', nums(r.double_play_winning_numbers), 1);
  }
  for (const r of await get('5xaw-6ayf')) {
    const d = r.draw_date.slice(0, 10);
    add('usa', 'Mega Millions', d, '23:00', [...nums(r.winning_numbers), Number(r.mega_ball)], 1);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'es-DO', timezoneId: TZ });
const page = await ctx.newPage();
for (const [nombre, f] of [['leidsa', () => leidsa(page)], ['loteka', () => loteka(page)], ['nacional', () => nacional(page)], ['ny', () => ny()], ['usa', () => usa()], ['florida', () => florida(page)], ['georgia', () => georgia(page)]]) {
  try { await f(); } catch (e) { console.log('FALLÓ', nombre, String(e).slice(0, 200)); }
}
await browser.close();

hist.draws.sort((a, b) => (a.d + a.t < b.d + b.t ? 1 : -1));
hist.draws = hist.draws.slice(0, 6000);
fs.writeFileSync('history.json', JSON.stringify(hist));

const GROUPS = [
  ['leidsa', 'Leidsa', ['Quiniela Leidsa', 'Pega 3 Más', 'Loto Pool', 'Super Kino TV', 'Loto Leidsa y Loto Más'], '/p/resultados-de-leidsa-hoy-quiniela-pega.html'],
  ['nacional', 'Lotería Nacional', ['Gana Más', 'Nacional Noche'], '/p/loteria-nacional-gana-mas.html'],
  ['loteka', 'Loteka', ['Quiniela Loteka Día', 'Quiniela Loteka Noche', 'Mega Chances', 'Repartidera Mega Chances', 'Mega Lotto'], '/p/resultados-de-loteka-hoy-quiniela-y.html'],
  ['real', 'Lotería Real', ['Quiniela Real Día', 'Quiniela Real Noche'], ''],
  ['other', 'La Primera, La Suerte y LoteDom', ['La Primera Día', 'La Primera Noche', 'La Suerte Día', 'La Suerte Noche', 'LoteDom Día', 'LoteDom Noche'], ''],
  ['usa', 'Powerball y Mega Millions', ['Powerball', 'Powerball Double Play', 'Mega Millions'], '/p/powerball-y-mega-millions-resultados-de.html'],
  ['fl', 'Lotería Florida', ['Florida Día', 'Florida Noche'], ''],
  ['ga', 'Lotería Georgia', ['Georgia Día', 'Georgia Tarde', 'Georgia Noche'], ''],
  ['ny', 'Lotería New York', ['New York Tarde', 'New York Noche'], '/p/loteria-new-york-tarde-y-noche.html'],
];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MN = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function etiqueta(r) {
  const [y, m, d] = r.d.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  let s = DIAS[dt.getDay()] + ' ' + d + ' ' + MN[m - 1];
  if (r.co === 'ny' || r.co === 'fl' || r.co === 'ga' || r.co === 'usa' || r.n === 'Nacional Noche') return s;
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
