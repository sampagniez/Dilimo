# ============================================================
#  ImmoAnalytics Pro — Téléchargement DVF Bourgogne-Franche-Comté
#  Départements : 21, 25, 39, 58, 70, 71, 89, 90
#  Années       : 2020 à 2024
# ============================================================

$depts = @(
    @{ code = "21"; nom = "Côte-d'Or" },
    @{ code = "25"; nom = "Doubs" },
    @{ code = "39"; nom = "Jura" },
    @{ code = "58"; nom = "Nièvre" },
    @{ code = "70"; nom = "Haute-Saône" },
    @{ code = "71"; nom = "Saône-et-Loire" },
    @{ code = "89"; nom = "Yonne" },
    @{ code = "90"; nom = "Territoire de Belfort" }
)

$annees = @("2020", "2021", "2022", "2023", "2024")

$dossierData = "$PSScriptRoot\data\brut"
New-Item -ItemType Directory -Force -Path $dossierData | Out-Null

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  ImmoAnalytics Pro — Téléchargement DVF BFC" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "8 départements x 5 années = jusqu'à 40 fichiers" -ForegroundColor Yellow
Write-Host "Dossier de destination : $dossierData" -ForegroundColor Yellow
Write-Host ""

$total = 0
$erreurs = 0

foreach ($dept in $depts) {
    Write-Host "━━━ $($dept.nom) (Dept. $($dept.code)) ━━━" -ForegroundColor Magenta

    foreach ($annee in $annees) {
        $url      = "https://files.data.gouv.fr/geo-dvf/latest/csv/$annee/departements/$($dept.code).csv"
        $fichier  = "$dossierData\dvf_$($dept.code)_$annee.csv"

        if (Test-Path $fichier) {
            $taille = [math]::Round((Get-Item $fichier).Length / 1MB, 1)
            Write-Host "  ✓ $annee — déjà téléchargé ($taille Mo)" -ForegroundColor Green
            $total++
            continue
        }

        Write-Host "  ⬇  $annee — téléchargement..." -ForegroundColor Gray -NoNewline

        try {
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -Uri $url -OutFile $fichier -UseBasicParsing -TimeoutSec 120
            $taille = [math]::Round((Get-Item $fichier).Length / 1MB, 1)
            Write-Host " ✓ $taille Mo" -ForegroundColor Green
            $total++
        }
        catch {
            Write-Host " ✗ Échec (fichier peut-être indisponible pour cette année)" -ForegroundColor Red
            $erreurs++
            if (Test-Path $fichier) { Remove-Item $fichier }
        }
    }
    Write-Host ""
}

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  $total fichiers téléchargés, $erreurs erreurs" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Étape suivante : lancez  node fusionner-bfc.js" -ForegroundColor Yellow
Write-Host ""
