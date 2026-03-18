const express = require('express');
const fs      = require('fs');
const path    = require('path');
const csv     = require('csv-parser');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Spatial grid index ───────────────────────────────────────────────────────
const CELL_SIZE = 0.01;
let spatialGrid = {};
let dvfRecords  = [];

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

function loadDVF(filePath) {
  return new Promise((resolve, reject) => {
    const records = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        const lat = parseFloat(row.latitude);
        const lon = parseFloat(row.longitude);
        const val = parseFloat(row.valeur_fonciere);
        if (!lat || !lon || !val) return;
        records.push({
          lat, lon,
          valeur:         val,
          surface:        parseFloat(row.surface_reelle_bati)  || null,
          surfaceTerrain: parseFloat(row.surface_terrain)      || null,
          type:           row.type_local      || null,
          date:           row.date_mutation   || '',
          pieces:         parseInt(row.nombre_pieces_principales) || null,
          parcelle:       row.id_parcelle     || null,
          section:        row.section_prefixe || null,
          commune:        row.nom_commune     || null,
          codeCommune:    row.code_commune    || null,
          codeDept:       row.code_departement|| null,
          adresse:        [row.adresse_numero, row.adresse_nom_voie].filter(Boolean).join(' '),
          codePostal:     row.code_postal     || null,
          natureCulture:  row.nature_culture  || null,
        });
      })
      .on('end', () => resolve(records))
      .on('error', reject);
  });
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
          + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function searchRadius(lat, lon, distKm) {
  const cellsNeeded = Math.ceil(distKm / (CELL_SIZE * 111)) + 1;
  const centerLatCell = Math.floor(lat / CELL_SIZE);
  const centerLonCell = Math.floor(lon / CELL_SIZE);
  const candidates = [];
  for (let dlat = -cellsNeeded; dlat <= cellsNeeded; dlat++) {
    for (let dlon = -cellsNeeded; dlon <= cellsNeeded; dlon++) {
      const key = `${centerLatCell + dlat}_${centerLonCell + dlon}`;
      if (spatialGrid[key]) candidates.push(...spatialGrid[key]);
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

app.get('/api/dvf', (req, res) => {
  const lat    = parseFloat(req.query.lat);
  const lon    = parseFloat(req.query.lon);
  const dist   = parseFloat(req.query.dist)   || 1;
  const months = parseInt(req.query.months)   || 24;
  if (!lat || !lon) return res.status(400).json({ error: 'lat/lon requis' });

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const t0 = Date.now();

  const nearby  = searchRadius(lat, lon, dist).filter(r => r.date >= cutoffStr);
  const apparts = nearby.filter(r => r.type === 'Appartement' && r.surface  > 5);
  const maisons = nearby.filter(r => r.type === 'Maison'      && r.surface  > 5);
  const terrains= nearby.filter(r => (!r.type || r.type === '') && r.surfaceTerrain > 0);

  const typologies = {};
  for (const r of apparts) {
    const t = r.pieces ? `T${Math.min(r.pieces, 5)}` : 'NC';
    if (!typologies[t]) typologies[t] = [];
    typologies[t].push(r.valeur / r.surface);
  }
  const typoStats = {};
  for (const [k, v] of Object.entries(typologies)) typoStats[k] = stats(v);

  const evolutionMap = {};
  for (const r of nearby) {
    if ((r.type === 'Appartement' || r.type === 'Maison') && r.surface > 5) {
      const key = r.date.slice(0, 7);
      if (!evolutionMap[key]) evolutionMap[key] = [];
      evolutionMap[key].push(r.valeur / r.surface);
    }
  }
  const evolution = Object.entries(evolutionMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-18)
    .map(([mois, prix]) => ({ mois, median: Math.round(percentile(prix, 50)), count: prix.length }));

  const transactions = nearby
    .filter(r => (r.type === 'Appartement' || r.type === 'Maison') && r.surface > 5)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 100)
    .map(r => ({ lat: r.lat, lon: r.lon, type: r.type,
      prix: Math.round(r.valeur / r.surface), valeur: r.valeur,
      surface: r.surface, pieces: r.pieces, date: r.date,
      adresse: r.adresse, commune: r.commune }));

  console.log(`[DVF] ${lat},${lon} dist=${dist}km months=${months} → ${nearby.length} en ${Date.now()-t0}ms`);
  res.json({
    zone: { lat, lon, dist, months }, total: nearby.length, tempsMs: Date.now()-t0,
    appartements: { stats: stats(apparts.map(r => r.valeur/r.surface)), typologies: typoStats },
    maisons:      { stats: stats(maisons.map(r => r.valeur/r.surface)) },
    terrains:     { stats: stats(terrains.map(r => r.valeur/r.surfaceTerrain)) },
    evolution, transactions,
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    transactions: dvfRecords.length,
    cellulesIndex: Object.keys(spatialGrid).length,
    memoireMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    ok: true,
  });
});

// ─── API : Génération PDF compte rendu ───────────────────────────────────────
app.post('/api/rapport', express.json({ limit: '2mb' }), (req, res) => {
  const { spawn } = require('child_process');
  const os = require('os');
  const tmpFile = require('path').join(os.tmpdir(), 'rapport_' + Date.now() + '.pdf');
  const payload = JSON.stringify(req.body);
  const scriptPath = require('path').join(__dirname, 'generer_rapport.py');

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

const DVF_PATH = process.env.DVF_PATH || path.join(__dirname, 'data', 'dvf.csv');
const PORT     = process.env.PORT     || 3000;

console.log('\n=============================================');
console.log('  ImmoAnalytics Pro — Démarrage');
console.log('=============================================');
console.log('📂 Données :', DVF_PATH);

loadDVF(DVF_PATH).then(records => {
  dvfRecords  = records;
  spatialGrid = buildSpatialIndex(records);
  const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  console.log(`✅ ${records.length.toLocaleString('fr-FR')} transactions chargées`);
  console.log(`🗂️  Index spatial : ${Object.keys(spatialGrid).length.toLocaleString('fr-FR')} cellules`);
  console.log(`💾 Mémoire : ~${memMB} Mo`);
  console.log(`🚀 Application → http://localhost:${PORT}`);
  console.log('=============================================\n');
  app.listen(PORT);
}).catch(err => {
  console.error('❌ Erreur chargement :', err.message);
  app.listen(PORT, () => console.log(`⚠️  Serveur sans données → http://localhost:${PORT}\n`));
});
