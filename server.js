const http = require('http');
const https = require('https');
const { URL } = require('url');
const PORT = process.env.PORT || 3000;

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 DPE-App/1.0', 'Accept': 'application/json', 'Referer': 'https://data.ademe.fr/' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}
function sendJSON(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}
function sendHTML(res, html) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
function sendError(res, msg) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: msg })); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const path = u.pathname;

  if (path === '/' || path === '/index.html') { sendHTML(res, HTML_SEARCH); return; }
  if (path === '/extract') { sendHTML(res, HTML_EXTRACT); return; }

  if (path === '/ban') {
    const q = u.searchParams.get('q') || '';
    try { const r = await fetchUrl('https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(q) + '&limit=6'); sendJSON(res, r.body); }
    catch (e) { sendError(res, e.message); }
    return;
  }

  // Recherche DPE unique par adresse (dataset nouveau dpe03existant)
  if (path === '/dpe') {
    const q = u.searchParams.get('q') || '';
    const fields = 'numero_dpe,date_etablissement_dpe,etiquette_dpe,etiquette_ges,conso_5_usages_e_finale,emission_ges_5_usages,surface_habitable_logement,annee_construction,type_batiment,type_installation_chauffage,type_energie_principale_chauffage,type_installation_ecs,type_energie_principale_ecs,type_ventilation,nombre_niveau_logement,adresse_ban';
    try {
      const r = await fetchUrl('https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?q=' + encodeURIComponent(q) + '&q_fields=adresse_ban&page=1&size=8&sort=-date_etablissement_dpe&select=' + fields);
      if (r.status === 200) {
        try {
          const d = JSON.parse(r.body);
          if (d.results) d.results = d.results.map(row => ({ ...row, consommation_energie: row.conso_5_usages_e_finale, emission_ges: row.emission_ges_5_usages }));
          sendJSON(res, d);
        } catch { sendJSON(res, r.body); }
      } else { sendJSON(res, JSON.stringify({ results: [], _debug: r.body.substring(0, 300) })); }
    } catch (e) { sendError(res, e.message); }
    return;
  }

  // ── EXTRACTION passoires par bbox + classes (dataset ancien avec geo_adresse) ──
  if (path === '/api/extract') {
    const bbox    = u.searchParams.get('bbox') || '';
    const classes = u.searchParams.get('classes') || 'E,F,G';
    const page    = parseInt(u.searchParams.get('page') || '1');
    const fmt     = u.searchParams.get('format') || 'json';

    if (!bbox) { sendError(res, 'bbox requis (lonMin,latMin,lonMax,latMax)'); return; }

    const classFilter = classes.split(',').map(c => 'classe_consommation_energie_in=' + encodeURIComponent(c.trim())).join('&');
    // On utilise le dataset "avant juillet 2021" (dpe-france) qui a geo_adresse + bbox fonctionnel
    // ET le dataset dpe03existant pour les DPE récents
    // On essaie les deux et on fusionne

    const select = 'geo_adresse,classe_consommation_energie,classe_estimation_ges,consommation_energie,estimation_ges,annee_construction,latitude,longitude,date_etablissement_dpe,numero_dpe,tr002_type_batiment_description';

    const apiUrl =
      'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?' +
      'bbox=' + encodeURIComponent(bbox) +
      '&etiquette_dpe_in=' + encodeURIComponent(classes) +
      '&page=' + page + '&size=500' +
      '&sort=-date_etablissement_dpe' +
      '&select=adresse_ban,etiquette_dpe,etiquette_ges,conso_5_usages_e_finale,emission_ges_5_usages,annee_construction,longitude_ban,latitude_ban,date_etablissement_dpe,numero_dpe,type_batiment';

    try {
      let r = await fetchUrl(apiUrl);

      // fallback sur ancien dataset si besoin
      if (r.status !== 200) {
        const apiUrl2 = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe-france/lines?' +
          'bbox=' + encodeURIComponent(bbox) +
          '&classe_consommation_energie_in=' + encodeURIComponent(classes) +
          '&page=' + page + '&size=500' +
          '&sort=-date_etablissement_dpe' +
          '&select=' + select;
        r = await fetchUrl(apiUrl2);
      }

      if (r.status === 200) {
        if (fmt === 'csv') {
          try {
            const d = JSON.parse(r.body);
            const rows = d.results || [];
            if (!rows.length) { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="passoires_thermiques.csv"' }); res.end('Aucun résultat'); return; }
            const keys = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
            const csv = [keys.join(';'), ...rows.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(';'))].join('\n');
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="passoires_thermiques.csv"', 'Access-Control-Allow-Origin': '*' });
            res.end('\uFEFF' + csv); // BOM UTF-8 pour Excel
          } catch(e) { sendError(res, e.message); }
        } else {
          sendJSON(res, r.body);
        }
      } else {
        sendJSON(res, JSON.stringify({ results: [], total: 0, _debug: 'HTTP ' + r.status + ': ' + r.body.substring(0, 200) }));
      }
    } catch (e) { sendError(res, e.message); }
    return;
  }

  if (path === '/health') { res.writeHead(200); res.end('OK'); return; }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log('Serveur DPE démarré sur le port ' + PORT));

// ════════════════════════════════════════════════════════════════════
// PAGE 1 — RECHERCHE PAR ADRESSE
// ════════════════════════════════════════════════════════════════════
const HTML_SEARCH = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Recherche DPE</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#f4f5f7;color:#1a1a2e;min-height:100vh;padding:2rem 1rem}
    .container{max-width:900px;margin:0 auto}
    header{text-align:center;margin-bottom:1.5rem}
    header h1{font-size:1.9rem;font-weight:700;letter-spacing:-0.02em}
    header p{color:#666;margin-top:.4rem;font-size:.95rem}
    .nav{display:flex;justify-content:center;gap:10px;margin-bottom:1.5rem}
    .nav a{padding:.6rem 1.4rem;border-radius:10px;font-size:.9rem;font-weight:600;text-decoration:none;background:white;color:#4361ee;border:1.5px solid #4361ee;transition:all .2s}
    .nav a.active,.nav a:hover{background:#4361ee;color:white}
    .search-card{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.5rem;position:relative}
    .search-row{display:flex;gap:10px}
    #addr-input{flex:1;padding:.75rem 1rem;border:1.5px solid #e0e0e0;border-radius:10px;font-size:1rem;outline:none;background:#fafafa;transition:border-color .2s}
    #addr-input:focus{border-color:#4361ee;background:white}
    #search-btn{padding:.75rem 1.4rem;background:#4361ee;color:white;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer}
    #search-btn:hover{background:#3451d1}
    #search-btn:disabled{background:#aab4e8;cursor:not-allowed}
    #suggestions{position:absolute;left:1.5rem;right:1.5rem;top:calc(100% - .5rem);background:white;border:1.5px solid #e0e0e0;border-radius:10px;z-index:100;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
    .sug-item{padding:11px 16px;font-size:.9rem;cursor:pointer;border-bottom:1px solid #f0f0f0}
    .sug-item:hover{background:#f0f4ff;color:#4361ee}
    #status{margin-top:1rem;padding:.75rem 1rem;border-radius:10px;font-size:.9rem;display:none}
    .status-loading{background:#f0f4ff;color:#4361ee;display:flex!important;align-items:center;gap:8px}
    .status-error{background:#fff0f0;color:#c0392b;display:block!important}
    .spinner{width:16px;height:16px;border:2px solid #b8c6ff;border-top-color:#4361ee;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    #multi-area{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.5rem;display:none}
    #multi-area h3{font-size:1rem;color:#555;margin-bottom:1rem;font-weight:500}
    .multi-item{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid #e8e8e8;border-radius:10px;cursor:pointer;margin-bottom:8px}
    .multi-item:hover{border-color:#4361ee;background:#f0f4ff}
    #result-area{display:none}
    .result-header{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.2rem;display:flex;align-items:center;gap:16px}
    .dpe-big-badge{width:64px;height:64px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;flex-shrink:0}
    .dpe-A{background:#b7e4c7;color:#1b4332}.dpe-B{background:#d8f3dc;color:#1b4332}.dpe-C{background:#d9ed92;color:#386641}.dpe-D{background:#fff3b0;color:#7b5e00}.dpe-E{background:#ffd6a5;color:#7a3500}.dpe-F{background:#ffb3b3;color:#7a0000}.dpe-G{background:#ff6b6b;color:#4a0000}.dpe-N{background:#e8e8e8;color:#666}
    .result-header-info h2{font-size:1.1rem;font-weight:600;margin-bottom:4px}
    .result-header-info p{font-size:.85rem;color:#888}
    .section-title{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:.75rem}
    .cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:1.2rem}
    .info-card{background:white;border-radius:12px;padding:1rem 1.1rem;box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .info-card .lbl{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#aaa;margin-bottom:6px}
    .info-card .val{font-size:1.05rem;font-weight:700;color:#1a1a2e;line-height:1.3}
    .equip-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:1.2rem}
    .equip-card{background:white;border-radius:12px;padding:1rem 1.1rem;box-shadow:0 2px 8px rgba(0,0,0,.06);border-left:4px solid #4361ee}
    .equip-card .lbl{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#aaa;margin-bottom:6px}
    .equip-card .val{font-size:.92rem;font-weight:600;color:#1a1a2e;line-height:1.4}
    .dpe-scale{display:flex;gap:4px;margin-top:8px}
    .dpe-scale-item{flex:1;height:6px;border-radius:3px;opacity:.25}
    .dpe-scale-item.active{opacity:1}
    .no-dpe{background:white;border-radius:16px;padding:2rem;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.07);display:none}
    .no-dpe p{color:#666;font-size:.95rem;line-height:1.8}
    .source-note{text-align:center;font-size:.78rem;color:#bbb;margin-top:1.5rem;padding-top:1rem;border-top:1px solid #eee}
  </style>
</head>
<body>
<div class="container">
  <header><h1>🏠 Outil DPE ADEME</h1><p>Données officielles ADEME — chauffage, énergie, isolation, classe énergétique</p></header>
  <div class="nav">
    <a href="/" class="active">🔍 Recherche adresse</a>
    <a href="/extract">🗺️ Extraction passoires E/F/G</a>
  </div>
  <div class="search-card">
    <div class="search-row">
      <input type="text" id="addr-input" placeholder="Ex: 67 Residence les Hameaux de Biver 13120 Gardanne" autocomplete="off"/>
      <button id="search-btn" onclick="doSearch()">Rechercher</button>
    </div>
    <div id="suggestions"></div>
    <div id="status"></div>
  </div>
  <div id="multi-area"><h3>Plusieurs DPE trouvés — choisissez :</h3><div id="multi-list"></div></div>
  <div class="no-dpe" id="no-dpe"><p>❌ Aucun DPE trouvé pour cette adresse.</p></div>
  <div id="result-area">
    <div class="result-header">
      <div id="dpe-badge" class="dpe-big-badge dpe-N">?</div>
      <div class="result-header-info"><h2 id="addr-display"></h2><p id="dpe-meta"></p><div class="dpe-scale" id="dpe-scale"></div></div>
    </div>
    <p class="section-title">⚡ Performance</p><div class="cards-grid" id="perf-grid"></div>
    <p class="section-title">🔧 Équipements</p><div class="equip-grid" id="equip-grid"></div>
    <p class="section-title">🏗️ Logement</p><div class="cards-grid" id="logement-grid"></div>
    <div class="source-note">Données ADEME · Licence Ouverte Etalab</div>
  </div>
</div>
<script>
  const C={A:'#b7e4c7',B:'#d8f3dc',C:'#d9ed92',D:'#fff3b0',E:'#ffd6a5',F:'#ffb3b3',G:'#ff6b6b'};
  let dbc;const inp=document.getElementById('addr-input'),sug=document.getElementById('suggestions');
  inp.addEventListener('input',()=>{clearTimeout(dbc);const q=inp.value.trim();if(q.length<4){sug.style.display='none';return;}dbc=setTimeout(()=>fSug(q),280);});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();if(e.key==='Escape')sug.style.display='none';});
  document.addEventListener('click',e=>{if(!e.target.closest('.search-card'))sug.style.display='none';});
  async function fSug(q){try{const r=await fetch('/ban?q='+encodeURIComponent(q));const d=await r.json();if(!d.features?.length){sug.style.display='none';return;}sug.innerHTML=d.features.map(f=>'<div class="sug-item" onclick="pick(\''+f.properties.label.replace(/'/g,"\\'")+'\')">' +f.properties.label+'</div>').join('');sug.style.display='block';}catch{sug.style.display='none';}}
  function pick(l){inp.value=l;sug.style.display='none';doSearch();}
  function setS(m,t){const el=document.getElementById('status');if(!m){el.style.display='none';return;}el.innerHTML=t==='loading'?'<span class="spinner"></span>'+m:m;el.className='status-'+t;el.style.display=t==='loading'?'flex':'block';}
  function hideAll(){['result-area','multi-area','no-dpe'].forEach(id=>document.getElementById(id).style.display='none');setS('','');}
  async function doSearch(){const addr=inp.value.trim();if(!addr)return;sug.style.display='none';hideAll();document.getElementById('search-btn').disabled=true;setS('Interrogation ADEME...','loading');try{const resp=await fetch('/dpe?q='+encodeURIComponent(addr));const data=await resp.json();setS('','');document.getElementById('search-btn').disabled=false;if(data.error)throw new Error(data.error);if(!data.results?.length){document.getElementById('no-dpe').style.display='block';return;}data.results.length===1?render(data.results[0]):showMulti(data.results);}catch(err){setS('Erreur : '+err.message,'error');document.getElementById('search-btn').disabled=false;}}
  function showMulti(R){window._r=R;document.getElementById('multi-list').innerHTML=R.map((r,i)=>{const cl=r.etiquette_dpe||'N';const dt=(r.date_etablissement_dpe||'').substring(0,10);const sf=r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+'m²':'';return '<div class="multi-item" onclick="render(window._r['+i+'])"><span class="dpe-big-badge dpe-'+cl+'" style="width:40px;height:40px;font-size:1.2rem;">'+cl+'</span><div><div style="font-weight:600;font-size:.9rem;">'+(r.adresse_ban||'')+'</div><div style="font-size:.8rem;color:#888;">'+(dt?'DPE du '+dt:'')+(sf?' · '+sf:'')+'</div></div></div>';}).join('');document.getElementById('multi-area').style.display='block';}
  function render(r){
    document.getElementById('multi-area').style.display='none';
    const cl=r.etiquette_dpe||'N';
    const b=document.getElementById('dpe-badge');b.textContent=cl==='N'?'?':cl;b.className='dpe-big-badge dpe-'+cl;
    document.getElementById('addr-display').textContent=r.adresse_ban||inp.value;
    const dt=(r.date_etablissement_dpe||'').substring(0,10);
    document.getElementById('dpe-meta').textContent=(dt?'DPE établi le '+dt:'')+(r.numero_dpe?' · N°'+r.numero_dpe:'');
    document.getElementById('dpe-scale').innerHTML=['A','B','C','D','E','F','G'].map(c=>'<div class="dpe-scale-item '+(c===cl?'active':'')+'" style="background:'+(C[c]||'#ccc')+'"></div>').join('');
    const conso=r.consommation_energie||r.conso_5_usages_e_finale;
    const ges=r.emission_ges||r.emission_ges_5_usages;
    document.getElementById('perf-grid').innerHTML=[{l:'Classe énergie',v:cl!=='N'?cl:'N/A'},{l:'Classe GES',v:r.etiquette_ges||'N/A'},{l:'Consommation',v:conso?Math.round(conso)+' kWh/m²/an':'N/A'},{l:'Émissions CO₂',v:ges?Math.round(ges)+' kg/m²/an':'N/A'}].map(c=>'<div class="info-card"><div class="lbl">'+c.l+'</div><div class="val">'+c.v+'</div></div>').join('');
    document.getElementById('equip-grid').innerHTML=[{l:'Chauffage',v:r.type_installation_chauffage||'N/A'},{l:'Énergie chauffage',v:r.type_energie_principale_chauffage||'N/A'},{l:'Eau chaude (ECS)',v:r.type_installation_ecs||'N/A'},{l:'Énergie ECS',v:r.type_energie_principale_ecs||'N/A'},{l:'Ventilation',v:r.type_ventilation||'N/A'}].map(e=>'<div class="equip-card"><div class="lbl">'+e.l+'</div><div class="val">'+e.v+'</div></div>').join('');
    document.getElementById('logement-grid').innerHTML=[{l:'Surface',v:r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+' m²':'N/A'},{l:'Année construction',v:r.annee_construction||'N/A'},{l:'Type',v:r.type_batiment||'N/A'},{l:'Niveaux',v:r.nombre_niveau_logement||'N/A'}].map(c=>'<div class="info-card"><div class="lbl">'+c.l+'</div><div class="val">'+c.v+'</div></div>').join('');
    document.getElementById('result-area').style.display='block';window.scrollTo({top:0,behavior:'smooth'});
  }
</script>
</body>
</html>`;

// ════════════════════════════════════════════════════════════════════
// PAGE 2 — EXTRACTION PASSOIRES THERMIQUES
// ════════════════════════════════════════════════════════════════════
const HTML_EXTRACT = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Extraction Passoires DPE</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#f4f5f7;color:#1a1a2e;height:100vh;display:flex;flex-direction:column}
    .top-bar{background:white;padding:1rem 1.5rem;box-shadow:0 2px 8px rgba(0,0,0,.07);display:flex;align-items:center;gap:1rem;flex-wrap:wrap;z-index:1000;position:relative}
    .top-bar h1{font-size:1.1rem;font-weight:700;white-space:nowrap}
    .nav-link{padding:.4rem 1rem;border-radius:8px;font-size:.85rem;font-weight:600;text-decoration:none;background:#f0f4ff;color:#4361ee;border:1.5px solid #4361ee}
    .nav-link:hover{background:#4361ee;color:white}
    .controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1}
    .search-wrap{position:relative;flex:1;min-width:200px}
    #zone-input{width:100%;padding:.5rem .9rem;border:1.5px solid #e0e0e0;border-radius:8px;font-size:.9rem;outline:none}
    #zone-input:focus{border-color:#4361ee}
    #zone-suggestions{position:absolute;top:100%;left:0;right:0;background:white;border:1.5px solid #e0e0e0;border-radius:8px;z-index:2000;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
    .zsug{padding:9px 14px;font-size:.85rem;cursor:pointer;border-bottom:1px solid #f0f0f0}
    .zsug:hover{background:#f0f4ff;color:#4361ee}
    .class-filter{display:flex;gap:6px}
    .class-btn{padding:.4rem .8rem;border-radius:6px;font-size:.85rem;font-weight:700;cursor:pointer;border:2px solid transparent;transition:all .15s}
    .class-btn.E{background:#ffd6a5;color:#7a3500;border-color:#ffd6a5}
    .class-btn.F{background:#ffb3b3;color:#7a0000;border-color:#ffb3b3}
    .class-btn.G{background:#ff6b6b;color:#4a0000;border-color:#ff6b6b}
    .class-btn.off{opacity:.35;filter:grayscale(.8)}
    #extract-btn{padding:.5rem 1.2rem;background:#4361ee;color:white;border:none;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;white-space:nowrap}
    #extract-btn:hover{background:#3451d1}
    #extract-btn:disabled{background:#aab4e8;cursor:not-allowed}
    #csv-btn{padding:.5rem 1.2rem;background:#27ae60;color:white;border:none;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;white-space:nowrap;display:none}
    #csv-btn:hover{background:#219a52}
    #count-badge{font-size:.85rem;color:#666;white-space:nowrap}
    #map{flex:1;min-height:0}
    .dpe-dot{width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    .sidebar{position:absolute;right:10px;top:10px;z-index:1000;background:white;border-radius:12px;padding:1rem;box-shadow:0 4px 16px rgba(0,0,0,.12);max-width:280px;width:280px;display:none;max-height:60vh;overflow-y:auto}
    .sidebar h3{font-size:.95rem;font-weight:600;margin-bottom:.75rem;color:#1a1a2e}
    .sidebar-row{display:flex;justify-content:space-between;font-size:.82rem;padding:4px 0;border-bottom:1px solid #f0f0f0}
    .sidebar-row:last-child{border:none}
    .sidebar-label{color:#888}
    .sidebar-val{font-weight:600;color:#1a1a2e;text-align:right;max-width:160px}
    .badge-dpe{display:inline-block;padding:1px 8px;border-radius:5px;font-weight:700;font-size:.95rem}
    .status-bar{background:#f0f4ff;color:#4361ee;padding:.5rem 1rem;font-size:.85rem;display:none;text-align:center}
    .status-err{background:#fff0f0;color:#c0392b}
  </style>
</head>
<body>
<div class="top-bar">
  <a href="/" class="nav-link">← Recherche</a>
  <h1>🗺️ Passoires thermiques</h1>
  <div class="controls">
    <div class="search-wrap">
      <input type="text" id="zone-input" placeholder="Ville, code postal ou adresse..." autocomplete="off"/>
      <div id="zone-suggestions"></div>
    </div>
    <div class="class-filter">
      <button class="class-btn E" data-c="E" onclick="toggleClass(this)">E</button>
      <button class="class-btn F" data-c="F" onclick="toggleClass(this)">F</button>
      <button class="class-btn G" data-c="G" onclick="toggleClass(this)">G</button>
    </div>
    <button id="extract-btn" onclick="doExtract()">🔍 Extraire zone visible</button>
    <button id="csv-btn" onclick="downloadCSV()">⬇️ CSV</button>
    <span id="count-badge"></span>
  </div>
</div>
<div id="status-bar" class="status-bar"></div>
<div id="map"></div>

<script>
// Couleurs par classe
const DPE_COLOR={E:'#ffd6a5',F:'#ffb3b3',G:'#ff6b6b'};
const DPE_BORDER={E:'#e07800',F:'#c0392b',G:'#7c0000'};

// Carte Leaflet
const map = L.map('map').setView([43.450, 5.477], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap', maxZoom: 19
}).addTo(map);

let markers = L.layerGroup().addTo(map);
let allResults = [];
let activeClasses = new Set(['E','F','G']);
let debSug;

// Suggestions zone
const zoneInp = document.getElementById('zone-input');
const zoneSug = document.getElementById('zone-suggestions');
zoneInp.addEventListener('input', () => {
  clearTimeout(debSug);
  const q = zoneInp.value.trim();
  if (q.length < 3) { zoneSug.style.display='none'; return; }
  debSug = setTimeout(async () => {
    try {
      const r = await fetch('/ban?q='+encodeURIComponent(q));
      const d = await r.json();
      if (!d.features?.length) { zoneSug.style.display='none'; return; }
      zoneSug.innerHTML = d.features.map(f =>
        '<div class="zsug" data-lat="'+f.geometry.coordinates[1]+'" data-lng="'+f.geometry.coordinates[0]+'" onclick="goTo(this)">'+f.properties.label+'</div>'
      ).join('');
      zoneSug.style.display = 'block';
    } catch { zoneSug.style.display='none'; }
  }, 280);
});
zoneInp.addEventListener('keydown', e => { if(e.key==='Enter') { zoneSug.style.display='none'; doExtract(); } });
document.addEventListener('click', e => { if(!e.target.closest('.search-wrap')) zoneSug.style.display='none'; });

function goTo(el) {
  const lat = parseFloat(el.dataset.lat);
  const lng = parseFloat(el.dataset.lng);
  map.setView([lat, lng], 15);
  zoneSug.style.display = 'none';
  setTimeout(doExtract, 300);
}

function toggleClass(btn) {
  const c = btn.dataset.c;
  if (activeClasses.has(c)) { activeClasses.delete(c); btn.classList.add('off'); }
  else { activeClasses.add(c); btn.classList.remove('off'); }
}

function setStatus(msg, err) {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.className = 'status-bar' + (err ? ' status-err' : '');
  bar.style.display = msg ? 'block' : 'none';
}

async function doExtract() {
  if (!activeClasses.size) { setStatus('Sélectionnez au moins une classe.', true); return; }
  const bounds = map.getBounds();
  const bbox = bounds.getWest()+','+bounds.getSouth()+','+bounds.getEast()+','+bounds.getNorth();
  const classes = [...activeClasses].join(',');

  document.getElementById('extract-btn').disabled = true;
  setStatus('Extraction en cours...');
  markers.clearLayers();
  allResults = [];
  document.getElementById('count-badge').textContent = '';
  document.getElementById('csv-btn').style.display = 'none';

  try {
    const r = await fetch('/api/extract?bbox='+encodeURIComponent(bbox)+'&classes='+encodeURIComponent(classes));
    const data = await r.json();
    document.getElementById('extract-btn').disabled = false;

    if (data.error) { setStatus('Erreur: '+data.error, true); return; }

    const results = data.results || [];
    allResults = results;

    if (!results.length) {
      setStatus('Aucun logement E/F/G trouvé dans cette zone. Essayez de zoomer ou de déplacer la carte.', false);
      return;
    }

    // Afficher les marqueurs
    results.forEach(row => {
      const cl = row.etiquette_dpe || row.classe_consommation_energie || 'N';
      const lat = parseFloat(row.latitude_ban || row.latitude || 0);
      const lng = parseFloat(row.longitude_ban || row.longitude || 0);
      if (!lat || !lng) return;

      const icon = L.divIcon({
        html: '<div style="background:'+( DPE_COLOR[cl]||'#ccc' )+';border:2px solid '+(DPE_BORDER[cl]||'#999')+';width:14px;height:14px;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [14,14], iconAnchor: [7,7], className: ''
      });

      const m = L.marker([lat, lng], { icon });
      m.on('click', () => showSidebar(row));
      markers.addLayer(m);
    });

    const total = data.total || results.length;
    setStatus('');
    document.getElementById('count-badge').textContent = results.length + ' logements affichés' + (total > results.length ? ' sur ' + total + ' trouvés' : '');
    document.getElementById('csv-btn').style.display = 'inline-block';

  } catch(e) {
    document.getElementById('extract-btn').disabled = false;
    setStatus('Erreur: '+e.message, true);
  }
}

function showSidebar(row) {
  const cl = row.etiquette_dpe || row.classe_consommation_energie || '?';
  const color = DPE_COLOR[cl] || '#eee';
  const addr = row.adresse_ban || row.geo_adresse || 'Adresse inconnue';
  const dt = (row.date_etablissement_dpe||'').substring(0,10);
  const sb = document.getElementById('sidebar');
  sb.style.display = 'block';
  sb.innerHTML = '<h3>📍 ' + addr + '</h3>' + [
    ['Classe DPE', '<span class="badge-dpe" style="background:'+color+'">'+cl+'</span>'],
    ['Classe GES', row.etiquette_ges||row.classe_estimation_ges||'N/A'],
    ['Consommation', (row.conso_5_usages_e_finale||row.consommation_energie)?Math.round(row.conso_5_usages_e_finale||row.consommation_energie)+' kWh/m²/an':'N/A'],
    ['Émissions CO₂', (row.emission_ges_5_usages||row.estimation_ges)?Math.round(row.emission_ges_5_usages||row.estimation_ges)+' kg/m²/an':'N/A'],
    ['Année construction', row.annee_construction||'N/A'],
    ['Type bâtiment', row.type_batiment||row.tr002_type_batiment_description||'N/A'],
    ['Date DPE', dt||'N/A'],
    ['N° DPE', row.numero_dpe||'N/A'],
  ].map(([l,v])=>'<div class="sidebar-row"><span class="sidebar-label">'+l+'</span><span class="sidebar-val">'+v+'</span></div>').join('');
}

function downloadCSV() {
  if (!allResults.length) return;
  const keys = ['adresse_ban','etiquette_dpe','etiquette_ges','conso_5_usages_e_finale','emission_ges_5_usages','annee_construction','type_batiment','date_etablissement_dpe','numero_dpe','latitude_ban','longitude_ban'];
  const labels = ['Adresse','Classe DPE','Classe GES','Conso kWh/m²/an','Émissions kg/m²/an','Année construction','Type bâtiment','Date DPE','N° DPE','Latitude','Longitude'];
  const csv = [labels.join(';'), ...allResults.map(r => keys.map(k => JSON.stringify(r[k]??'')).join(';'))].join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'passoires_thermiques.csv'; a.click();
}

// Sidebar fermeture
document.getElementById('map').addEventListener('click', e => {
  if (!e.target.closest('.sidebar') && !e.target.closest('.leaflet-marker-icon')) {
    document.getElementById('sidebar').style.display='none';
  }
});
<\/script>

<div id="sidebar"></div>
</body>
</html>`;
