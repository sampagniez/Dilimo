#!/bin/bash
# ============================================================
#  ImmoAnalytics Pro — Téléchargement DVF Bourgogne-Franche-Comté
#  Départements : 21, 25, 39, 58, 70, 71, 89, 90
#  Années       : 2020 à 2025
# ============================================================

DEPTS=("21" "25" "39" "58" "70" "71" "89" "90")
ANNEES=("2020" "2021" "2022" "2023" "2024" "2025")

DOSSIER_DATA="./data/brut"
mkdir -p "$DOSSIER_DATA"

echo "============================================="
echo "  ImmoAnalytics Pro — Téléchargement DVF BFC"
echo "============================================="
echo "8 départements x 6 années = jusqu'à 48 fichiers"
echo "Dossier de destination : $DOSSIER_DATA"
echo ""

TOTAL=0
ERREURS=0

for dept in "${DEPTS[@]}"; do
    echo "━━━ Dept. $dept ━━━"
    for annee in "${ANNEES[@]}"; do
        url="https://files.data.gouv.fr/geo-dvf/latest/csv/$annee/departements/${dept}.csv.gz"
        fichier_csv="$DOSSIER_DATA/dvf_${dept}_${annee}.csv"
        fichier_gz="${fichier_csv}.gz"

        if [ -f "$fichier_csv" ]; then
            echo "  ✓ $annee — déjà téléchargé"
            ((TOTAL++))
            continue
        fi

        echo -n "  ⬇  $annee — téléchargement... "
        
        # Download with curl
        if curl -s -f -o "$fichier_gz" "$url"; then
            gunzip -f "$fichier_gz"
            echo "✓ OK"
            ((TOTAL++))
        else
            echo "✗ Échec (fichier peut-être indisponible)"
            ((ERREURS++))
            rm -f "$fichier_gz" "$fichier_csv"
        fi
    done
    echo ""
done

echo "============================================="
echo "  $TOTAL fichiers téléchargés/présents, $ERREURS erreurs"
echo "============================================="
echo ""
echo "Étape suivante : lancez  node fusionner-bfc.js"
echo ""
