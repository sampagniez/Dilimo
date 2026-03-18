// generer_offre.js — Génère une offre d'achat Word (Dilimo)
// Usage : node generer_offre.js output.docx  (données JSON sur stdin)

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel,
  LevelFormat, Header, Footer, PageNumber, TabStopType, HorizontalPositionRelativeFrom
} = require('docx');
const fs   = require('fs');
const path = require('path');

// Read JSON from stdin
const outputPath = process.argv[2];
let rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { rawInput += chunk; });
process.stdin.on('end', () => { main(JSON.parse(rawInput)); });
function main(data) {

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt  = n => n ? parseInt(n).toLocaleString('fr-FR') + ' €' : '___________';
const fmtN = n => n ? parseInt(n).toLocaleString('fr-FR') : '___________';

function enLettres(n) {
  // Simple conversion nombre en lettres pour les montants courants
  const units = ['','un','deux','trois','quatre','cinq','six','sept','huit','neuf',
                 'dix','onze','douze','treize','quatorze','quinze','seize','dix-sept',
                 'dix-huit','dix-neuf'];
  const tens  = ['','','vingt','trente','quarante','cinquante','soixante',
                 'soixante','quatre-vingt','quatre-vingt'];
  if (!n || isNaN(n)) return '___________';
  n = parseInt(n);
  if (n === 0) return 'zéro';
  let result = '';
  if (n >= 1000000) {
    result += enLettres(Math.floor(n/1000000)) + ' million' + (Math.floor(n/1000000)>1?'s':'') + ' ';
    n %= 1000000;
  }
  if (n >= 1000) {
    const m = Math.floor(n/1000);
    result += (m === 1 ? '' : enLettres(m) + '-') + 'mille ';
    n %= 1000;
  }
  if (n >= 100) {
    const h = Math.floor(n/100);
    result += (h === 1 ? 'cent' : units[h] + '-cent') + (n%100===0&&h>1?'s':' ');
    n %= 100;
  }
  if (n > 0) {
    if (n < 20) result += units[n];
    else {
      const t = Math.floor(n/10), u = n%10;
      if (t === 7 || t === 9) result += tens[t] + '-' + units[10+(n%10)];
      else result += tens[t] + (u > 0 ? (u===1&&t!==8?'-et-'+units[u]:'-'+units[u]) : (t===8?'s':''));
    }
  }
  return result.trim().replace(/\s+/g,' ');
}

function dateValide(n) {
  // Calcule la date de validité (+n jours depuis aujourd'hui)
  const d = new Date();
  d.setDate(d.getDate() + (n || 8));
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function today() {
  return new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

// ─── Données ─────────────────────────────────────────────────────────────────
const acq     = data.acquereur  || {};
const bien    = data.bien       || {};
const vendeur = data.vendeur    || {};
const offre   = data.offre      || {};
const clauses = data.clauses    || {};
const notaire = data.notaire    || {};

const prixNum    = parseFloat(offre.prix) || 0;
const prixStr    = prixNum ? parseInt(prixNum).toLocaleString('fr-FR') + ' €' : '___________';
const prixLettres = enLettres(prixNum) + ' euros';
const validite   = parseInt(offre.validite) || 8;
const dateLimit  = dateValide(validite);

// ─── Styles de base ───────────────────────────────────────────────────────────
const GOLD  = 'C9A84C';
const DARK  = '1C2536';
const SLATE = '4A5568';
const MIST  = '8896A8';

const run = (text, opts = {}) => new TextRun({ text: String(text||''), font:'Arial', size:22, color:'1C2536', ...opts });
const bold = (text, opts = {}) => run(text, { bold:true, ...opts });
const muted= (text) => run(text, { color:MIST, size:20 });

function para(children, opts = {}) {
  if (typeof children === 'string') children = [run(children)];
  return new Paragraph({ spacing:{ before:80, after:80 }, children, ...opts });
}

function title(text) {
  return new Paragraph({
    spacing: { before:320, after:160 },
    border:  { bottom:{ style:BorderStyle.SINGLE, size:6, color:GOLD, space:4 } },
    children:[ new TextRun({ text, font:'Arial', size:26, bold:true, color:DARK }) ]
  });
}

function subtitle(text) {
  return new Paragraph({
    spacing: { before:200, after:80 },
    children:[ new TextRun({ text, font:'Arial', size:22, bold:true, color:'2E6DA4' }) ]
  });
}

function kvRow(label, value) {
  return new Paragraph({
    spacing: { before:60, after:60 },
    children: [
      new TextRun({ text: label + ' : ', font:'Arial', size:22, bold:true, color:SLATE }),
      new TextRun({ text: value || '___________', font:'Arial', size:22, color:DARK }),
    ]
  });
}

function spacer(n=1) {
  return Array.from({length:n}, () => new Paragraph({ spacing:{before:0,after:80}, children:[run('')] }));
}

function clauseBox(title, lines) {
  const rows = [
    new TableRow({ children:[ new TableCell({
      columnSpan:1,
      shading:{ fill:'EFF6FF', type:ShadingType.CLEAR },
      borders:{ top:{style:BorderStyle.SINGLE,size:4,color:'2563EB'}, bottom:{style:BorderStyle.SINGLE,size:1,color:'BFDBFE'}, left:{style:BorderStyle.SINGLE,size:8,color:'2563EB'}, right:{style:BorderStyle.SINGLE,size:1,color:'BFDBFE'} },
      margins:{ top:120,bottom:80,left:160,right:120 },
      children:[
        new Paragraph({ spacing:{before:0,after:60}, children:[ new TextRun({text:title,font:'Arial',size:22,bold:true,color:'1D4ED8'}) ] }),
        ...lines.map(l => new Paragraph({ spacing:{before:40,after:40}, children:[ new TextRun({text:l,font:'Arial',size:20,color:DARK}) ] }))
      ]
    }) ] })
  ];
  return new Table({ width:{size:9200,type:WidthType.DXA}, columnWidths:[9200], rows, margins:{top:80,bottom:80} });
}

function signatureBlock(label, name, lieu, date) {
  return [
    new Paragraph({ spacing:{before:80,after:40}, children:[bold(label)] }),
    new Paragraph({ spacing:{before:0,after:40}, children:[muted('(Précédé de la mention « Lu et approuvé »)')] }),
    new Paragraph({ spacing:{before:0,after:100}, children:[run(`Fait à ${lieu||'___________'}, le ${date||today()}`)] }),
    new Paragraph({ spacing:{before:0,after:40}, children:[bold(name||'___________')] }),
    new Paragraph({ spacing:{before:0,after:120}, children:[run('Signature :   _________________________________')] }),
  ];
}

// ─── Contenu du document ──────────────────────────────────────────────────────
const children = [];

// ── EN-TÊTE ──────────────────────────────────────────────────────────────────
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing:{ before:0, after:20 },
    children:[ new TextRun({text:'DILIMO', font:'Arial', size:20, bold:true, color:GOLD}) ]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing:{ before:0, after:40 },
    children:[ new TextRun({text:'Marchand de biens', font:'Arial', size:18, color:MIST}) ]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing:{ before:0, after:80 },
    border:{ bottom:{style:BorderStyle.SINGLE,size:3,color:GOLD,space:6} },
    children:[ run('') ]
  }),
  ...spacer(1),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing:{ before:80, after:40 },
    children:[ new TextRun({text:"OFFRE D'ACHAT DE BIEN(S) IMMOBILIER(S)", font:'Arial', size:32, bold:true, color:DARK}) ]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing:{ before:0, after:200 },
    children:[ new TextRun({text:`Réf. : ${offre.reference||today().replace(/\//g,'')}`, font:'Arial', size:20, color:MIST}) ]
  }),
);

// ── 1. ACQUÉREUR ─────────────────────────────────────────────────────────────
children.push(
  title('1. Identification de l\'acquéreur'),
  kvRow('Nom / Raison sociale', acq.nom),
  kvRow('Adresse', acq.adresse),
  kvRow('Téléphone', acq.telephone),
  kvRow('Email', acq.email),
  ...spacer(1),
);

// ── 2. BIEN ───────────────────────────────────────────────────────────────────
children.push(
  title('2. Désignation du bien'),
  kvRow('Type de bien', bien.type),
  kvRow('Adresse', bien.adresse),
  kvRow('Surface', bien.surface ? bien.surface + ' m²' : null),
  kvRow('État d\'occupation', bien.occupation || 'Libre'),
);
if (bien.descriptionComplementaire) {
  children.push(para(bien.descriptionComplementaire));
}
children.push(...spacer(1));

// ── 3. VENDEUR ────────────────────────────────────────────────────────────────
children.push(
  title('3. Identification du vendeur'),
  kvRow('Nom / Raison sociale', vendeur.nom),
  kvRow('Adresse', vendeur.adresse),
  kvRow('Qualité', vendeur.qualite || 'Propriétaire'),
  ...spacer(1),
);

// ── 4. PRIX ───────────────────────────────────────────────────────────────────
children.push(
  title('4. Prix proposé'),
  new Paragraph({
    spacing:{ before:80, after:80 },
    children:[
      bold('Prix d\'acquisition : '),
      new TextRun({ text: prixStr + ' net vendeur (en chiffres)', font:'Arial', size:22, color:DARK }),
    ]
  }),
  new Paragraph({
    spacing:{ before:60, after:80 },
    children:[
      bold('Soit en lettres : '),
      new TextRun({ text: prixLettres + '.', font:'Arial', size:22, color:DARK, italics:true }),
    ]
  }),
  ...spacer(1),
);

// ── 5. VALIDITÉ ───────────────────────────────────────────────────────────────
children.push(
  title('5. Validité de l\'offre'),
  new Paragraph({
    spacing:{ before:80, after:80 },
    children:[
      run(`La présente offre d'achat est ferme et définitive pour une durée de `),
      bold(`${validite} jours calendaires`),
      run(` à compter de sa réception par le vendeur, soit jusqu'au `),
      bold(dateLimit),
      run(' inclus.'),
    ]
  }),
  para('Passé ce délai, si aucune acceptation écrite n\'est parvenue à l\'acquéreur, la présente offre sera considérée comme caduque et sans effet.'),
  ...spacer(1),
);

// ── 6. CONDITIONS SUSPENSIVES ─────────────────────────────────────────────────
const hasAnyClauses = clauses.financement || clauses.precommercia || clauses.jouissance || clauses.urbanisme;

if (hasAnyClauses) {
  children.push(
    title('6. Conditions suspensives'),
    para('La présente offre est soumise à la réalisation des conditions suspensives suivantes :'),
    ...spacer(1),
  );

  if (clauses.financement) {
    children.push(
      clauseBox('Condition suspensive d\'obtention de financement (Art. L313-41 Code de la consommation)', [
        'L\'acquisition est subordonnée à l\'obtention d\'un prêt bancaire.',
        `Délai d'obtention : ${clauses.financement.delai || 45} jours calendaires à compter de la signature du compromis.`,
        clauses.financement.montant ? `Montant du prêt : ${parseInt(clauses.financement.montant).toLocaleString('fr-FR')} €.` : '',
        clauses.financement.taux ? `Taux maximum : ${clauses.financement.taux} %.` : '',
        'En cas de refus de prêt, l\'acquéreur sera libéré de son engagement sans pénalité et récupérera l\'intégralité du dépôt de garantie.',
      ].filter(Boolean)),
      ...spacer(1),
    );
  }

  if (clauses.precommercia) {
    const lotsMin = clauses.precommercia.lotsMin || '___';
    children.push(
      clauseBox('Clause de pré-commercialisation', [
        `L'acquisition est conditionnée à la pré-commercialisation d'un minimum de ${lotsMin} lot(s) du bien avant la signature de l'acte authentique.`,
        'Le VENDEUR autorise l\'ACQUÉREUR, dès l\'acceptation de la présente offre et jusqu\'à la signature de l\'acte authentique, à procéder à la pré-commercialisation du bien (publicité, diffusion d\'annonces, organisation de visites et recueil d\'intentions d\'achat).',
        'Toute vente ou avant-contrat éventuellement signé avec un tiers ne pourra produire effet qu\'après l\'acquisition définitive du bien par l\'ACQUÉREUR.',
      ]),
      ...spacer(1),
    );
  }

  if (clauses.jouissance) {
    children.push(
      clauseBox('Clause de jouissance anticipée', [
        'Le VENDEUR autorise l\'ACQUÉREUR à accéder au bien, à compter de la signature du compromis et jusqu\'à l\'acte authentique, uniquement pour la réalisation de devis et mesures préparatoires aux travaux.',
        clauses.jouissance.travaux
          ? 'Des travaux préparatoires pourront être réalisés sous réserve de l\'accord écrit du vendeur.'
          : 'Aucuns travaux ne seront réalisés avant l\'acte authentique.',
      ]),
      ...spacer(1),
    );
  }

  if (clauses.urbanisme) {
    children.push(
      clauseBox('Condition suspensive liée à l\'urbanisme', [
        'L\'absence de servitudes, hypothèques, ou charges non déclarées affectant le bien.',
        'L\'absence de projet d\'expropriation, de préemption ou de travaux d\'utilité publique.',
        'La conformité des surfaces déclarées (tolérance de -5%).',
        'L\'absence de modifications du Plan Local d\'Urbanisme (PLU) affectant le bien.',
        clauses.urbanisme.precisions ? clauses.urbanisme.precisions : '',
      ].filter(Boolean)),
      ...spacer(1),
    );
  }
}

// ── 7. CLAUSES RÉSOLUTOIRES ───────────────────────────────────────────────────
children.push(
  title('7. Clauses résolutoires'),
  subtitle('Clause de substitution'),
  para('L\'ACQUÉREUR se réserve la faculté de se substituer toute personne physique ou morale (SCI, SARL, SAS, etc.) jusqu\'à la signature de l\'acte authentique, sans que cette substitution ne puisse être refusée par le vendeur.'),
  ...spacer(1),
);

// ── 8. ENGAGEMENT ─────────────────────────────────────────────────────────────
children.push(
  title('8. Engagement des parties'),
  subtitle('Engagement de l\'acquéreur'),
  new Paragraph({
    spacing:{ before:80, after:80 },
    children:[ run(`Par la présente, nous, soussignés `), bold(acq.nom || '___________'), run(', nous nous engageons fermement et irrévocablement à acquérir le bien immobilier décrit ci-dessus aux conditions énoncées.') ]
  }),
  para('Nous déclarons :'),
  new Paragraph({ numbering:{ reference:'bullets', level:0 }, spacing:{before:60,after:60}, children:[run('Avoir visité le bien et en connaître parfaitement l\'état')] }),
  new Paragraph({ numbering:{ reference:'bullets', level:0 }, spacing:{before:60,after:60}, children:[run('Disposer des capacités financières nécessaires pour mener à bien cette acquisition')] }),
  new Paragraph({ numbering:{ reference:'bullets', level:0 }, spacing:{before:60,after:60}, children:[run('Accepter les conditions suspensives mentionnées')] }),
  ...spacer(1),
  subtitle('Acceptation du vendeur'),
  para('Le vendeur, par son acceptation écrite, s\'engage à vendre le bien aux conditions définies et à ne plus le proposer à la vente à compter de cette acceptation.'),
  ...spacer(1),
);

// ── 9. DOCUMENTS À FOURNIR ────────────────────────────────────────────────────
children.push(
  title('9. Documents à fournir par le vendeur'),
  para('Pour permettre la signature du compromis dans les meilleures conditions, l\'acquéreur sollicite la communication des documents suivants :'),
  new Paragraph({ numbering:{ reference:'numbers', level:0 }, spacing:{before:60,after:60}, children:[run('Titre de propriété (acte notarié)')] }),
  new Paragraph({ numbering:{ reference:'numbers', level:0 }, spacing:{before:60,after:60}, children:[run('Taxe foncière des 3 dernières années')] }),
  new Paragraph({ numbering:{ reference:'numbers', level:0 }, spacing:{before:60,after:60}, children:[run('Diagnostics techniques obligatoires (DPE, amiante, plomb, etc.)')] }),
  new Paragraph({ numbering:{ reference:'numbers', level:0 }, spacing:{before:60,after:60}, children:[run('Tout document relatif aux charges, copropriété ou servitudes')] }),
  ...spacer(1),
);

// ── 10. INTERVENANTS ──────────────────────────────────────────────────────────
children.push(
  title('10. Intervenants de la transaction'),
  kvRow('Notaire de l\'acquéreur', notaire.acquereur),
  kvRow('Notaire du vendeur', notaire.vendeur || '___________'),
  ...spacer(2),
);

// ── SIGNATURES ────────────────────────────────────────────────────────────────
children.push(
  title('Signatures'),
  new Paragraph({
    spacing:{ before:80, after:40 },
    border:{ top:{style:BorderStyle.NONE} },
  }),
);

// Bloc acquéreur et vendeur côte à côte
const sigTable = new Table({
  width:{ size:9200, type:WidthType.DXA },
  columnWidths:[4500, 4700],
  rows:[
    new TableRow({ children:[
      new TableCell({
        borders:{ top:BorderStyle.NONE, bottom:BorderStyle.NONE, left:BorderStyle.NONE, right:{style:BorderStyle.SINGLE,size:1,color:'E8EDF2'} },
        margins:{ top:0, bottom:0, left:0, right:200 },
        children:[
          new Paragraph({ spacing:{before:0,after:60}, children:[bold('LES ACQUÉREURS')] }),
          new Paragraph({ spacing:{before:0,after:60}, children:[muted('Lu et approuvé, bon pour offre d\'achat ferme et définitive')] }),
          new Paragraph({ spacing:{before:40,after:80}, children:[run(`Fait à ${acq.ville||'___________'}, le ${today()}`)] }),
          new Paragraph({ spacing:{before:0,after:40}, children:[bold(acq.nom||'___________')] }),
          new Paragraph({ spacing:{before:80,after:0}, children:[run('Signature : ___________________________')] }),
        ]
      }),
      new TableCell({
        borders:{ top:BorderStyle.NONE, bottom:BorderStyle.NONE, left:BorderStyle.NONE, right:BorderStyle.NONE },
        margins:{ top:0, bottom:0, left:200, right:0 },
        children:[
          new Paragraph({ spacing:{before:0,after:60}, children:[bold('LE VENDEUR')] }),
          new Paragraph({ spacing:{before:0,after:60}, children:[muted('Lu et approuvé, bon pour acceptation')] }),
          new Paragraph({ spacing:{before:40,after:80}, children:[run('Date d\'acceptation : ___________________')] }),
          new Paragraph({ spacing:{before:0,after:40}, children:[bold(vendeur.nom||'___________')] }),
          new Paragraph({ spacing:{before:80,after:0}, children:[run('Signature : ___________________________')] }),
        ]
      }),
    ]})
  ]
});
children.push(sigTable);

// ─── Assemblage final ─────────────────────────────────────────────────────────
const doc = new Document({
  numbering:{
    config:[
      { reference:'bullets', levels:[{ level:0, format:LevelFormat.BULLET, text:'•', alignment:AlignmentType.LEFT,
          style:{ paragraph:{ indent:{ left:720, hanging:360 }, spacing:{before:60,after:60} } } }] },
      { reference:'numbers', levels:[{ level:0, format:LevelFormat.DECIMAL, text:'%1.', alignment:AlignmentType.LEFT,
          style:{ paragraph:{ indent:{ left:720, hanging:360 }, spacing:{before:60,after:60} } } }] },
    ]
  },
  styles:{
    default:{ document:{ run:{ font:'Arial', size:22 } } }
  },
  sections:[{
    properties:{
      page:{
        size:{ width:11906, height:16838 },
        margin:{ top:1134, right:1134, bottom:1134, left:1134 }
      }
    },
    headers:{
      default: new Header({ children:[
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          border:{ bottom:{ style:BorderStyle.SINGLE, size:2, color:'E8EDF2', space:6 } },
          spacing:{ before:0, after:80 },
          children:[
            new TextRun({ text:'Dilimo — Offre d\'achat — ', font:'Arial', size:18, color:MIST }),
            new TextRun({ text: bien.adresse||'', font:'Arial', size:18, color:'4A5568' }),
          ]
        })
      ]})
    },
    footers:{
      default: new Footer({ children:[
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border:{ top:{ style:BorderStyle.SINGLE, size:2, color:'E8EDF2', space:6 } },
          spacing:{ before:80, after:0 },
          children:[
            new TextRun({ text:'Document confidentiel — Dilimo Marchand de Biens — Page ', font:'Arial', size:16, color:MIST }),
            new TextRun({ children:[PageNumber.CURRENT], font:'Arial', size:16, color:MIST }),
            new TextRun({ text:' / ', font:'Arial', size:16, color:MIST }),
            new TextRun({ children:[PageNumber.TOTAL_PAGES], font:'Arial', size:16, color:MIST }),
          ]
        })
      ]})
    },
    children,
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outputPath, buf);
  process.stdout.write('OK\n');
}).catch(err => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});
} // end main
