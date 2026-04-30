const http = require('http');
const https = require('https');
const { URL } = require('url');
const PORT = process.env.PORT || 3000;

// Remplacez par votre clé Google Maps
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || 'VOTRE_CLE_ICI';

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 DPE-App/1.0', 'Accept': '*/*', 'Referer': 'https://data.ademe.fr/' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
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
  if (path === '/extract') { sendHTML(res, HTML_EXTRACT.replace('__GMKEY__', GOOGLE_MAPS_KEY)); return; }

  if (path === '/ban') {
    const q = u.searchParams.get('q') || '';
    try { const r = await fetchUrl('https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(q) + '&limit=6'); sendJSON(res, r.body.toString()); }
    catch (e) { sendError(res, e.message); }
    return;
  }

  if (path === '/dpe') {
    const q = u.searchParams.get('q') || '';
    const fields = 'numero_dpe,date_etablissement_dpe,etiquette_dpe,etiquette_ges,conso_5_usages_e_finale,emission_ges_5_usages,surface_habitable_logement,annee_construction,type_batiment,type_installation_chauffage,type_energie_principale_chauffage,type_installation_ecs,type_energie_principale_ecs,type_ventilation,nombre_niveau_logement,adresse_ban';
    try {
      const r = await fetchUrl('https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?q=' + encodeURIComponent(q) + '&q_fields=adresse_ban&page=1&size=8&sort=-date_etablissement_dpe&select=' + fields);
      if (r.status === 200) {
        try {
          const d = JSON.parse(r.body.toString());
          if (d.results) d.results = d.results.map(row => ({ ...row, consommation_energie: row.conso_5_usages_e_finale, emission_ges: row.emission_ges_5_usages }));
          sendJSON(res, d);
        } catch { sendJSON(res, r.body.toString()); }
      } else { sendJSON(res, JSON.stringify({ results: [], _debug: r.body.toString().substring(0, 300) })); }
    } catch (e) { sendError(res, e.message); }
    return;
  }

  if (path === '/api/extract') {
    const bbox    = u.searchParams.get('bbox') || '';
    const classes = u.searchParams.get('classes') || 'A,B,C,D,E,F,G';
    const page    = parseInt(u.searchParams.get('page') || '1');
    if (!bbox) { sendError(res, 'bbox requis'); return; }
    const apiUrl = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?' +
      'bbox=' + encodeURIComponent(bbox) +
      '&etiquette_dpe_in=' + encodeURIComponent(classes) +
      '&page=' + page + '&size=500&sort=-date_etablissement_dpe' +
      '&select=adresse_ban,etiquette_dpe,etiquette_ges,conso_5_usages_e_finale,emission_ges_5_usages,annee_construction,longitude_ban,latitude_ban,date_etablissement_dpe,numero_dpe,type_batiment,type_energie_principale_chauffage,type_installation_chauffage';
    try {
      const r = await fetchUrl(apiUrl);
      sendJSON(res, r.status === 200 ? r.body.toString() : JSON.stringify({ results: [], total: 0, _debug: 'HTTP ' + r.status }));
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
    h1{font-size:1.9rem;font-weight:700} header p{color:#666;margin-top:.4rem;font-size:.95rem}
    .nav{display:flex;justify-content:center;gap:10px;margin-bottom:1.5rem}
    .nav a{padding:.6rem 1.4rem;border-radius:10px;font-size:.9rem;font-weight:600;text-decoration:none;background:white;color:#4361ee;border:1.5px solid #4361ee}
    .nav a.active,.nav a:hover{background:#4361ee;color:white}
    .card{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.5rem;position:relative}
    .row{display:flex;gap:10px}
    input{flex:1;padding:.75rem 1rem;border:1.5px solid #e0e0e0;border-radius:10px;font-size:1rem;outline:none;background:#fafafa}
    input:focus{border-color:#4361ee;background:white}
    .btn{padding:.75rem 1.4rem;background:#4361ee;color:white;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer}
    .btn:hover{background:#3451d1} .btn:disabled{background:#aab4e8;cursor:not-allowed}
    #sg{position:absolute;left:1.5rem;right:1.5rem;top:calc(100% - .5rem);background:white;border:1.5px solid #e0e0e0;border-radius:10px;z-index:100;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
    .si{padding:11px 16px;font-size:.9rem;cursor:pointer;border-bottom:1px solid #f0f0f0}
    .si:hover{background:#f0f4ff;color:#4361ee}
    #st{margin-top:1rem;padding:.75rem 1rem;border-radius:10px;font-size:.9rem;display:none}
    .sl{background:#f0f4ff;color:#4361ee;display:flex!important;align-items:center;gap:8px}
    .se{background:#fff0f0;color:#c0392b;display:block!important}
    .sp{width:16px;height:16px;border:2px solid #b8c6ff;border-top-color:#4361ee;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    #multi{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.5rem;display:none}
    .mi{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid #e8e8e8;border-radius:10px;cursor:pointer;margin-bottom:8px}
    .mi:hover{border-color:#4361ee;background:#f0f4ff}
    #res{display:none}
    .rh{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.2rem;display:flex;align-items:center;gap:16px}
    .badge{width:64px;height:64px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;flex-shrink:0}
    .A{background:#b7e4c7;color:#1b4332}.B{background:#d8f3dc;color:#1b4332}.C{background:#d9ed92;color:#386641}.D{background:#fff3b0;color:#7b5e00}.E{background:#ffd6a5;color:#7a3500}.F{background:#ffb3b3;color:#7a0000}.G{background:#ff6b6b;color:#4a0000}.N{background:#e8e8e8;color:#666}
    .rhi h2{font-size:1.1rem;font-weight:600;margin-bottom:4px} .rhi p{font-size:.85rem;color:#888}
    .sec{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:.75rem}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:10px;margin-bottom:1.2rem}
    .ic{background:white;border-radius:12px;padding:1rem;box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .ic .l{font-size:.7rem;font-weight:600;text-transform:uppercase;color:#aaa;margin-bottom:5px}
    .ic .v{font-size:1rem;font-weight:700;color:#1a1a2e}
    .eg{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px;margin-bottom:1.2rem}
    .ec{background:white;border-radius:12px;padding:1rem;box-shadow:0 2px 8px rgba(0,0,0,.06);border-left:4px solid #4361ee}
    .ec .l{font-size:.7rem;font-weight:600;text-transform:uppercase;color:#aaa;margin-bottom:5px}
    .ec .v{font-size:.9rem;font-weight:600;color:#1a1a2e;line-height:1.4}
    .sc{display:flex;gap:4px;margin-top:8px} .scc{flex:1;height:6px;border-radius:3px;opacity:.25} .scc.on{opacity:1}
    .nodpe{background:white;border-radius:16px;padding:2rem;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.07);display:none}
    .src{text-align:center;font-size:.78rem;color:#bbb;margin-top:1.5rem;padding-top:1rem;border-top:1px solid #eee}
  </style>
</head>
<body>
<div class="container">
  <header><h1>🏠 Outil DPE ADEME</h1><p>Données officielles — chauffage, énergie, isolation, classe énergétique</p></header>
  <div class="nav"><a href="/" class="active">🔍 Recherche adresse</a><a href="/extract">🗺️ Carte & Extraction</a></div>
  <div class="card">
    <div class="row">
      <input type="text" id="ai" placeholder="Ex: 67 Residence les Hameaux de Biver 13120 Gardanne" autocomplete="off"/>
      <button class="btn" id="sb" onclick="go()">Rechercher</button>
    </div>
    <div id="sg"></div>
    <div id="st"></div>
  </div>
  <div id="multi"><h3 style="font-size:1rem;color:#555;margin-bottom:1rem">Plusieurs DPE — choisissez :</h3><div id="ml"></div></div>
  <div class="nodpe" id="nodpe"><p>❌ Aucun DPE trouvé pour cette adresse.</p></div>
  <div id="res">
    <div class="rh"><div id="db" class="badge N">?</div><div class="rhi"><h2 id="ad"></h2><p id="dm"></p><div class="sc" id="sc"></div></div></div>
    <p class="sec">⚡ Performance</p><div class="grid" id="pg"></div>
    <p class="sec">🔧 Équipements</p><div class="eg" id="eg"></div>
    <p class="sec">🏗️ Logement</p><div class="grid" id="lg"></div>
    <div class="src">Données ADEME · Licence Ouverte Etalab</div>
  </div>
</div>
<script>
const CC={A:'#b7e4c7',B:'#d8f3dc',C:'#d9ed92',D:'#fff3b0',E:'#ffd6a5',F:'#ffb3b3',G:'#ff6b6b'};
let t;const ai=document.getElementById('ai'),sg=document.getElementById('sg');
ai.addEventListener('input',()=>{clearTimeout(t);const q=ai.value.trim();if(q.length<4){sg.style.display='none';return;}t=setTimeout(()=>fs(q),280);});
ai.addEventListener('keydown',e=>{if(e.key==='Enter')go();if(e.key==='Escape')sg.style.display='none';});
document.addEventListener('click',e=>{if(!e.target.closest('.card'))sg.style.display='none';});
async function fs(q){try{const r=await fetch('/ban?q='+encodeURIComponent(q));const d=await r.json();if(!d.features?.length){sg.style.display='none';return;}sg.innerHTML=d.features.map(f=>'<div class="si" onclick="pk(\''+f.properties.label.replace(/'/g,"\\'")+'\')">'+f.properties.label+'</div>').join('');sg.style.display='block';}catch{sg.style.display='none';}}
function pk(l){ai.value=l;sg.style.display='none';go();}
function ss(m,tp){const e=document.getElementById('st');if(!m){e.style.display='none';return;}e.innerHTML=tp==='l'?'<span class="sp"></span>'+m:m;e.className=tp==='l'?'sl':'se';e.style.display=tp==='l'?'flex':'block';}
function ha(){['res','multi','nodpe'].forEach(i=>document.getElementById(i).style.display='none');ss('','');}
async function go(){const a=ai.value.trim();if(!a)return;sg.style.display='none';ha();document.getElementById('sb').disabled=true;ss('Interrogation ADEME...','l');try{const r=await fetch('/dpe?q='+encodeURIComponent(a));const d=await r.json();ss('','');document.getElementById('sb').disabled=false;if(d.error)throw new Error(d.error);if(!d.results?.length){document.getElementById('nodpe').style.display='block';return;}d.results.length===1?rd(d.results[0]):sm(d.results);}catch(e){ss('Erreur : '+e.message,'e');document.getElementById('sb').disabled=false;}}
function sm(R){window._r=R;document.getElementById('ml').innerHTML=R.map((r,i)=>{const cl=r.etiquette_dpe||'N';const dt=(r.date_etablissement_dpe||'').substring(0,10);const sf=r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+'m²':'';return '<div class="mi" onclick="rd(window._r['+i+'])"><span class="badge '+cl+'" style="width:40px;height:40px;font-size:1.2rem;">'+cl+'</span><div><b style="font-size:.9rem">'+(r.adresse_ban||'')+'</b><br><span style="font-size:.8rem;color:#888">'+(dt?'DPE du '+dt:'')+(sf?' · '+sf:'')+'</span></div></div>';}).join('');document.getElementById('multi').style.display='block';}
function rd(r){document.getElementById('multi').style.display='none';const cl=r.etiquette_dpe||'N';const b=document.getElementById('db');b.textContent=cl==='N'?'?':cl;b.className='badge '+cl;document.getElementById('ad').textContent=r.adresse_ban||ai.value;const dt=(r.date_etablissement_dpe||'').substring(0,10);document.getElementById('dm').textContent=(dt?'DPE établi le '+dt:'')+(r.numero_dpe?' · N°'+r.numero_dpe:'');document.getElementById('sc').innerHTML=['A','B','C','D','E','F','G'].map(c=>'<div class="scc '+(c===cl?'on':'')+'" style="background:'+(CC[c]||'#ccc')+'"></div>').join('');const cn=r.consommation_energie||r.conso_5_usages_e_finale,gs=r.emission_ges||r.emission_ges_5_usages;
document.getElementById('pg').innerHTML=[{l:'Classe énergie',v:cl!=='N'?cl:'N/A'},{l:'Classe GES',v:r.etiquette_ges||'N/A'},{l:'Consommation',v:cn?Math.round(cn)+' kWh/m²/an':'N/A'},{l:'Émissions CO₂',v:gs?Math.round(gs)+' kg/m²/an':'N/A'}].map(c=>'<div class="ic"><div class="l">'+c.l+'</div><div class="v">'+c.v+'</div></div>').join('');
document.getElementById('eg').innerHTML=[{l:'Chauffage',v:r.type_installation_chauffage||'N/A'},{l:'Énergie chauffage',v:r.type_energie_principale_chauffage||'N/A'},{l:'Eau chaude',v:r.type_installation_ecs||'N/A'},{l:'Énergie ECS',v:r.type_energie_principale_ecs||'N/A'},{l:'Ventilation',v:r.type_ventilation||'N/A'}].map(e=>'<div class="ec"><div class="l">'+e.l+'</div><div class="v">'+e.v+'</div></div>').join('');
document.getElementById('lg').innerHTML=[{l:'Surface',v:r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+' m²':'N/A'},{l:'Année',v:r.annee_construction||'N/A'},{l:'Type',v:r.type_batiment||'N/A'},{l:'Niveaux',v:r.nombre_niveau_logement||'N/A'}].map(c=>'<div class="ic"><div class="l">'+c.l+'</div><div class="v">'+c.v+'</div></div>').join('');
document.getElementById('res').style.display='block';window.scrollTo({top:0,behavior:'smooth'});}
<\/script>
</body></html>`;

// ════════════════════════════════════════════════════════════════════
// PAGE 2 — CARTE GOOGLE MAPS + TABLEAU
// ════════════════════════════════════════════════════════════════════
const HTML_EXTRACT = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Carte DPE</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}
    body{display:flex;flex-direction:column;background:#f4f5f7}
    .bar{background:#1e2a4a;padding:.6rem .9rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;z-index:100;flex-shrink:0}
    .bar h1{font-size:.95rem;font-weight:700;color:#fff;white-space:nowrap}
    .navl{padding:.35rem .8rem;border-radius:7px;font-size:.8rem;font-weight:600;text-decoration:none;background:#2d3a5e;color:#90b4ff;white-space:nowrap}
    .navl:hover{background:#3d4f7e;color:#fff}
    .swrap{position:relative;flex:1;min-width:130px;max-width:260px}
    #zi{width:100%;padding:.4rem .8rem;border:1px solid #3d4f7e;border-radius:7px;font-size:.82rem;outline:none;background:#2d3a5e;color:#fff}
    #zi::placeholder{color:#8899bb} #zi:focus{border-color:#4361ee}
    #zs{position:absolute;top:100%;left:0;right:0;background:#1e2a4a;border:1px solid #3d4f7e;border-radius:7px;z-index:3000;display:none;margin-top:2px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
    .zsi{padding:8px 12px;font-size:.8rem;cursor:pointer;border-bottom:1px solid #2d3a5e;color:#cdd8f0}
    .zsi:hover{background:#2d3a5e;color:#fff}
    .filters{display:flex;gap:3px;flex-shrink:0}
    .fb{padding:.3rem .55rem;border-radius:5px;font-size:.78rem;font-weight:700;cursor:pointer;border:2px solid transparent;transition:opacity .15s}
    .fb.off{opacity:.25}
    .fA{background:#b7e4c7;color:#1b4332}.fB{background:#d8f3dc;color:#1b4332}.fC{background:#d9ed92;color:#386641}
    .fD{background:#fff3b0;color:#7b5e00}.fE{background:#ffd6a5;color:#7a3500}.fF{background:#ffb3b3;color:#7a0000}.fG{background:#ff6b6b;color:#4a0000}
    .btnx{padding:.38rem .85rem;background:#4361ee;color:white;border:none;border-radius:7px;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap}
    .btnx:hover{background:#3451d1} .btnx:disabled{background:#2d3a5e;color:#5a7aaa;cursor:not-allowed}
    .btnc{padding:.38rem .85rem;background:#1a6b3a;color:white;border:none;border-radius:7px;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap;display:none}
    .btnc:hover{background:#15552e}
    #cnt{font-size:.78rem;color:#90a8cc;white-space:nowrap}
    .sbar{padding:.35rem 1rem;font-size:.8rem;text-align:center;display:none;flex-shrink:0}
    .sbar.load{background:#1a2a4a;color:#90b4ff}.sbar.err{background:#3a1a1a;color:#ff8888}

    .main{flex:1;display:flex;min-height:0;overflow:hidden}
    #map{flex:1;min-height:0}

    /* Panneau tableau */
    #panel{width:340px;background:#fff;border-left:1px solid #e0e0e0;display:flex;flex-direction:column;flex-shrink:0;overflow:hidden}
    .panel-head{padding:.75rem 1rem;background:#f8f9fa;border-bottom:1px solid #e0e0e0;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
    .panel-head h3{font-size:.9rem;font-weight:700;color:#1a1a2e}
    .panel-head span{font-size:.78rem;color:#888}
    #tbl-wrap{flex:1;overflow-y:auto}
    table{width:100%;border-collapse:collapse;font-size:.78rem}
    th{background:#f0f4ff;padding:6px 8px;text-align:left;font-weight:600;color:#4361ee;position:sticky;top:0;white-space:nowrap}
    td{padding:5px 8px;border-bottom:1px solid #f0f0f0;color:#1a1a2e;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    tr:hover td{background:#f8f9ff}
    .bdg{display:inline-block;padding:1px 7px;border-radius:4px;font-weight:700;font-size:.82rem}
    .no-data{padding:2rem;text-align:center;color:#aaa;font-size:.85rem}

    /* Google Maps info window custom */
    .gm-iw{font-family:'Segoe UI',sans-serif;font-size:.8rem;min-width:200px}
    .gm-iw h4{font-size:.88rem;font-weight:700;margin-bottom:6px;color:#1a1a2e}
    .gm-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0;border-bottom:1px solid #f0f0f0}
    .gm-row:last-child{border:none}
    .gm-lbl{color:#888;white-space:nowrap}
    .gm-val{font-weight:600;color:#1a1a2e}
    .cl-badge{display:inline-block;padding:0 7px;border-radius:4px;font-weight:700}
  </style>
</head>
<body>

<div class="bar">
  <a href="/" class="navl">← Recherche</a>
  <h1>🗺️ Carte DPE</h1>
  <div class="swrap">
    <input type="text" id="zi" placeholder="Ville ou adresse..." autocomplete="off"/>
    <div id="zs"></div>
  </div>
  <div class="filters">
    <button class="fb fA" data-c="A" onclick="tog(this)">A</button>
    <button class="fb fB" data-c="B" onclick="tog(this)">B</button>
    <button class="fb fC" data-c="C" onclick="tog(this)">C</button>
    <button class="fb fD" data-c="D" onclick="tog(this)">D</button>
    <button class="fb fE" data-c="E" onclick="tog(this)">E</button>
    <button class="fb fF" data-c="F" onclick="tog(this)">F</button>
    <button class="fb fG" data-c="G" onclick="tog(this)">G</button>
  </div>
  <button class="btnx" id="xbtn" onclick="doExtract()">🔍 Extraire zone</button>
  <button class="btnc" id="csvbtn" onclick="dlCSV()">⬇️ CSV</button>
  <span id="cnt"></span>
</div>
<div id="sbar" class="sbar"></div>

<div class="main">
  <div id="map"></div>
  <div id="panel">
    <div class="panel-head">
      <h3>📋 Résultats</h3>
      <span id="pcnt">0 logements</span>
    </div>
    <div id="tbl-wrap">
      <div class="no-data" id="nodata">Extraire une zone pour voir les résultats</div>
      <table id="tbl" style="display:none">
        <thead><tr>
          <th>Cl.</th>
          <th>Adresse</th>
          <th>Énergie</th>
          <th>Année</th>
        </tr></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
  </div>
</div>

<script>
const DPE_COL={A:'#b7e4c7',B:'#d8f3dc',C:'#d9ed92',D:'#fff3b0',E:'#ffd6a5',F:'#ffb3b3',G:'#ff6b6b',N:'#ddd'};
const DPE_BDR={A:'#1b4332',B:'#1b4332',C:'#386641',D:'#7b5e00',E:'#e07800',F:'#c0392b',G:'#7c0000',N:'#999'};
let map, infoWindow;
let allPts=[], gMarkers=[], active=new Set(['A','B','C','D','E','F','G']);
let debSug;

// ── Initialisation Google Maps ────────────────────────────────────
function initMap(){
  map=new google.maps.Map(document.getElementById('map'),{
    center:{lat:43.450,lng:5.477},
    zoom:14,
    mapTypeId:'roadmap',
    styles:[
      {featureType:'poi',elementType:'labels',stylers:[{visibility:'off'}]},
      {featureType:'transit',elementType:'labels',stylers:[{visibility:'off'}]}
    ],
    gestureHandling:'greedy'
  });
  infoWindow=new google.maps.InfoWindow();
  map.addListener('click',()=>infoWindow.close());
}

// ── Marqueurs ─────────────────────────────────────────────────────
function makeSVGIcon(cl){
  const col=DPE_COL[cl]||'#ddd', bdr=DPE_BDR[cl]||'#999';
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="6" fill="'+col+'" stroke="'+bdr+'" stroke-width="1.5"/></svg>';
  return {url:'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg), scaledSize:new google.maps.Size(14,14), anchor:new google.maps.Point(7,7)};
}

function popupHTML(p){
  const cl=p.cl||'?', col=DPE_COL[cl]||'#ddd', bdr=DPE_BDR[cl]||'#999';
  return '<div class="gm-iw"><h4>'+p.adresse+'</h4>'+
    [['Classe DPE','<span class="cl-badge" style="background:'+col+';color:'+bdr+'">'+cl+'</span>'],
     ['Classe GES',p.ges||'N/A'],
     ['Consommation',p.conso?Math.round(p.conso)+' kWh/m²/an':'N/A'],
     ['Énergie chauffage',p.energie||'N/A'],
     ['Année construction',p.annee||'N/A'],
     ['Type',p.type||'N/A'],
     ['Date DPE',p.date||'N/A'],
     ['N° DPE',p.num||'N/A'],
    ].map(([l,v])=>'<div class="gm-row"><span class="gm-lbl">'+l+'</span><span class="gm-val">'+v+'</span></div>').join('')+'</div>';
}

function refreshMarkers(){
  gMarkers.forEach(m=>m.setMap(null));
  gMarkers=[];
  allPts.forEach(p=>{
    if(!active.has(p.cl))return;
    const m=new google.maps.Marker({
      position:{lat:p.lat,lng:p.lng},
      map,
      icon:makeSVGIcon(p.cl),
      title:p.adresse
    });
    m.addListener('click',()=>{
      infoWindow.setContent(popupHTML(p));
      infoWindow.open(map,m);
    });
    gMarkers.push(m);
  });
  updateTable();
}

// ── Tableau ───────────────────────────────────────────────────────
function updateTable(){
  const pts=allPts.filter(p=>active.has(p.cl));
  document.getElementById('pcnt').textContent=pts.length+' logement'+(pts.length>1?'s':'');
  document.getElementById('nodata').style.display=pts.length?'none':'block';
  document.getElementById('tbl').style.display=pts.length?'table':'none';
  document.getElementById('tbody').innerHTML=pts.map(p=>{
    const col=DPE_COL[p.cl]||'#ddd', bdr=DPE_BDR[p.cl]||'#999';
    return '<tr onclick="panTo('+p.lat+','+p.lng+')" style="cursor:pointer" title="'+p.adresse+'">'+
      '<td><span class="bdg" style="background:'+col+';color:'+bdr+'">'+p.cl+'</span></td>'+
      '<td title="'+p.adresse+'">'+p.adresse+'</td>'+
      '<td>'+(p.energie||'-')+'</td>'+
      '<td>'+(p.annee||'-')+'</td>'+
    '</tr>';
  }).join('');
}
function panTo(lat,lng){
  map.panTo({lat,lng});
  map.setZoom(17);
}

// ── Recherche adresse ─────────────────────────────────────────────
const zi=document.getElementById('zi'), zs=document.getElementById('zs');
zi.addEventListener('input',()=>{
  clearTimeout(debSug);
  const q=zi.value.trim();
  if(q.length<3){zs.style.display='none';return;}
  debSug=setTimeout(async()=>{
    try{
      const r=await fetch('/ban?q='+encodeURIComponent(q));
      const d=await r.json();
      if(!d.features?.length){zs.style.display='none';return;}
      zs.innerHTML=d.features.map(f=>'<div class="zsi" data-lat="'+f.geometry.coordinates[1]+'" data-lng="'+f.geometry.coordinates[0]+'" onclick="goTo(this)">'+f.properties.label+'</div>').join('');
      zs.style.display='block';
    }catch{zs.style.display='none';}
  },280);
});
zi.addEventListener('keydown',e=>{if(e.key==='Enter'){zs.style.display='none';doExtract();}});
document.addEventListener('click',e=>{if(!e.target.closest('.swrap'))zs.style.display='none';});

function goTo(el){
  map.setCenter({lat:parseFloat(el.dataset.lat),lng:parseFloat(el.dataset.lng)});
  map.setZoom(15);
  zs.style.display='none';
  setTimeout(doExtract,400);
}

function tog(btn){
  const c=btn.dataset.c;
  if(active.has(c)){active.delete(c);btn.classList.add('off');}
  else{active.add(c);btn.classList.remove('off');}
  refreshMarkers();
}

function st(msg,type){
  const b=document.getElementById('sbar');
  b.textContent=msg; b.className='sbar '+type; b.style.display=msg?'block':'none';
}

// ── EXTRACTION ────────────────────────────────────────────────────
async function doExtract(){
  if(!active.size){st('Sélectionnez au moins une classe','err');return;}
  const b=map.getBounds();
  if(!b){st('Carte non prête','err');return;}
  const sw=b.getSouthWest(), ne=b.getNorthEast();
  const bbox=sw.lng()+','+sw.lat()+','+ne.lng()+','+ne.lat();
  const classes=[...active].join(',');
  document.getElementById('xbtn').disabled=true;
  st('Extraction en cours...','load');
  document.getElementById('csvbtn').style.display='none';
  try{
    const r=await fetch('/api/extract?bbox='+encodeURIComponent(bbox)+'&classes='+encodeURIComponent(classes));
    const data=await r.json();
    document.getElementById('xbtn').disabled=false;
    if(data.error){st('Erreur: '+data.error,'err');return;}
    const rows=data.results||[];
    const seen=new Set(allPts.map(p=>p.num));
    let added=0;
    rows.forEach(row=>{
      const lat=parseFloat(row.latitude_ban||0), lng=parseFloat(row.longitude_ban||0);
      if(!lat||!lng)return;
      const num=row.numero_dpe||Math.random().toString();
      if(seen.has(num))return;
      seen.add(num); added++;
      allPts.push({
        lat,lng,
        cl:row.etiquette_dpe||'N',
        adresse:row.adresse_ban||'?',
        ges:row.etiquette_ges||'',
        conso:row.conso_5_usages_e_finale||0,
        gesv:row.emission_ges_5_usages||0,
        energie:row.type_energie_principale_chauffage||'',
        chauffage:row.type_installation_chauffage||'',
        annee:row.annee_construction||'',
        type:row.type_batiment||'',
        date:(row.date_etablissement_dpe||'').substring(0,10),
        num
      });
    });
    refreshMarkers();
    const total=data.total||rows.length;
    st(rows.length===0?'Aucun DPE trouvé dans cette zone.':'','load');
    if(rows.length)st('','load');
    document.getElementById('cnt').textContent=allPts.length+' DPE'+(total>rows.length?' ('+total+' total)':'');
    if(allPts.length)document.getElementById('csvbtn').style.display='inline-block';
  }catch(e){
    document.getElementById('xbtn').disabled=false;
    st('Erreur: '+e.message,'err');
  }
}

// ── Export CSV ────────────────────────────────────────────────────
function dlCSV(){
  const pts=allPts.filter(p=>active.has(p.cl));
  if(!pts.length)return;
  const cols=['adresse','cl','ges','conso','gesv','energie','chauffage','annee','type','date','num','lat','lng'];
  const labels=['Adresse','Classe DPE','Classe GES','Conso kWh/m2/an','Emissions kg/m2/an','Energie chauffage','Type chauffage','Annee construction','Type batiment','Date DPE','N DPE','Latitude','Longitude'];
  const csv=[labels.join(';'),...pts.map(p=>cols.map(k=>JSON.stringify(p[k]??'')).join(';'))].join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='dpe_extraction.csv';a.click();
}
<\/script>
<script src="https://maps.googleapis.com/maps/api/js?key=__GMKEY__&callback=initMap&loading=async" async defer><\/script>
</body></html>`;
