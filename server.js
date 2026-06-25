const express  = require('express');
const path     = require('path');
const csv      = require('csv-parser');
const cors     = require('cors');
const zlib     = require('zlib');

let _fetch;
async function getFetch() {
  if (!_fetch) _fetch = (await import('node-fetch')).default;
  return _fetch;
}

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Spatial grid helpers ────────────────────────────────────────────────────
const CELL_SIZE = 0.01;

function cellKey(lat, lon) {
  return `${Math.floor(lat / CELL_SIZE)}_${Math.floor(lon / CELL_SIZE)}`;
}

function buildSpatialIndex(records) {
  const grid = {};
  for (const r of records) {
    const key = cellKey(r.lat, r.lon);
    if (!grid[key]) grid[key] = [];
    grid[key].push(r);
  }
  return grid;
}

function parseRow(row) {
  const lat = parseFloat(row.latitude);
  const lon = parseFloat(row.longitude);
  const val = parseFloat(row.valeur_fonciere);
  if (!lat || !lon || !val) return null;
  return {
    lat, lon,
    valeur:         val,
    surface:        parseFloat(row.surface_reelle_bati)         || null,
    surfaceTerrain: parseFloat(row.surface_terrain)             || null,
    type:           row.type_local                              || null,
    date:           row.date_mutation                           || '',
    pieces:         parseInt(row.nombre_pieces_principales)     || null,
    parcelle:       row.id_parcelle                             || null,
    commune:        row.nom_commune                             || null,
    codeCommune:    row.code_commune                            || null,
    codeDept:       row.code_departement                        || null,
    adresse:        [row.adresse_numero, row.adresse_nom_voie].filter(Boolean).join(' '),
    codePostal:     row.code_postal                             || null,
    natureCulture:  row.nature_culture                          || null,
    idMutation:     row.id_mutation                             || null,  // pour déduplication multi-lots
  };
}

// ─── Déduplication multi-lots DVF ─────────────────────────────────────────────
// DVF stocke une ligne par local (lot) dans une même mutation.
// La valeur_fonciere est TOTALE pour toute la mutation : il faut répartir
// la valeur proportionnellement à la surface de chaque lot bâti.
// Sans déduplication, un immeuble de 2 apparts vendu 300k afficherait
// 300k/surface_lot1 ET 300k/surface_lot2 → prix/m² artificiellement élevés.
function dedupMultiLots(records) {
  // Grouper par id_mutation
  const byMutation = new Map();
  for (const r of records) {
    const key = r.idMutation || `${r.date}_${r.adresse}_${r.valeur}`;
    if (!byMutation.has(key)) byMutation.set(key, []);
    byMutation.get(key).push(r);
  }

  const result = [];
  for (const [, lots] of byMutation) {
    if (lots.length === 1) {
      result.push(lots[0]);
      continue;
    }
    // Mutation multi-lots : calculer la surface bâtie totale de la mutation
    const totalSurfaceBati = lots
      .filter(l => l.surface && l.surface > 0)
      .reduce((s, l) => s + l.surface, 0);

    if (totalSurfaceBati <= 0) {
      result.push(...lots);
      continue;
    }

    // Distribuer la valeur proportionnellement à chaque lot
    const valeur = lots[0].valeur;
    for (const lot of lots) {
      if (!lot.surface || lot.surface <= 0) continue;
      // La quote-part de valeur de ce lot = valeur × (surface_lot / surface_totale)
      const valeurLot = valeur * (lot.surface / totalSurfaceBati);
      result.push({ ...lot, valeur: valeurLot });
    }
  }
  return result;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
          + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function searchRadius(grid, lat, lon, distKm) {
  const cellsNeeded = Math.ceil(distKm / (CELL_SIZE * 111)) + 1;
  const centerLatCell = Math.floor(lat / CELL_SIZE);
  const centerLonCell = Math.floor(lon / CELL_SIZE);
  const candidates = [];
  for (let dlat = -cellsNeeded; dlat <= cellsNeeded; dlat++) {
    for (let dlon = -cellsNeeded; dlon <= cellsNeeded; dlon++) {
      const key = `${centerLatCell + dlat}_${centerLonCell + dlon}`;
      if (grid[key]) candidates.push(...grid[key]);
    }
  }
  return candidates.filter(r => haversine(lat, lon, r.lat, r.lon) <= distKm);
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stats(prices) {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  return {
    count:  prices.length,
    mean:   Math.round(prices.reduce((s, v) => s + v, 0) / prices.length),
    median: Math.round(percentile(prices, 50)),
    p10:    Math.round(percentile(prices, 10)),
    p90:    Math.round(percentile(prices, 90)),
    min:    Math.round(sorted[0]),
    max:    Math.round(sorted[sorted.length - 1]),
  };
}

// ─── data.gouv.fr DVF loader ─────────────────────────────────────────────────
const DVF_BASE = 'https://files.data.gouv.fr/geo-dvf/latest/csv';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const deptCache = new Map(); // deptCode → { records, grid, ts }
const loadingPromises = new Map(); // avoid parallel downloads for same dept

async function fetchDeptYear(deptCode, year) {
  const fetch = await getFetch();
  const url   = `${DVF_BASE}/${year}/departements/${deptCode}.csv.gz`;
  const res   = await fetch(url);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);

  return new Promise((resolve, reject) => {
    const records = [];
    const gunzip  = zlib.createGunzip();
    res.body.pipe(gunzip).pipe(csv())
      .on('data', (row) => { const r = parseRow(row); if (r) records.push(r); })
      .on('end',  () => resolve(records))
      .on('error', reject);
  });
}

async function loadDeptRecords(deptCode) {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear - 1; y >= Math.max(currentYear - 3, 2022); y--) years.push(y);

  console.log(`[DVF] Téléchargement dép. ${deptCode} (années ${years.join(', ')})…`);
  const chunks = await Promise.all(
    years.map(y => fetchDeptYear(deptCode, y).catch(e => {
      console.warn(`[DVF] ${deptCode}/${y} ignoré : ${e.message}`);
      return [];
    }))
  );
  const records = chunks.flat();
  const grid    = buildSpatialIndex(records);
  console.log(`[DVF] ${deptCode} : ${records.length.toLocaleString('fr-FR')} transactions en mémoire`);
  return { records, grid, ts: Date.now() };
}

async function getDeptData(deptCode) {
  const cached = deptCache.get(deptCode);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached;

  // Deduplicate concurrent requests for the same dept
  if (!loadingPromises.has(deptCode)) {
    const p = loadDeptRecords(deptCode)
      .then(entry => { deptCache.set(deptCode, entry); loadingPromises.delete(deptCode); return entry; })
      .catch(e   => { loadingPromises.delete(deptCode); throw e; });
    loadingPromises.set(deptCode, p);
  }
  return loadingPromises.get(deptCode);
}

// ─── Département from lat/lon via BAN reverse geocode ───────────────────────
async function fetchDeptCode(lat, lon) {
  const fetch = await getFetch();
  const url   = `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`;
  const res   = await fetch(url);
  const data  = await res.json();
  const citycode = data.features?.[0]?.properties?.citycode;
  if (!citycode) throw new Error('Département introuvable pour ces coordonnées');
  return citycode.startsWith('97') ? citycode.slice(0, 3) : citycode.slice(0, 2);
}

// ─── API : DVF ───────────────────────────────────────────────────────────────
app.get('/api/dvf', async (req, res) => {
  const lat    = parseFloat(req.query.lat);
  const lon    = parseFloat(req.query.lon);
  const dist   = parseFloat(req.query.dist)   || 1;
  const months = parseInt(req.query.months)   || 24;
  if (!lat || !lon) return res.status(400).json({ error: 'lat/lon requis' });

  let deptCode;
  try {
    deptCode = await fetchDeptCode(lat, lon);
  } catch (e) {
    return res.status(400).json({ error: 'Impossible de déterminer le département', detail: e.message });
  }

  let deptData;
  try {
    deptData = await getDeptData(deptCode);
  } catch (e) {
    console.error('[DVF] Erreur chargement :', e);
    return res.status(500).json({ error: 'Erreur chargement données DVF', detail: e.message });
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const t0 = Date.now();

  // Seuils de cohérence pour les prix au m²
  const PM2_MIN_BATI    = 500;   // en-dessous = vente partielle / donation
  const PM2_MAX_APPART  = 15000; // au-dessus = multi-lots non dédupliqués ou erreur
  const PM2_MAX_MAISON  = 20000;
  const SURF_MIN_BATI   = 9;     // en-dessous = cave / parking / local non résidentiel

  const nearby = searchRadius(deptData.grid, lat, lon, dist).filter(r => r.date >= cutoffStr);

  // Déduplication multi-lots sur l'ensemble des transactions proches
  const nearbyDedup = dedupMultiLots(nearby);

  // Filtre cohérence + surface minimale
  function isValidBati(r, pm2Max) {
    if (!r.surface || r.surface < SURF_MIN_BATI) return false;
    const pm2 = r.valeur / r.surface;
    return pm2 >= PM2_MIN_BATI && pm2 <= pm2Max;
  }

  const apparts  = nearbyDedup.filter(r => r.type === 'Appartement' && isValidBati(r, PM2_MAX_APPART));
  const maisons  = nearbyDedup.filter(r => r.type === 'Maison'      && isValidBati(r, PM2_MAX_MAISON));
  const terrains = nearbyDedup.filter(r => (!r.type || r.type === '') && r.surfaceTerrain > 0);

  const typologies = {};
  for (const r of apparts) {
    const t = r.pieces ? `T${Math.min(r.pieces, 5)}` : 'NC';
    if (!typologies[t]) typologies[t] = [];
    typologies[t].push(r.valeur / r.surface);
  }
  const typoStats = {};
  for (const [k, v] of Object.entries(typologies)) typoStats[k] = stats(v);

  const evolutionMap = {};
  for (const r of [...apparts, ...maisons]) {
    const key = r.date.slice(0, 7);
    if (!evolutionMap[key]) evolutionMap[key] = [];
    evolutionMap[key].push(r.valeur / r.surface);
  }
  const evolution = Object.entries(evolutionMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-18)
    .map(([mois, prix]) => ({ mois, median: Math.round(percentile(prix, 50)), count: prix.length }));

  const transactions = [...apparts, ...maisons]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 100)
    .map(r => ({ lat: r.lat, lon: r.lon, type: r.type,
      prix: Math.round(r.valeur / r.surface), valeur: Math.round(r.valeur),
      surface: r.surface, pieces: r.pieces, date: r.date,
      adresse: r.adresse, commune: r.commune }));

  const filtered = nearby.length - nearbyDedup.filter(r =>
    (r.type === 'Appartement' || r.type === 'Maison') && r.surface >= SURF_MIN_BATI
  ).length;
  console.log(`[DVF] ${lat},${lon} dép=${deptCode} dist=${dist}km months=${months} → ${nearby.length} brut / ${apparts.length + maisons.length} qualifiés en ${Date.now()-t0}ms`);
  res.json({
    zone: { lat, lon, dist, months }, dept: deptCode, total: nearby.length,
    totalQualifie: apparts.length + maisons.length, tempsMs: Date.now()-t0,
    appartements: { stats: stats(apparts.map(r => r.valeur/r.surface)), typologies: typoStats },
    maisons:      { stats: stats(maisons.map(r => r.valeur/r.surface)) },
    terrains:     { stats: stats(terrains.map(r => r.valeur/r.surfaceTerrain)) },
    evolution, transactions,
  });
});

app.get('/api/status', (req, res) => {
  const depts = [...deptCache.entries()].map(([code, d]) => ({
    code,
    transactions: d.records.length,
    ageMin: Math.round((Date.now() - d.ts) / 60000),
  }));
  res.json({
    source: 'data.gouv.fr (DVF géolocalisé)',
    departementsEnCache: depts.length,
    depts,
    memoireMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    ok: true,
  });
});

// ─── API : Annonces à vendre (scraping PAP.fr) ───────────────────────────────
const annoncesCache = new Map();  // key → { data, ts }
const ANNONCES_TTL  = 6 * 60 * 60 * 1000; // 6h

app.get('/api/annonces', async (req, res) => {
  const lat  = parseFloat(req.query.lat);
  const lon  = parseFloat(req.query.lon);
  if (!lat || !lon) return res.status(400).json({ error: 'lat/lon requis' });

  // Determine city name + dept + postal from BAN reverse geocode
  let city, dept, postal;
  try {
    const fetch = await getFetch();
    const geo   = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`);
    const geoData = await geo.json();
    const props = geoData.features?.[0]?.properties;
    if (!props) throw new Error('Pas de résultat geocode');
    city   = props.city || props.municipality || '';
    postal = props.postcode || '';
    dept   = props.context?.split(',')[0]?.trim() || postal.slice(0, 2);
  } catch (e) {
    return res.status(400).json({ error: 'Géocode échoué', detail: e.message });
  }

  const cacheKey = `${city}_${postal}`;
  const cached   = annoncesCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ANNONCES_TTL) {
    return res.json({ ...cached.data, cached: true });
  }

  // Spawn Python scraper
  const { spawn } = require('child_process');
  const scriptPath = path.join(__dirname, 'scraper_annonces.py');
  const input      = JSON.stringify({ lat, lon, city, dept, postal });

  const py = spawn('python3', [scriptPath]);
  py.stdin.write(input);
  py.stdin.end();

  let stdout = '', stderr = '';
  py.stdout.on('data', d => { stdout += d.toString(); });
  py.stderr.on('data', d => { stderr += d.toString(); process.stdout.write('[Annonces] ' + d.toString()); });

  py.on('close', (code) => {
    try {
      const data = JSON.parse(stdout);
      if (!data.error) {
        annoncesCache.set(cacheKey, { data, ts: Date.now() });
      }
      res.json(data);
    } catch (e) {
      console.error('[Annonces] JSON parse error:', e.message, stdout.slice(0, 200));
      res.status(500).json({ error: 'Erreur scraping annonces', detail: stderr.slice(0, 500) });
    }
  });

  py.on('error', (e) => {
    res.status(500).json({ error: 'Impossible de lancer le scraper Python', detail: e.message });
  });
});

// ─── API : Génération PDF compte rendu ───────────────────────────────────────
app.post('/api/rapport', express.json({ limit: '2mb' }), (req, res) => {
  const { spawn } = require('child_process');
  const os = require('os');
  const tmpFile = path.join(os.tmpdir(), 'rapport_' + Date.now() + '.pdf');
  const payload = JSON.stringify(req.body);
  const scriptPath = path.join(__dirname, 'generer_rapport.py');

  const py = spawn('python3', [scriptPath, tmpFile]);
  py.stdin.write(payload);
  py.stdin.end();

  let stderr = '';
  py.stderr.on('data', d => { stderr += d.toString(); });
  py.on('close', (code) => {
    if (code !== 0) {
      console.error('[PDF] Erreur:', stderr);
      return res.status(500).json({ error: 'Erreur génération PDF', detail: stderr });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="rapport_visite.pdf"');
    const stream = require('fs').createReadStream(tmpFile);
    stream.pipe(res);
    stream.on('end', () => { try { require('fs').unlinkSync(tmpFile); } catch(e){} });
  });
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

console.log('\n=============================================');
console.log('  Dilimo — ImmoAnalytics Pro');
console.log('=============================================');
console.log('📡 Source : data.gouv.fr — DVF géolocalisé');
console.log('🗂️  Chargement à la demande par département');
console.log(`🚀 Application → http://localhost:${PORT}`);
console.log('=============================================\n');

app.listen(PORT);
