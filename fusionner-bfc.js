// ============================================================
//  ImmoAnalytics Pro — Fusion DVF Bourgogne-Franche-Comté
//
//  Utilisation :
//    1. Placez vos fichiers CSV dans  data/brut/
//       (dvf-3.csv, dvf-4.csv ... peu importe le nom)
//    2. node fusionner-bfc.js
//    3. npm start
//
//  Le script filtre automatiquement les 8 depts BFC :
//  21 · 25 · 39 · 58 · 70 · 71 · 89 · 90
// ============================================================

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const DOSSIER_BRUT = path.join(__dirname, 'data', 'brut');
const FICHIER_OUT  = path.join(__dirname, 'data', 'dvf.csv');

const DEPTS_BFC = new Set(['21','25','39','58','70','71','89','90']);

const COLONNES_UTILES = new Set([
  'id_mutation','date_mutation','nature_mutation','valeur_fonciere',
  'adresse_numero','adresse_nom_voie','code_postal',
  'code_commune','nom_commune','code_departement',
  'id_parcelle','type_local','surface_reelle_bati',
  'nombre_pieces_principales','nature_culture',
  'surface_terrain','longitude','latitude','section_prefixe'
]);

// ─── Parser CSV (gère les guillemets) ─────────────────────────────────────────
function parseCsvLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Traitement d'un fichier CSV ──────────────────────────────────────────────
function traiterFichier(cheminFichier, out, colonnesRef, doublons) {
  return new Promise((resolve, reject) => {

    const rl = readline.createInterface({
      input: fs.createReadStream(cheminFichier, { encoding: 'utf8' }),
      crlfDelay: Infinity
    });

    let isFirstLine        = true;
    let colonnesSource     = [];
    let colonnesIndexLocal = [];
    let deptIdxLocal       = -1;
    let lignesFichier      = 0;
    let lignesBFC          = 0;
    let lignesValides      = 0;

    rl.on('line', (ligne) => {
      if (!ligne.trim()) return;

      // ── En-tête ────────────────────────────────────────────────────────────
      if (isFirstLine) {
        isFirstLine    = false;
        colonnesSource = parseCsvLine(ligne);
        deptIdxLocal   = colonnesSource.indexOf('code_departement');

        if (deptIdxLocal === -1) {
          console.log('   ⚠️  Colonne code_departement absente — fichier ignoré');
          rl.close();
          return;
        }

        if (colonnesRef.length === 0) {
          // Premier fichier : on définit les colonnes de référence
          const cols = colonnesSource
            .map((col, idx) => ({ col, idx }))
            .filter(({ col }) => COLONNES_UTILES.has(col));
          cols.forEach(c => colonnesRef.push(c));
          out.write(colonnesRef.map(c => c.col).join(',') + '\n');
        }

        // Aligner les index sur la référence (l'ordre peut varier entre fichiers)
        colonnesIndexLocal = colonnesRef.map(({ col }) => ({
          col,
          idx: colonnesSource.indexOf(col)
        }));
        return;
      }

      // ── Ligne de données ───────────────────────────────────────────────────
      lignesFichier++;
      if (lignesFichier % 100000 === 0) {
        process.stdout.write(`   ... ${(lignesFichier/1000).toFixed(0)}k lignes lues, ${lignesValides} conservées\r`);
      }

      const vals = parseCsvLine(ligne);
      if (vals.length < 5) return;

      // Filtre département BFC
      const dept = (vals[deptIdxLocal] || '').replace(/"/g, '').trim();
      if (!DEPTS_BFC.has(dept)) return;
      lignesBFC++;

      // Extraire les colonnes utiles
      const row = colonnesIndexLocal.map(({ idx }) => {
        if (idx === -1) return '';
        const v = (vals[idx] || '').replace(/^"|"$/g, '');
        return v.includes(',') ? `"${v}"` : v;
      });

      // Filtres qualité : coordonnées + valeur obligatoires
      const latIdx = colonnesRef.findIndex(c => c.col === 'latitude');
      const lonIdx = colonnesRef.findIndex(c => c.col === 'longitude');
      const valIdx = colonnesRef.findIndex(c => c.col === 'valeur_fonciere');

      const lat = parseFloat(row[latIdx]);
      const lon = parseFloat(row[lonIdx]);
      const val = parseFloat(row[valIdx]);

      if (!lat || !lon || !val || val < 1000) return;

      // Dédoublonnage (même mutation + même type + même surface)
      const idIdx   = colonnesRef.findIndex(c => c.col === 'id_mutation');
      const typeIdx = colonnesRef.findIndex(c => c.col === 'type_local');
      const surfIdx = colonnesRef.findIndex(c => c.col === 'surface_reelle_bati');
      const key = `${row[idIdx]}_${row[typeIdx]}_${row[surfIdx]}`;
      if (doublons.has(key)) return;
      doublons.add(key);

      out.write(row.join(',') + '\n');
      lignesValides++;
    });

    rl.on('close', () => resolve({ lignesFichier, lignesBFC, lignesValides }));
    rl.on('error', reject);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function fusionner() {
  console.log('\n=============================================');
  console.log('  ImmoAnalytics Pro — Fusion DVF BFC');
  console.log('=============================================\n');

  if (!fs.existsSync(DOSSIER_BRUT)) {
    console.error('❌  Dossier data/brut/ introuvable.');
    console.error('    Créez-le et placez vos fichiers CSV à l\'intérieur.');
    process.exit(1);
  }

  const fichiers = fs.readdirSync(DOSSIER_BRUT)
    .filter(f => f.toLowerCase().endsWith('.csv'))
    .sort();

  if (!fichiers.length) {
    console.error('❌  Aucun fichier .csv trouvé dans data/brut/');
    process.exit(1);
  }

  console.log(`📂  ${fichiers.length} fichier(s) détecté(s) :`);
  fichiers.forEach(f => {
    const mo = (fs.statSync(path.join(DOSSIER_BRUT, f)).size / 1024 / 1024).toFixed(0);
    console.log(`    - ${f}  (${mo} Mo)`);
  });

  console.log(`\n🔍  Filtre : depts BFC uniquement (21·25·39·58·70·71·89·90)\n`);

  if (fs.existsSync(FICHIER_OUT)) fs.unlinkSync(FICHIER_OUT);

  const out         = fs.createWriteStream(FICHIER_OUT, { encoding: 'utf8' });
  const colonnesRef = [];   // partagé entre tous les fichiers
  const doublons    = new Set();

  let totalLignes  = 0;
  let totalBFC     = 0;
  let totalValides = 0;

  for (const fichier of fichiers) {
    console.log(`⏳  ${fichier}...`);
    const chemin = path.join(DOSSIER_BRUT, fichier);

    const { lignesFichier, lignesBFC, lignesValides } =
      await traiterFichier(chemin, out, colonnesRef, doublons);

    console.log(`    ✅ ${lignesFichier.toLocaleString('fr-FR')} lignes lues → ${lignesValides.toLocaleString('fr-FR')} transactions BFC conservées`);
    totalLignes  += lignesFichier;
    totalBFC     += lignesBFC;
    totalValides += lignesValides;
  }

  out.end();
  await new Promise(resolve => out.on('finish', resolve));

  const tailleMo = (fs.statSync(FICHIER_OUT).size / 1024 / 1024).toFixed(1);

  console.log('\n=============================================');
  console.log('✅  Fusion terminée !');
  console.log(`    Lignes lues      : ${totalLignes.toLocaleString('fr-FR')}`);
  console.log(`    Lignes BFC       : ${totalBFC.toLocaleString('fr-FR')}`);
  console.log(`    Transactions nettes : ${totalValides.toLocaleString('fr-FR')}`);
  console.log(`    Fichier produit  : data/dvf.csv  (${tailleMo} Mo)`);
  console.log('=============================================\n');
  console.log('Étape suivante → npm start\n');
}

fusionner().catch(err => {
  console.error('\n❌  Erreur :', err.message);
  process.exit(1);
});
