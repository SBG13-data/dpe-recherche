const http = require('http');
const https = require('https');
const { URL } = require('url');
const PORT = process.env.PORT || 3000;

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 DPE-App/1.0', 'Accept': '*/*', 'Referer': 'https://data.ademe.fr/' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
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

  // ── Proxy tuiles OSM (évite le CORS navigateur) ─────────────────
  if (path === '/tile') {
    const z = u.searchParams.get('z'), x = u.searchParams.get('x'), y = u.searchParams.get('y');
    if (!z || !x || !y) { res.writeHead(400); res.end(); return; }
    try {
      const sub = ['a','b','c'][(parseInt(x)+parseInt(y))%3];
      const r = await fetchUrl('https://'+sub+'.tile.openstreetmap.org/'+z+'/'+x+'/'+y+'.png');
      res.writeHead(r.status, {
        'Content-Type': r.headers['content-type'] || 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(r.body);
    } catch(e) { res.writeHead(500); res.end(); }
    return;
  }

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
      if (r.status === 200) { sendJSON(res, r.body.toString()); }
      else { sendJSON(res, JSON.stringify({ results: [], total: 0, _debug: 'HTTP ' + r.status + ': ' + r.body.toString().substring(0, 300) })); }
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
    header h1{font-size:1.9rem;font-weight:700}
    header p{color:#666;margin-top:.4rem;font-size:.95rem}
    .nav{display:flex;justify-content:center;gap:10px;margin-bottom:1.5rem}
    .nav a{padding:.6rem 1.4rem;border-radius:10px;font-size:.9rem;font-weight:600;text-decoration:none;background:white;color:#4361ee;border:1.5px solid #4361ee}
    .nav a.active,.nav a:hover{background:#4361ee;color:white}
    .card{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.5rem;position:relative}
    .row{display:flex;gap:10px}
    input[type=text]{flex:1;padding:.75rem 1rem;border:1.5px solid #e0e0e0;border-radius:10px;font-size:1rem;outline:none;background:#fafafa}
    input[type=text]:focus{border-color:#4361ee;background:white}
    .btn{padding:.75rem 1.4rem;background:#4361ee;color:white;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer;white-space:nowrap}
    .btn:hover{background:#3451d1} .btn:disabled{background:#aab4e8;cursor:not-allowed}
    #suggestions{position:absolute;left:1.5rem;right:1.5rem;top:calc(100% - .5rem);background:white;border:1.5px solid #e0e0e0;border-radius:10px;z-index:100;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
    .sug{padding:11px 16px;font-size:.9rem;cursor:pointer;border-bottom:1px solid #f0f0f0}
    .sug:hover{background:#f0f4ff;color:#4361ee}
    #status{margin-top:1rem;padding:.75rem 1rem;border-radius:10px;font-size:.9rem;display:none}
    .sl{background:#f0f4ff;color:#4361ee;display:flex!important;align-items:center;gap:8px}
    .se{background:#fff0f0;color:#c0392b;display:block!important}
    .spin{width:16px;height:16px;border:2px solid #b8c6ff;border-top-color:#4361ee;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    #multi{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.5rem;display:none}
    .mi{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid #e8e8e8;border-radius:10px;cursor:pointer;margin-bottom:8px}
    .mi:hover{border-color:#4361ee;background:#f0f4ff}
    #result{display:none}
    .rh{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.2rem;display:flex;align-items:center;gap:16px}
    .badge{width:64px;height:64px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;flex-shrink:0}
    .A{background:#b7e4c7;color:#1b4332}.B{background:#d8f3dc;color:#1b4332}.C{background:#d9ed92;color:#386641}.D{background:#fff3b0;color:#7b5e00}.E{background:#ffd6a5;color:#7a3500}.F{background:#ffb3b3;color:#7a0000}.G{background:#ff6b6b;color:#4a0000}.N{background:#e8e8e8;color:#666}
    .rhi h2{font-size:1.1rem;font-weight:600;margin-bottom:4px} .rhi p{font-size:.85rem;color:#888}
    .st{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:.75rem}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:10px;margin-bottom:1.2rem}
    .ic{background:white;border-radius:12px;padding:1rem;box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .ic .l{font-size:.7rem;font-weight:600;text-transform:uppercase;color:#aaa;margin-bottom:5px}
    .ic .v{font-size:1rem;font-weight:700;color:#1a1a2e}
    .eg{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px;margin-bottom:1.2rem}
    .ec{background:white;border-radius:12px;padding:1rem;box-shadow:0 2px 8px rgba(0,0,0,.06);border-left:4px solid #4361ee}
    .ec .l{font-size:.7rem;font-weight:600;text-transform:uppercase;color:#aaa;margin-bottom:5px}
    .ec .v{font-size:.9rem;font-weight:600;color:#1a1a2e;line-height:1.4}
    .sc{display:flex;gap:4px;margin-top:8px} .si{flex:1;height:6px;border-radius:3px;opacity:.25} .si.on{opacity:1}
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
    <div id="suggestions"></div>
    <div id="status"></div>
  </div>
  <div id="multi"><h3 style="font-size:1rem;color:#555;margin-bottom:1rem">Plusieurs DPE — choisissez :</h3><div id="ml"></div></div>
  <div class="nodpe" id="nodpe"><p>❌ Aucun DPE trouvé pour cette adresse.</p></div>
  <div id="result">
    <div class="rh"><div id="db" class="badge N">?</div><div class="rhi"><h2 id="ad"></h2><p id="dm"></p><div class="sc" id="sc"></div></div></div>
    <p class="st">⚡ Performance</p><div class="grid" id="pg"></div>
    <p class="st">🔧 Équipements</p><div class="eg" id="eg"></div>
    <p class="st">🏗️ Logement</p><div class="grid" id="lg"></div>
    <div class="src">Données ADEME · Licence Ouverte Etalab</div>
  </div>
</div>
<script>
const CC={A:'#b7e4c7',B:'#d8f3dc',C:'#d9ed92',D:'#fff3b0',E:'#ffd6a5',F:'#ffb3b3',G:'#ff6b6b'};
let t;const ai=document.getElementById('ai'),sg=document.getElementById('suggestions');
ai.addEventListener('input',()=>{clearTimeout(t);const q=ai.value.trim();if(q.length<4){sg.style.display='none';return;}t=setTimeout(()=>fs(q),280);});
ai.addEventListener('keydown',e=>{if(e.key==='Enter')go();if(e.key==='Escape')sg.style.display='none';});
document.addEventListener('click',e=>{if(!e.target.closest('.card'))sg.style.display='none';});
async function fs(q){try{const r=await fetch('/ban?q='+encodeURIComponent(q));const d=await r.json();if(!d.features?.length){sg.style.display='none';return;}sg.innerHTML=d.features.map(f=>'<div class="sug" onclick="pk(\''+f.properties.label.replace(/'/g,"\\'")+'\')">'+f.properties.label+'</div>').join('');sg.style.display='block';}catch{sg.style.display='none';}}
function pk(l){ai.value=l;sg.style.display='none';go();}
function ss(m,t){const e=document.getElementById('status');if(!m){e.style.display='none';return;}e.innerHTML=t==='l'?'<span class="spin"></span>'+m:m;e.className=t==='l'?'sl':'se';e.style.display=t==='l'?'flex':'block';}
function ha(){['result','multi','nodpe'].forEach(i=>document.getElementById(i).style.display='none');ss('','');}
async function go(){const a=ai.value.trim();if(!a)return;sg.style.display='none';ha();document.getElementById('sb').disabled=true;ss('Interrogation ADEME...','l');try{const r=await fetch('/dpe?q='+encodeURIComponent(a));const d=await r.json();ss('','');document.getElementById('sb').disabled=false;if(d.error)throw new Error(d.error);if(!d.results?.length){document.getElementById('nodpe').style.display='block';return;}d.results.length===1?rd(d.results[0]):sm(d.results);}catch(e){ss('Erreur : '+e.message,'e');document.getElementById('sb').disabled=false;}}
function sm(R){window._r=R;document.getElementById('ml').innerHTML=R.map((r,i)=>{const cl=r.etiquette_dpe||'N';const dt=(r.date_etablissement_dpe||'').substring(0,10);const sf=r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+'m²':'';return '<div class="mi" onclick="rd(window._r['+i+'])"><span class="badge '+cl+'" style="width:40px;height:40px;font-size:1.2rem;">'+cl+'</span><div><b style="font-size:.9rem">'+(r.adresse_ban||'')+'</b><br><span style="font-size:.8rem;color:#888">'+(dt?'DPE du '+dt:'')+(sf?' · '+sf:'')+'</span></div></div>';}).join('');document.getElementById('multi').style.display='block';}
function rd(r){document.getElementById('multi').style.display='none';const cl=r.etiquette_dpe||'N';const b=document.getElementById('db');b.textContent=cl==='N'?'?':cl;b.className='badge '+cl;document.getElementById('ad').textContent=r.adresse_ban||ai.value;const dt=(r.date_etablissement_dpe||'').substring(0,10);document.getElementById('dm').textContent=(dt?'DPE établi le '+dt:'')+(r.numero_dpe?' · N°'+r.numero_dpe:'');document.getElementById('sc').innerHTML=['A','B','C','D','E','F','G'].map(c=>'<div class="si '+(c===cl?'on':'')+'" style="background:'+(CC[c]||'#ccc')+'"></div>').join('');const cn=r.consommation_energie||r.conso_5_usages_e_finale,gs=r.emission_ges||r.emission_ges_5_usages;
document.getElementById('pg').innerHTML=[{l:'Classe énergie',v:cl!=='N'?cl:'N/A'},{l:'Classe GES',v:r.etiquette_ges||'N/A'},{l:'Consommation',v:cn?Math.round(cn)+' kWh/m²/an':'N/A'},{l:'Émissions CO₂',v:gs?Math.round(gs)+' kg/m²/an':'N/A'}].map(c=>'<div class="ic"><div class="l">'+c.l+'</div><div class="v">'+c.v+'</div></div>').join('');
document.getElementById('eg').innerHTML=[{l:'Chauffage',v:r.type_installation_chauffage||'N/A'},{l:'Énergie chauffage',v:r.type_energie_principale_chauffage||'N/A'},{l:'Eau chaude',v:r.type_installation_ecs||'N/A'},{l:'Énergie ECS',v:r.type_energie_principale_ecs||'N/A'},{l:'Ventilation',v:r.type_ventilation||'N/A'}].map(e=>'<div class="ec"><div class="l">'+e.l+'</div><div class="v">'+e.v+'</div></div>').join('');
document.getElementById('lg').innerHTML=[{l:'Surface',v:r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+' m²':'N/A'},{l:'Année',v:r.annee_construction||'N/A'},{l:'Type',v:r.type_batiment||'N/A'},{l:'Niveaux',v:r.nombre_niveau_logement||'N/A'}].map(c=>'<div class="ic"><div class="l">'+c.l+'</div><div class="v">'+c.v+'</div></div>').join('');
document.getElementById('result').style.display='block';window.scrollTo({top:0,behavior:'smooth'});}
<\/script>
</body></html>`;

// ════════════════════════════════════════════════════════════════════
// PAGE 2 — CARTE LEAFLET via proxy tuiles
// ════════════════════════════════════════════════════════════════════
const HTML_EXTRACT = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Carte DPE</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif}
    body{display:flex;flex-direction:column;background:#f4f5f7}

    .bar{background:#1e2a4a;padding:.65rem 1rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;z-index:1000;border-bottom:1px solid #2d3a5e;flex-shrink:0}
    .bar h1{font-size:.95rem;font-weight:700;color:#fff;white-space:nowrap}
    .navl{padding:.35rem .8rem;border-radius:7px;font-size:.8rem;font-weight:600;text-decoration:none;background:#2d3a5e;color:#90b4ff;border:1px solid #3d4f7e;white-space:nowrap}
    .navl:hover{background:#3d4f7e;color:#fff}

    .swrap{position:relative;flex:1;min-width:140px;max-width:280px}
    #zi{width:100%;padding:.4rem .8rem;border:1px solid #3d4f7e;border-radius:7px;font-size:.83rem;outline:none;background:#2d3a5e;color:#fff}
    #zi::placeholder{color:#8899bb}
    #zi:focus{border-color:#4361ee}
    #zs{position:absolute;top:100%;left:0;right:0;background:#1e2a4a;border:1px solid #3d4f7e;border-radius:7px;z-index:3000;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.4);display:none;margin-top:2px}
    .zsi{padding:8px 12px;font-size:.8rem;cursor:pointer;border-bottom:1px solid #2d3a5e;color:#cdd8f0}
    .zsi:hover{background:#2d3a5e;color:#fff}

    .filters{display:flex;gap:3px;flex-shrink:0}
    .fb{padding:.32rem .58rem;border-radius:5px;font-size:.78rem;font-weight:700;cursor:pointer;border:2px solid transparent;transition:opacity .15s}
    .fb.off{opacity:.28}
    .fA{background:#b7e4c7;color:#1b4332}.fB{background:#d8f3dc;color:#1b4332}.fC{background:#d9ed92;color:#386641}
    .fD{background:#fff3b0;color:#7b5e00}.fE{background:#ffd6a5;color:#7a3500}.fF{background:#ffb3b3;color:#7a0000}.fG{background:#ff6b6b;color:#4a0000}

    .btn-x{padding:.4rem .9rem;background:#4361ee;color:white;border:none;border-radius:7px;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap}
    .btn-x:hover{background:#3451d1} .btn-x:disabled{background:#2d3a5e;color:#5a7aaa;cursor:not-allowed}
    .btn-csv{padding:.4rem .9rem;background:#1a6b3a;color:white;border:none;border-radius:7px;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap;display:none}
    .btn-csv:hover{background:#15552e}
    #cnt{font-size:.78rem;color:#90a8cc;white-space:nowrap;min-width:80px}

    .sbar{padding:.4rem 1rem;font-size:.8rem;text-align:center;display:none;flex-shrink:0}
    .sbar.load{background:#1a2a4a;color:#90b4ff} .sbar.err{background:#3a1a1a;color:#ff6b6b} .sbar.ok{background:#1a3a2a;color:#4caf7d}

    #map{flex:1;min-height:0;z-index:1}

    /* Leaflet styles inline */
    .leaflet-container{background:#e8e0d8}
    .leaflet-control-zoom a{background:#1e2a4a;color:#fff;border-color:#3d4f7e}
    .leaflet-control-zoom a:hover{background:#3d4f7e}

    /* Popup */
    .dpe-popup .leaflet-popup-content-wrapper{background:#1e2a4a;color:#cdd8f0;border:1px solid #3d4f7e;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.5)}
    .dpe-popup .leaflet-popup-tip{background:#1e2a4a}
    .dpe-popup .leaflet-popup-content{margin:10px 14px;font-size:.8rem;line-height:1.6}
    .popup-title{font-size:.88rem;font-weight:700;margin-bottom:6px;color:#fff}
    .popup-row{display:flex;justify-content:space-between;gap:12px;padding:2px 0;border-bottom:1px solid #2d3a5e}
    .popup-row:last-child{border:none}
    .popup-lbl{color:#8899bb;white-space:nowrap}
    .popup-val{font-weight:600;color:#cdd8f0;text-align:right}
    .dbadge{display:inline-block;padding:0 7px;border-radius:4px;font-weight:700;font-size:.9rem}

    #legend{position:absolute;left:12px;bottom:30px;background:rgba(30,42,74,.92);border:1px solid #3d4f7e;border-radius:8px;padding:.5rem .8rem;z-index:500;font-size:.72rem;color:#cdd8f0;pointer-events:none}
    #legend .li{display:flex;align-items:center;gap:5px;margin-bottom:2px}
    #legend .dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;border:1.5px solid rgba(0,0,0,.3)}
  </style>
  <!-- Leaflet CSS inline minimal -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
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
  <button class="btn-x" id="xbtn" onclick="doExtract()">🔍 Extraire zone</button>
  <button class="btn-csv" id="csvbtn" onclick="dlCSV()">⬇️ CSV</button>
  <span id="cnt"></span>
</div>
<div id="sbar" class="sbar"></div>
<div id="map"></div>
<div id="legend">
  <div class="li"><div class="dot" style="background:#b7e4c7"></div>A – Excellent</div>
  <div class="li"><div class="dot" style="background:#d8f3dc"></div>B – Très bon</div>
  <div class="li"><div class="dot" style="background:#d9ed92"></div>C – Bon</div>
  <div class="li"><div class="dot" style="background:#fff3b0"></div>D – Moyen</div>
  <div class="li"><div class="dot" style="background:#ffd6a5"></div>E – Médiocre</div>
  <div class="li"><div class="dot" style="background:#ffb3b3"></div>F – Mauvais</div>
  <div class="li"><div class="dot" style="background:#ff6b6b"></div>G – Passoire</div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""><\/script>
<script>
const DPE_COL={A:'#b7e4c7',B:'#d8f3dc',C:'#d9ed92',D:'#fff3b0',E:'#ffd6a5',F:'#ffb3b3',G:'#ff6b6b',N:'#aaa'};
const DPE_BDR={A:'#1b4332',B:'#1b4332',C:'#386641',D:'#7b5e00',E:'#e07800',F:'#c0392b',G:'#7c0000',N:'#555'};

// Carte Leaflet avec tuiles proxifiées par notre serveur
const map = L.map('map', {zoomControl:true}).setView([43.450, 5.477], 14);

L.tileLayer('/tile?z={z}&x={x}&y={y}', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

let markerLayer = L.layerGroup().addTo(map);
let allPts = [];
let active = new Set(['A','B','C','D','E','F','G']);
let debSug;

// Recherche adresse
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
  map.setView([parseFloat(el.dataset.lat),parseFloat(el.dataset.lng)],15);
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

function makeIcon(cl){
  const col=DPE_COL[cl]||'#aaa', bdr=DPE_BDR[cl]||'#555';
  return L.divIcon({
    html:'<div style="width:13px;height:13px;border-radius:50%;background:'+col+';border:2px solid '+bdr+';box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
    iconSize:[13,13], iconAnchor:[6,6], className:''
  });
}

function makePopup(p){
  const cl=p.cl||'?', col=DPE_COL[cl]||'#eee', bdr=DPE_BDR[cl]||'#555';
  return '<div class="popup-title">📍 '+p.adresse+'</div>'+[
    ['Classe DPE','<span class="dbadge" style="background:'+col+';color:'+bdr+'">'+cl+'</span>'],
    ['Classe GES',p.ges||'N/A'],
    ['Consommation',p.conso?Math.round(p.conso)+' kWh/m²/an':'N/A'],
    ['Émissions CO₂',p.gesv?Math.round(p.gesv)+' kg/m²/an':'N/A'],
    ['Énergie chauffage',p.energie||'N/A'],
    ['Année construction',p.annee||'N/A'],
    ['Type bâtiment',p.type||'N/A'],
    ['Date DPE',p.date||'N/A'],
    ['N° DPE',p.num||'N/A'],
  ].map(([l,v])=>'<div class="popup-row"><span class="popup-lbl">'+l+'</span><span class="popup-val">'+v+'</span></div>').join('');
}

function refreshMarkers(){
  markerLayer.clearLayers();
  allPts.forEach(p=>{
    if(!active.has(p.cl))return;
    const m=L.marker([p.lat,p.lng],{icon:makeIcon(p.cl)});
    m.bindPopup(makePopup(p),{className:'dpe-popup',maxWidth:260});
    markerLayer.addLayer(m);
  });
}

async function doExtract(){
  if(!active.size){st('Sélectionnez au moins une classe','err');return;}
  const b=map.getBounds();
  const bbox=b.getWest()+','+b.getSouth()+','+b.getEast()+','+b.getNorth();
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
    // Dédupliquer
    const seen=new Set(allPts.map(p=>p.num));
    rows.forEach(row=>{
      const lat=parseFloat(row.latitude_ban||0), lng=parseFloat(row.longitude_ban||0);
      if(!lat||!lng)return;
      const num=row.numero_dpe||'';
      if(seen.has(num))return;
      seen.add(num);
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
    st(!rows.length?'Aucun DPE dans cette zone visible.':'','ok');
    if(rows.length) st('','ok');
    document.getElementById('cnt').textContent=allPts.length+' DPE'+(total>rows.length?' ('+total+' total)':'');
    if(allPts.length) document.getElementById('csvbtn').style.display='inline-block';
  }catch(e){
    document.getElementById('xbtn').disabled=false;
    st('Erreur: '+e.message,'err');
  }
}

function dlCSV(){
  if(!allPts.length)return;
  const cols=['adresse','cl','ges','conso','gesv','energie','chauffage','annee','type','date','num','lat','lng'];
  const labels=['Adresse','Classe DPE','Classe GES','Conso kWh/m2/an','Emissions kg/m2/an','Energie chauffage','Type chauffage','Annee construction','Type batiment','Date DPE','N DPE','Latitude','Longitude'];
  const pts=allPts.filter(p=>active.has(p.cl));
  const csv=[labels.join(';'),...pts.map(p=>cols.map(k=>JSON.stringify(p[k]??'')).join(';'))].join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='dpe_extraction.csv';a.click();
}
<\/script>
</body></html>`;
