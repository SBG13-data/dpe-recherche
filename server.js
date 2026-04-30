const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;

// ── Proxy vers une URL externe ────────────────────────────────────────────
function proxyRequest(targetUrl, res) {
  https.get(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0 DPE-App/1.0' } }, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    });
  }).on('error', (e) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  });
}

// ── Serveur principal ─────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const q = parsed.query.q || '';

  // Page HTML
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  // Autocomplétion adresses (BAN officielle)
  if (path === '/ban') {
    proxyRequest(
      'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(q) + '&limit=6',
      res
    );
    return;
  }

  // Recherche DPE (ADEME)
  if (path === '/dpe') {
    const fields = [
      'numero_dpe','date_etablissement_dpe','etiquette_dpe','etiquette_ges',
      'consommation_energie','emission_ges','surface_habitable_logement',
      'annee_construction','type_batiment','type_installation_chauffage',
      'type_energie_principale_chauffage','type_installation_ecs',
      'type_energie_principale_ecs','type_ventilation',
      'nombre_niveau_logement','adresse_ban'
    ].join(',');

    proxyRequest(
      'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines'
      + '?q=' + encodeURIComponent(q)
      + '&q_fields=adresse_ban'
      + '&page=1&size=8'
      + '&sort=-date_etablissement_dpe'
      + '&select=' + fields,
      res
    );
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('Serveur DPE démarré sur le port ' + PORT);
});

// ════════════════════════════════════════════════════════════════════════════
// HTML INTÉGRÉ
// ════════════════════════════════════════════════════════════════════════════
const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recherche DPE par adresse</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#f4f5f7;color:#1a1a2e;min-height:100vh;padding:2rem 1rem}
    .container{max-width:900px;margin:0 auto}
    header{text-align:center;margin-bottom:2rem}
    header h1{font-size:1.9rem;font-weight:700;letter-spacing:-0.02em}
    header p{color:#666;margin-top:.4rem;font-size:.95rem}
    .search-card{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.5rem;position:relative}
    .search-row{display:flex;gap:10px}
    #addr-input{flex:1;padding:.75rem 1rem;border:1.5px solid #e0e0e0;border-radius:10px;font-size:1rem;outline:none;background:#fafafa;transition:border-color .2s}
    #addr-input:focus{border-color:#4361ee;background:white}
    #search-btn{padding:.75rem 1.4rem;background:#4361ee;color:white;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .2s}
    #search-btn:hover{background:#3451d1}
    #search-btn:disabled{background:#aab4e8;cursor:not-allowed}
    #suggestions{position:absolute;left:1.5rem;right:1.5rem;top:calc(100% - .5rem);background:white;border:1.5px solid #e0e0e0;border-radius:10px;z-index:100;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
    .sug-item{padding:11px 16px;font-size:.9rem;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:background .15s}
    .sug-item:last-child{border-bottom:none}
    .sug-item:hover{background:#f0f4ff;color:#4361ee}
    #status{margin-top:1rem;padding:.75rem 1rem;border-radius:10px;font-size:.9rem;display:none}
    .status-loading{background:#f0f4ff;color:#4361ee;display:flex!important;align-items:center;gap:8px}
    .status-error{background:#fff0f0;color:#c0392b;display:block!important}
    .spinner{width:16px;height:16px;border:2px solid #b8c6ff;border-top-color:#4361ee;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    #multi-area{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.5rem;display:none}
    #multi-area h3{font-size:1rem;color:#555;margin-bottom:1rem;font-weight:500}
    .multi-item{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid #e8e8e8;border-radius:10px;cursor:pointer;margin-bottom:8px;transition:border-color .2s}
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
    .info-card .label{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#aaa;margin-bottom:6px}
    .info-card .value{font-size:1.05rem;font-weight:700;color:#1a1a2e;line-height:1.3}
    .equip-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:1.2rem}
    .equip-card{background:white;border-radius:12px;padding:1rem 1.1rem;box-shadow:0 2px 8px rgba(0,0,0,.06);border-left:4px solid #4361ee}
    .equip-card .label{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#aaa;margin-bottom:6px}
    .equip-card .value{font-size:.92rem;font-weight:600;color:#1a1a2e;line-height:1.4}
    .dpe-scale{display:flex;gap:4px;margin-top:8px}
    .dpe-scale-item{flex:1;height:6px;border-radius:3px;opacity:.25}
    .dpe-scale-item.active{opacity:1}
    .no-dpe{background:white;border-radius:16px;padding:2rem;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.07);display:none}
    .no-dpe p{color:#666;font-size:.95rem;line-height:1.8}
    .source-note{text-align:center;font-size:.78rem;color:#bbb;margin-top:1.5rem;padding-top:1rem;border-top:1px solid #eee}
    @media(max-width:600px){.search-row{flex-direction:column}.cards-grid{grid-template-columns:1fr 1fr}.equip-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<div class="container">
  <header>
    <h1>🏠 Recherche DPE par adresse</h1>
    <p>Données officielles ADEME — chauffage, énergie, isolation, classe énergétique</p>
  </header>

  <div class="search-card">
    <div class="search-row">
      <input type="text" id="addr-input" placeholder="Ex: 67 Residence les Hameaux de Biver 13120 Gardanne" autocomplete="off"/>
      <button id="search-btn" onclick="doSearch()">Rechercher</button>
    </div>
    <div id="suggestions"></div>
    <div id="status"></div>
  </div>

  <div id="multi-area">
    <h3>Plusieurs DPE trouvés — choisissez :</h3>
    <div id="multi-list"></div>
  </div>

  <div class="no-dpe" id="no-dpe">
    <p>❌ Aucun DPE trouvé pour cette adresse dans le registre ADEME.<br>Le logement n'a peut-être pas de DPE depuis juillet 2021.</p>
  </div>

  <div id="result-area">
    <div class="result-header">
      <div id="dpe-badge" class="dpe-big-badge dpe-N">?</div>
      <div class="result-header-info">
        <h2 id="addr-display"></h2>
        <p id="dpe-meta"></p>
        <div class="dpe-scale" id="dpe-scale"></div>
      </div>
    </div>
    <p class="section-title">⚡ Performance énergétique</p>
    <div class="cards-grid" id="perf-grid"></div>
    <p class="section-title">🔧 Équipements</p>
    <div class="equip-grid" id="equip-grid"></div>
    <p class="section-title">🏗️ Caractéristiques du logement</p>
    <div class="cards-grid" id="logement-grid"></div>
    <div class="source-note">Données issues du registre national DPE — ADEME · Licence Ouverte Etalab · DPE après juillet 2021 uniquement</div>
  </div>
</div>

<script>
  const DPE_COLORS={A:'#b7e4c7',B:'#d8f3dc',C:'#d9ed92',D:'#fff3b0',E:'#ffd6a5',F:'#ffb3b3',G:'#ff6b6b'};
  let dbc;
  const inp=document.getElementById('addr-input'),sug=document.getElementById('suggestions');

  inp.addEventListener('input',()=>{
    clearTimeout(dbc);
    const q=inp.value.trim();
    if(q.length<4){sug.style.display='none';return;}
    dbc=setTimeout(()=>fetchSug(q),280);
  });
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();if(e.key==='Escape')sug.style.display='none';});
  document.addEventListener('click',e=>{if(!e.target.closest('.search-card'))sug.style.display='none';});

  async function fetchSug(q){
    try{
      const r=await fetch('/ban?q='+encodeURIComponent(q));
      const d=await r.json();
      if(!d.features?.length){sug.style.display='none';return;}
      sug.innerHTML=d.features.map(f=>'<div class="sug-item" onclick="pick(\''+f.properties.label.replace(/'/g,"\\'")+'\')">' +f.properties.label+'</div>').join('');
      sug.style.display='block';
    }catch{sug.style.display='none';}
  }

  function pick(l){inp.value=l;sug.style.display='none';doSearch();}

  function setStatus(m,t){
    const el=document.getElementById('status');
    if(!m){el.style.display='none';return;}
    el.innerHTML=t==='loading'?'<span class="spinner"></span>'+m:m;
    el.className='status-'+t;
    el.style.display=t==='loading'?'flex':'block';
  }

  function hideAll(){
    ['result-area','multi-area','no-dpe'].forEach(id=>document.getElementById(id).style.display='none');
    setStatus('','');
  }

  async function doSearch(){
    const addr=inp.value.trim();
    if(!addr)return;
    sug.style.display='none';
    hideAll();
    document.getElementById('search-btn').disabled=true;
    setStatus('Interrogation du registre ADEME...','loading');
    try{
      const resp=await fetch('/dpe?q='+encodeURIComponent(addr));
      const data=await resp.json();
      setStatus('','');
      document.getElementById('search-btn').disabled=false;
      if(data.error)throw new Error(data.error);
      if(!data.results?.length){document.getElementById('no-dpe').style.display='block';return;}
      data.results.length===1?renderDPE(data.results[0]):showMultiple(data.results);
    }catch(err){
      setStatus('Erreur : '+err.message,'error');
      document.getElementById('search-btn').disabled=false;
    }
  }

  function showMultiple(results){
    window._r=results;
    document.getElementById('multi-list').innerHTML=results.map((r,i)=>{
      const cl=r.etiquette_dpe||'N';
      const date=(r.date_etablissement_dpe||'').substring(0,10);
      const surf=r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+'m²':'';
      return '<div class="multi-item" onclick="renderDPE(window._r['+i+'])"><span class="dpe-big-badge dpe-'+cl+'" style="width:40px;height:40px;font-size:1.2rem;">'+cl+'</span><div><div style="font-weight:600;font-size:.9rem;">'+(r.adresse_ban||'')+'</div><div style="font-size:.8rem;color:#888;">'+(date?'DPE du '+date:'')+(surf?' · '+surf:'')+'</div></div></div>';
    }).join('');
    document.getElementById('multi-area').style.display='block';
  }

  function renderDPE(r){
    document.getElementById('multi-area').style.display='none';
    const cl=r.etiquette_dpe||'N';
    const badge=document.getElementById('dpe-badge');
    badge.textContent=cl==='N'?'?':cl;
    badge.className='dpe-big-badge dpe-'+cl;
    document.getElementById('addr-display').textContent=r.adresse_ban||inp.value;
    const date=(r.date_etablissement_dpe||'').substring(0,10);
    document.getElementById('dpe-meta').textContent=(date?'DPE établi le '+date:'')+(r.numero_dpe?' · N°'+r.numero_dpe:'');
    document.getElementById('dpe-scale').innerHTML=['A','B','C','D','E','F','G'].map(c=>'<div class="dpe-scale-item '+(c===cl?'active':'')+'" style="background:'+(DPE_COLORS[c]||'#ccc')+'"></div>').join('');

    document.getElementById('perf-grid').innerHTML=[
      {label:'Classe énergie',value:cl!=='N'?cl:'N/A'},
      {label:'Classe GES',value:r.etiquette_ges||'N/A'},
      {label:'Consommation',value:r.consommation_energie?Math.round(r.consommation_energie)+' kWh/m²/an':'N/A'},
      {label:'Émissions CO₂',value:r.emission_ges?Math.round(r.emission_ges)+' kg/m²/an':'N/A'},
    ].map(c=>'<div class="info-card"><div class="label">'+c.label+'</div><div class="value">'+c.value+'</div></div>').join('');

    document.getElementById('equip-grid').innerHTML=[
      {label:'Chauffage',value:r.type_installation_chauffage||'N/A'},
      {label:'Énergie chauffage',value:r.type_energie_principale_chauffage||'N/A'},
      {label:'Eau chaude (ECS)',value:r.type_installation_ecs||'N/A'},
      {label:'Énergie ECS',value:r.type_energie_principale_ecs||'N/A'},
      {label:'Ventilation',value:r.type_ventilation||'N/A'},
    ].map(e=>'<div class="equip-card"><div class="label">'+e.label+'</div><div class="value">'+e.value+'</div></div>').join('');

    document.getElementById('logement-grid').innerHTML=[
      {label:'Surface',value:r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+' m²':'N/A'},
      {label:'Année construction',value:r.annee_construction||'N/A'},
      {label:'Type de bâtiment',value:r.type_batiment||'N/A'},
      {label:'Niveaux',value:r.nombre_niveau_logement||'N/A'},
    ].map(c=>'<div class="info-card"><div class="label">'+c.label+'</div><div class="value">'+c.value+'</div></div>').join('');

    document.getElementById('result-area').style.display='block';
    window.scrollTo({top:0,behavior:'smooth'});
  }
</script>
</body>
</html>`;
