# ImmoAnalytics Pro 🏠

Outil d'analyse immobilière pour marchand de biens — MVP v1.0

## Démarrage rapide

### 1. Prérequis
- Node.js 18+ installé sur votre machine

### 2. Installation
```bash
# Décompressez l'archive, puis :
cd immopro
npm install
```

### 3. Ajout des données DVF
Placez votre fichier DVF CSV dans le dossier `data/` sous le nom `dvf.csv`.

**Télécharger les données DVF :**
- Site officiel : https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/
- Choisissez le fichier de votre département (ex: `45.csv` pour le Loiret)
- Renommez-le `dvf.csv` et placez-le dans `data/`

Pour charger un fichier DVF depuis un autre emplacement :
```bash
DVF_PATH=/chemin/vers/votre/fichier.csv npm start
```

### 4. Lancement
```bash
npm start
```

Ouvrez ensuite http://localhost:3000 dans votre navigateur.

## Fonctionnalités MVP (v1.0)
- 🔍 Recherche d'adresse avec autocomplétion (API BAN officielle)
- 💰 Prix au m² : appartements, maisons, terrains (médiane, moyenne, P10/P90)
- 📊 Typologies appartements (T1 à T5+)
- 📈 Évolution des prix sur 18 mois
- 🗺️ Carte interactive des transactions
- 🎯 Score d'opportunité du secteur
- 📋 Liens automatiques Géoportail, Cadastre, DVF Explorer
- 🎯 Géolocalisation automatique

## Filtres disponibles
- **Rayon** : 500m, 1km, 2km, 5km
- **Période** : 1 an, 2 ans, 5 ans

## Architecture
```
immopro/
├── server.js          # Backend Express (API DVF, proxy)
├── public/
│   └── index.html     # Frontend (tout-en-un)
├── data/
│   └── dvf.csv        # Vos données DVF (à placer ici)
└── package.json
```

## Roadmap — Phase 2
- [ ] Calculateur de rentabilité
- [ ] Export rapport PDF
- [ ] Portefeuille de biens
- [ ] Alertes de marché
- [ ] Comparaison multi-secteurs

---
*Données DVF : DGFiP — Licence Ouverte v2.0*
*Géocodage : Base Adresse Nationale (BAN) — data.gouv.fr*
