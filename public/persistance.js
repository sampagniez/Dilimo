// persistance.js — Script de sauvegarde globale pour Dilimo
// Enregistre automatiquement la valeur de tous les champs (input, select, textarea) qui ont un ID.
// Restaure ces valeurs au chargement pour que les données persistent d'un onglet à l'autre.

document.addEventListener('DOMContentLoaded', () => {
  // 1. Restauration de l'état
  try {
    const raw = localStorage.getItem('immopro_global_state');
    if (raw) {
      const state = JSON.parse(raw);
      
      // On parcourt tout l'état sauvegardé
      Object.keys(state).forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = state[id];
          } else {
            el.value = state[id];
          }
          // On déclenche un événement change pour que les scripts existants (calculer() etc) se mettent à jour
          // On évite de le faire trop bruyamment si pas nécessaire, mais dispatchEvent est utile.
        }
      });

      // Une fois toutes les valeurs restaurées, on déclenche les fonctions de calcul si elles existent (pour les autres écrans)
      if (typeof calculer === 'function') setTimeout(calculer, 100);
      if (typeof preview === 'function') setTimeout(preview, 100);
      if (typeof updateChecklist === 'function') setTimeout(updateChecklist, 100);
      if (typeof updatePrixLettres === 'function') setTimeout(updatePrixLettres, 100);
    }
  } catch(e) {
    console.error('Erreur lors de la restauration de l\'état global', e);
  }
});

// 2. Sauvegarde de l'état
// On écoute input et change sur tout le document
function saveGlobalState(el) {
  if (!el.id) return; // on a besoin d'un id pour sauvegarder
  
  try {
    const raw = localStorage.getItem('immopro_global_state');
    const state = raw ? JSON.parse(raw) : {};
    
    if (el.type === 'checkbox' || el.type === 'radio') {
      state[el.id] = el.checked;
    } else {
      state[el.id] = el.value;
    }
    
    localStorage.setItem('immopro_global_state', JSON.stringify(state));
  } catch(e) {
    console.error('Erreur lors de la sauvegarde de l\'état global', e);
  }
}

document.addEventListener('input', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    saveGlobalState(e.target);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    saveGlobalState(e.target);
  }
});

// 3. Bouton Nouvelle Opération
window.nouvelleOperation = function() {
  if (confirm("Voulez-vous vraiment commencer une nouvelle opération ? Toutes les données non sauvegardées ou non exportées seront perdues.")) {
    // Vider le state global
    localStorage.removeItem('immopro_global_state');
    
    // Vider les states spécifiques des autres pages au cas où
    localStorage.removeItem('immopro_dvf_last');
    localStorage.removeItem('immopro_calc_last');
    localStorage.removeItem('dilimo_visite_form');
    localStorage.removeItem('dilimo_offre_form');
    
    // Rediriger vers l'accueil (SCAN) pour une page vierge
    window.location.href = '/';
  }
};
