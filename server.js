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

  if (path === '/api/extract') {
    const bbox    = u.searchParams.get('bbox') || '';
    const classes = u.searchParams.get('classes') || 'A,B,C,D,E,F,G';
    const page    = parseInt(u.searchParams.get('page') || '1');
    if (!bbox) { sendError(res, 'bbox requis'); return; }

    // Dataset récent dpe03existant — filtre etiquette_dpe_in
    const apiUrl = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?' +
      'bbox=' + encodeURIComponent(bbox) +
      '&etiquette_dpe_in=' + encodeURIComponent(classes) +
      '&page=' + page + '&size=500&sort=-date_etablissement_dpe' +
      '&select=adresse_ban,etiquette_dpe,etiquette_ges,conso_5_usages_e_finale,emission_ges_5_usages,annee_construction,longitude_ban,latitude_ban,date_etablissement_dpe,numero_dpe,type_batiment,type_energie_principale_chauffage,type_installation_chauffage';

    try {
      const r = await fetchUrl(apiUrl);
      if (r.status === 200) {
        sendJSON(res, r.body);
      } else {
        sendJSON(res, JSON.stringify({ results: [], total: 0, _debug: 'HTTP ' + r.status + ': ' + r.body.substring(0, 300) }));
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
    .btn:hover{background:#3451d1}
    .btn:disabled{background:#aab4e8;cursor:not-allowed}
    #suggestions{position:absolute;left:1.5rem;right:1.5rem;top:calc(100% - .5rem);background:white;border:1.5px solid #e0e0e0;border-radius:10px;z-index:100;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
    .sug{padding:11px 16px;font-size:.9rem;cursor:pointer;border-bottom:1px solid #f0f0f0}
    .sug:hover{background:#f0f4ff;color:#4361ee}
    #status{margin-top:1rem;padding:.75rem 1rem;border-radius:10px;font-size:.9rem;display:none}
    .s-load{background:#f0f4ff;color:#4361ee;display:flex!important;align-items:center;gap:8px}
    .s-err{background:#fff0f0;color:#c0392b;display:block!important}
    .spin{width:16px;height:16px;border:2px solid #b8c6ff;border-top-color:#4361ee;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    #multi{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.5rem;display:none}
    .mitem{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid #e8e8e8;border-radius:10px;cursor:pointer;margin-bottom:8px}
    .mitem:hover{border-color:#4361ee;background:#f0f4ff}
    #result{display:none}
    .rh{background:white;border-radius:16px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:1.2rem;display:flex;align-items:center;gap:16px}
    .badge{width:64px;height:64px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;flex-shrink:0}
    .A{background:#b7e4c7;color:#1b4332}.B{background:#d8f3dc;color:#1b4332}.C{background:#d9ed92;color:#386641}.D{background:#fff3b0;color:#7b5e00}.E{background:#ffd6a5;color:#7a3500}.F{background:#ffb3b3;color:#7a0000}.G{background:#ff6b6b;color:#4a0000}.N{background:#e8e8e8;color:#666}
    .rhi h2{font-size:1.1rem;font-weight:600;margin-bottom:4px}
    .rhi p{font-size:.85rem;color:#888}
    .st{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:.75rem}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:10px;margin-bottom:1.2rem}
    .ic{background:white;border-radius:12px;padding:1rem;box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .ic .l{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#aaa;margin-bottom:5px}
    .ic .v{font-size:1rem;font-weight:700;color:#1a1a2e}
    .egrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px;margin-bottom:1.2rem}
    .ec{background:white;border-radius:12px;padding:1rem;box-shadow:0 2px 8px rgba(0,0,0,.06);border-left:4px solid #4361ee}
    .ec .l{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#aaa;margin-bottom:5px}
    .ec .v{font-size:.9rem;font-weight:600;color:#1a1a2e;line-height:1.4}
    .scale{display:flex;gap:4px;margin-top:8px}
    .si{flex:1;height:6px;border-radius:3px;opacity:.25}
    .si.on{opacity:1}
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
  <div id="multi"><h3 style="font-size:1rem;color:#555;margin-bottom:1rem">Plusieurs DPE trouvés :</h3><div id="ml"></div></div>
  <div class="nodpe" id="nodpe"><p>❌ Aucun DPE trouvé pour cette adresse.</p></div>
  <div id="result">
    <div class="rh"><div id="db" class="badge N">?</div><div class="rhi"><h2 id="ad"></h2><p id="dm"></p><div class="scale" id="sc"></div></div></div>
    <p class="st">⚡ Performance</p><div class="grid" id="pg"></div>
    <p class="st">🔧 Équipements</p><div class="egrid" id="eg"></div>
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
function ss(m,t){const e=document.getElementById('status');if(!m){e.style.display='none';return;}e.innerHTML=t==='l'?'<span class="spin"></span>'+m:m;e.className=t==='l'?'s-load':'s-err';e.style.display=t==='l'?'flex':'block';}
function ha(){['result','multi','nodpe'].forEach(i=>document.getElementById(i).style.display='none');ss('','');}
async function go(){const a=ai.value.trim();if(!a)return;sg.style.display='none';ha();document.getElementById('sb').disabled=true;ss('Interrogation ADEME...','l');try{const r=await fetch('/dpe?q='+encodeURIComponent(a));const d=await r.json();ss('','');document.getElementById('sb').disabled=false;if(d.error)throw new Error(d.error);if(!d.results?.length){document.getElementById('nodpe').style.display='block';return;}d.results.length===1?rd(d.results[0]):sm(d.results);}catch(e){ss('Erreur : '+e.message,'e');document.getElementById('sb').disabled=false;}}
function sm(R){window._r=R;document.getElementById('ml').innerHTML=R.map((r,i)=>{const cl=r.etiquette_dpe||'N';const dt=(r.date_etablissement_dpe||'').substring(0,10);const sf=r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+'m²':'';return '<div class="mitem" onclick="rd(window._r['+i+'])"><span class="badge '+cl+'" style="width:40px;height:40px;font-size:1.2rem;">'+cl+'</span><div><b style="font-size:.9rem">'+(r.adresse_ban||'')+'</b><br><span style="font-size:.8rem;color:#888">'+(dt?'DPE du '+dt:'')+(sf?' · '+sf:'')+'</span></div></div>';}).join('');document.getElementById('multi').style.display='block';}
function rd(r){document.getElementById('multi').style.display='none';const cl=r.etiquette_dpe||'N';const b=document.getElementById('db');b.textContent=cl==='N'?'?':cl;b.className='badge '+cl;document.getElementById('ad').textContent=r.adresse_ban||ai.value;const dt=(r.date_etablissement_dpe||'').substring(0,10);document.getElementById('dm').textContent=(dt?'DPE établi le '+dt:'')+(r.numero_dpe?' · N°'+r.numero_dpe:'');document.getElementById('sc').innerHTML=['A','B','C','D','E','F','G'].map(c=>'<div class="si '+(c===cl?'on':'')+'" style="background:'+(CC[c]||'#ccc')+'"></div>').join('');const cn=r.consommation_energie||r.conso_5_usages_e_finale,gs=r.emission_ges||r.emission_ges_5_usages;
document.getElementById('pg').innerHTML=[{l:'Classe énergie',v:cl!=='N'?cl:'N/A'},{l:'Classe GES',v:r.etiquette_ges||'N/A'},{l:'Consommation',v:cn?Math.round(cn)+' kWh/m²/an':'N/A'},{l:'Émissions CO₂',v:gs?Math.round(gs)+' kg/m²/an':'N/A'}].map(c=>'<div class="ic"><div class="l">'+c.l+'</div><div class="v">'+c.v+'</div></div>').join('');
document.getElementById('eg').innerHTML=[{l:'Chauffage',v:r.type_installation_chauffage||'N/A'},{l:'Énergie chauffage',v:r.type_energie_principale_chauffage||'N/A'},{l:'Eau chaude',v:r.type_installation_ecs||'N/A'},{l:'Énergie ECS',v:r.type_energie_principale_ecs||'N/A'},{l:'Ventilation',v:r.type_ventilation||'N/A'}].map(e=>'<div class="ec"><div class="l">'+e.l+'</div><div class="v">'+e.v+'</div></div>').join('');
document.getElementById('lg').innerHTML=[{l:'Surface',v:r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+' m²':'N/A'},{l:'Année',v:r.annee_construction||'N/A'},{l:'Type',v:r.type_batiment||'N/A'},{l:'Niveaux',v:r.nombre_niveau_logement||'N/A'}].map(c=>'<div class="ic"><div class="l">'+c.l+'</div><div class="v">'+c.v+'</div></div>').join('');
document.getElementById('result').style.display='block';window.scrollTo({top:0,behavior:'smooth'});}
<\/script>
</body></html>`;

// ════════════════════════════════════════════════════════════════════
// PAGE 2 — CARTE & EXTRACTION (TOUS LES DPE)
// ════════════════════════════════════════════════════════════════════
const HTML_EXTRACT = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Carte DPE</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;overflow:hidden}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#1a1a2e;color:#fff;display:flex;flex-direction:column}

    /* ── TOPBAR ── */
    .bar{background:#1e2a4a;padding:.75rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;z-index:500;border-bottom:1px solid #2d3a5e}
    .bar h1{font-size:1rem;font-weight:700;white-space:nowrap;color:#fff}
    .navl{padding:.4rem .9rem;border-radius:7px;font-size:.82rem;font-weight:600;text-decoration:none;background:#2d3a5e;color:#90b4ff;border:1px solid #3d4f7e}
    .navl:hover{background:#3d4f7e;color:#fff}

    /* Recherche */
    .swrap{position:relative;flex:1;min-width:160px;max-width:320px}
    #zi{width:100%;padding:.45rem .85rem;border:1px solid #3d4f7e;border-radius:7px;font-size:.85rem;outline:none;background:#2d3a5e;color:#fff}
    #zi::placeholder{color:#8899bb}
    #zi:focus{border-color:#4361ee}
    #zs{position:absolute;top:100%;left:0;right:0;background:#1e2a4a;border:1px solid #3d4f7e;border-radius:7px;z-index:2000;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.4);display:none;margin-top:2px}
    .zsi{padding:8px 13px;font-size:.82rem;cursor:pointer;border-bottom:1px solid #2d3a5e;color:#cdd8f0}
    .zsi:hover{background:#2d3a5e;color:#fff}

    /* Filtres DPE */
    .filters{display:flex;gap:4px}
    .fb{padding:.35rem .65rem;border-radius:6px;font-size:.8rem;font-weight:700;cursor:pointer;border:2px solid transparent;transition:all .15s;opacity:1}
    .fb.off{opacity:.3}
    .fA{background:#b7e4c7;color:#1b4332;border-color:#b7e4c7}.fB{background:#d8f3dc;color:#1b4332;border-color:#d8f3dc}.fC{background:#d9ed92;color:#386641;border-color:#d9ed92}.fD{background:#fff3b0;color:#7b5e00;border-color:#fff3b0}.fE{background:#ffd6a5;color:#7a3500;border-color:#ffd6a5}.fF{background:#ffb3b3;color:#7a0000;border-color:#ffb3b3}.fG{background:#ff6b6b;color:#4a0000;border-color:#ff6b6b}

    /* Boutons */
    .btn-ext{padding:.45rem 1rem;background:#4361ee;color:white;border:none;border-radius:7px;font-size:.85rem;font-weight:600;cursor:pointer;white-space:nowrap}
    .btn-ext:hover{background:#3451d1}
    .btn-ext:disabled{background:#2d3a5e;color:#5a7aaa;cursor:not-allowed}
    .btn-csv{padding:.45rem 1rem;background:#1a6b3a;color:white;border:none;border-radius:7px;font-size:.85rem;font-weight:600;cursor:pointer;display:none}
    .btn-csv:hover{background:#15552e}
    #cnt{font-size:.8rem;color:#90a8cc;white-space:nowrap}

    /* Statut */
    .sbar{padding:.5rem 1rem;font-size:.82rem;text-align:center;display:none}
    .sbar.ok{background:#1a3a2a;color:#4caf7d}
    .sbar.err{background:#3a1a1a;color:#ff6b6b}
    .sbar.load{background:#1a2a4a;color:#90b4ff}

    /* CARTE — SVG pur, pas de Leaflet */
    #mapwrap{flex:1;position:relative;overflow:hidden;background:#0d1321;cursor:grab}
    #mapwrap:active{cursor:grabbing}
    #mapsvg{width:100%;height:100%;display:block}

    /* Tiles fond */
    #tiles{pointer-events:none}

    /* Panneau latéral */
    #panel{position:absolute;right:12px;top:12px;width:270px;background:#1e2a4a;border:1px solid #3d4f7e;border-radius:12px;padding:1rem;z-index:400;display:none;box-shadow:0 8px 32px rgba(0,0,0,.5);max-height:80vh;overflow-y:auto}
    #panel h3{font-size:.9rem;font-weight:600;margin-bottom:.75rem;color:#cdd8f0}
    .pr{display:flex;justify-content:space-between;font-size:.78rem;padding:4px 0;border-bottom:1px solid #2d3a5e}
    .pr:last-child{border:none}
    .pl{color:#8899bb}
    .pv{font-weight:600;color:#cdd8f0;text-align:right;max-width:160px;word-break:break-word}
    .close-btn{position:absolute;top:8px;right:10px;background:none;border:none;color:#8899bb;font-size:1.1rem;cursor:pointer}
    .close-btn:hover{color:#fff}
    .dbadge{display:inline-block;padding:1px 8px;border-radius:5px;font-weight:700}

    /* Légende */
    #legend{position:absolute;left:12px;bottom:12px;background:#1e2a4a;border:1px solid #3d4f7e;border-radius:8px;padding:.6rem .9rem;z-index:400;font-size:.75rem;color:#cdd8f0}
    #legend .li{display:flex;align-items:center;gap:6px;margin-bottom:3px}
    #legend .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}

    /* Zoom controls */
    .zoom-ctrl{position:absolute;right:12px;bottom:60px;z-index:400;display:flex;flex-direction:column;gap:3px}
    .zoom-ctrl button{width:32px;height:32px;background:#1e2a4a;border:1px solid #3d4f7e;border-radius:6px;color:#fff;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .zoom-ctrl button:hover{background:#3d4f7e}
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
  <div class="filters" id="filters">
    <button class="fb fA" data-c="A" onclick="tog(this)">A</button>
    <button class="fb fB" data-c="B" onclick="tog(this)">B</button>
    <button class="fb fC" data-c="C" onclick="tog(this)">C</button>
    <button class="fb fD" data-c="D" onclick="tog(this)">D</button>
    <button class="fb fE" data-c="E" onclick="tog(this)">E</button>
    <button class="fb fF" data-c="F" onclick="tog(this)">F</button>
    <button class="fb fG" data-c="G" onclick="tog(this)">G</button>
  </div>
  <button class="btn-ext" id="xbtn" onclick="doExtract()">🔍 Extraire zone</button>
  <button class="btn-csv" id="csvbtn" onclick="dlCSV()">⬇️ CSV</button>
  <span id="cnt"></span>
</div>

<div id="sbar" class="sbar"></div>

<div id="mapwrap">
  <canvas id="tileCanvas" style="position:absolute;top:0;left:0;pointer-events:none"></canvas>
  <canvas id="dotCanvas" style="position:absolute;top:0;left:0;pointer-events:none"></canvas>
  <div id="panel">
    <button class="close-btn" onclick="document.getElementById('panel').style.display='none'">✕</button>
    <h3 id="pa"></h3>
    <div id="pb"></div>
  </div>
  <div id="legend">
    <div class="li"><div class="dot" style="background:#b7e4c7"></div>A – Excellent</div>
    <div class="li"><div class="dot" style="background:#d9ed92"></div>C – Bon</div>
    <div class="li"><div class="dot" style="background:#fff3b0"></div>D – Moyen</div>
    <div class="li"><div class="dot" style="background:#ffd6a5"></div>E – Médiocre</div>
    <div class="li"><div class="dot" style="background:#ffb3b3"></div>F – Mauvais</div>
    <div class="li"><div class="dot" style="background:#ff6b6b"></div>G – Passoire</div>
  </div>
  <div class="zoom-ctrl">
    <button onclick="zoom(1)">+</button>
    <button onclick="zoom(-1)">−</button>
  </div>
</div>

<script>
// ── Projection Web Mercator ──────────────────────────────────────
const DPE_COL={A:'#b7e4c7',B:'#d8f3dc',C:'#d9ed92',D:'#fff3b0',E:'#ffd6a5',F:'#ffb3b3',G:'#ff6b6b',N:'#aaa'};
const DPE_BDR={A:'#1b4332',B:'#1b4332',C:'#386641',D:'#7b5e00',E:'#e07800',F:'#c0392b',G:'#7c0000',N:'#555'};

let viewLat=43.450, viewLng=5.477, zoomLevel=14;
let allPts=[];
let active=new Set(['A','B','C','D','E','F','G']);
let isDragging=false, dragStart={x:0,y:0}, dragOrigin={lat:0,lng:0};
let tileCache={};

const wrap=document.getElementById('mapwrap');
const tCanvas=document.getElementById('tileCanvas');
const dCanvas=document.getElementById('dotCanvas');
const tCtx=tCanvas.getContext('2d');
const dCtx=dCanvas.getContext('2d');

function resize(){
  const w=wrap.clientWidth,h=wrap.clientHeight;
  tCanvas.width=dCanvas.width=w;
  tCanvas.height=dCanvas.height=h;
  drawTiles();drawDots();
}
window.addEventListener('resize',resize);
setTimeout(resize,50);

// ── Conversion lat/lng <-> pixels ───────────────────────────────
function tileXY(lat,lng,z){
  const n=Math.pow(2,z);
  const x=Math.floor((lng+180)/360*n);
  const latR=lat*Math.PI/180;
  const y=Math.floor((1-Math.log(Math.tan(latR)+1/Math.cos(latR))/Math.PI)/2*n);
  return {x,y};
}
function latLngToPixel(lat,lng){
  const W=tCanvas.width,H=tCanvas.height;
  const n=Math.pow(2,zoomLevel);
  const cx=(viewLng+180)/360*n;
  const latR=viewLat*Math.PI/180;
  const cy=(1-Math.log(Math.tan(latR)+1/Math.cos(latR))/Math.PI)/2*n;
  const tileSize=256;
  const px=(((lng+180)/360*n)-cx)*tileSize+W/2;
  const latR2=lat*Math.PI/180;
  const py=((1-Math.log(Math.tan(latR2)+1/Math.cos(latR2))/Math.PI)/2*n-cy)*tileSize+H/2;
  return {x:px,y:py};
}
function pixelToLatLng(px,py){
  const W=tCanvas.width,H=tCanvas.height;
  const n=Math.pow(2,zoomLevel);
  const tileSize=256;
  const latR=viewLat*Math.PI/180;
  const cy=(1-Math.log(Math.tan(latR)+1/Math.cos(latR))/Math.PI)/2*n;
  const cx=(viewLng+180)/360*n;
  const tx=(px-W/2)/tileSize+cx;
  const ty=(py-H/2)/tileSize+cy;
  const lng=tx/n*360-180;
  const latR2=Math.atan(Math.sinh(Math.PI*(1-2*ty/n)));
  const lat=latR2*180/Math.PI;
  return {lat,lng};
}

// ── Tiles OSM ───────────────────────────────────────────────────
function drawTiles(){
  const W=tCanvas.width,H=tCanvas.height;
  tCtx.fillStyle='#0d1321';
  tCtx.fillRect(0,0,W,H);
  const n=Math.pow(2,zoomLevel);
  const tileSize=256;
  const latR=viewLat*Math.PI/180;
  const cy=(1-Math.log(Math.tan(latR)+1/Math.cos(latR))/Math.PI)/2*n;
  const cx=(viewLng+180)/360*n;
  const startX=Math.floor(cx-W/2/tileSize);
  const startY=Math.floor(cy-H/2/tileSize);
  const endX=Math.ceil(cx+W/2/tileSize);
  const endY=Math.ceil(cy+H/2/tileSize);
  for(let tx=startX;tx<=endX;tx++){
    for(let ty=startY;ty<=endY;ty++){
      const ttx=(tx%n+n)%n;
      const tty=Math.max(0,Math.min(n-1,ty));
      const key=zoomLevel+'/'+ttx+'/'+tty;
      const px=(tx-cx)*tileSize+W/2;
      const py=(ty-cy)*tileSize+H/2;
      if(tileCache[key]&&tileCache[key].complete){
        tCtx.drawImage(tileCache[key],px,py,tileSize,tileSize);
      } else if(!tileCache[key]){
        const img=new Image();
        const sub=['a','b','c'][Math.abs(tx+ty)%3];
        img.src='https://'+sub+'.tile.openstreetmap.org/'+zoomLevel+'/'+ttx+'/'+tty+'.png';
        img.crossOrigin='anonymous';
        img.onload=()=>{tileCache[key]=img;drawTiles();};
        tileCache[key]=img;
      }
    }
  }
}

// ── Points DPE ──────────────────────────────────────────────────
function drawDots(){
  const W=dCanvas.width,H=dCanvas.height;
  dCtx.clearRect(0,0,W,H);
  allPts.forEach(p=>{
    if(!active.has(p.cl))return;
    const {x,y}=latLngToPixel(p.lat,p.lng);
    if(x<-10||x>W+10||y<-10||y>H+10)return;
    dCtx.beginPath();
    dCtx.arc(x,y,6,0,Math.PI*2);
    dCtx.fillStyle=DPE_COL[p.cl]||'#aaa';
    dCtx.fill();
    dCtx.strokeStyle=DPE_BDR[p.cl]||'#555';
    dCtx.lineWidth=1.5;
    dCtx.stroke();
  });
}

// ── Navigation carte ────────────────────────────────────────────
wrap.addEventListener('mousedown',e=>{
  if(e.target.closest('#panel')||e.target.closest('.zoom-ctrl'))return;
  isDragging=true;
  dragStart={x:e.clientX,y:e.clientY};
  dragOrigin={lat:viewLat,lng:viewLng};
});
window.addEventListener('mousemove',e=>{
  if(!isDragging)return;
  const dx=e.clientX-dragStart.x, dy=e.clientY-dragStart.y;
  const n=Math.pow(2,zoomLevel);
  const tileSize=256;
  const dLng=-(dx/tileSize/n)*360;
  const latR=dragOrigin.lat*Math.PI/180;
  const cy=(1-Math.log(Math.tan(latR)+1/Math.cos(latR))/Math.PI)/2*n;
  const newCy=cy-dy/tileSize;
  const newLatR=Math.atan(Math.sinh(Math.PI*(1-2*newCy/n)));
  viewLat=Math.max(-85,Math.min(85,newLatR*180/Math.PI));
  viewLng=dragOrigin.lng+dLng;
  drawTiles();drawDots();
});
window.addEventListener('mouseup',()=>{isDragging=false;});
wrap.addEventListener('wheel',e=>{
  e.preventDefault();
  const delta=e.deltaY>0?-1:1;
  zoom(delta);
},{passive:false});

// Touch
let lastTouch=null;
wrap.addEventListener('touchstart',e=>{
  if(e.touches.length===1){isDragging=true;dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};dragOrigin={lat:viewLat,lng:viewLng};}
},{passive:true});
wrap.addEventListener('touchmove',e=>{
  if(!isDragging||e.touches.length!==1)return;
  const dx=e.touches[0].clientX-dragStart.x, dy=e.touches[0].clientY-dragStart.y;
  const n=Math.pow(2,zoomLevel);const tileSize=256;
  const dLng=-(dx/tileSize/n)*360;
  const latR=dragOrigin.lat*Math.PI/180;
  const cy=(1-Math.log(Math.tan(latR)+1/Math.cos(latR))/Math.PI)/2*n;
  const newCy=cy-dy/tileSize;
  const newLatR=Math.atan(Math.sinh(Math.PI*(1-2*newCy/n)));
  viewLat=Math.max(-85,Math.min(85,newLatR*180/Math.PI));
  viewLng=dragOrigin.lng+dLng;
  drawTiles();drawDots();
},{passive:true});
wrap.addEventListener('touchend',()=>{isDragging=false;});

function zoom(delta){
  zoomLevel=Math.max(10,Math.min(18,zoomLevel+delta));
  tileCache={};drawTiles();drawDots();
}

// Click sur point
dCanvas.addEventListener('click',e=>{
  if(isDragging)return;
  const rect=dCanvas.getBoundingClientRect();
  const mx=e.clientX-rect.left, my=e.clientY-rect.top;
  let best=null, bestD=100;
  allPts.forEach(p=>{
    if(!active.has(p.cl))return;
    const {x,y}=latLngToPixel(p.lat,p.lng);
    const d=Math.hypot(x-mx,y-my);
    if(d<bestD){bestD=d;best=p;}
  });
  if(best)showPanel(best);
  else document.getElementById('panel').style.display='none';
});

function showPanel(p){
  const panel=document.getElementById('panel');
  const cl=p.cl||'?';
  const col=DPE_COL[cl]||'#eee';
  document.getElementById('pa').textContent=p.adresse||'Adresse inconnue';
  document.getElementById('pb').innerHTML=[
    ['Classe DPE','<span class="dbadge" style="background:'+col+';color:'+DPE_BDR[cl]+'">'+cl+'</span>'],
    ['Classe GES',p.ges||'N/A'],
    ['Consommation',p.conso?Math.round(p.conso)+' kWh/m²/an':'N/A'],
    ['Émissions CO₂',p.ges_val?Math.round(p.ges_val)+' kg/m²/an':'N/A'],
    ['Énergie chauffage',p.energie||'N/A'],
    ['Chauffage',p.chauffage||'N/A'],
    ['Année construction',p.annee||'N/A'],
    ['Type bâtiment',p.type||'N/A'],
    ['Date DPE',p.date||'N/A'],
    ['N° DPE',p.num||'N/A'],
  ].map(([l,v])=>'<div class="pr"><span class="pl">'+l+'</span><span class="pv">'+v+'</span></div>').join('');
  panel.style.display='block';
}

// ── Suggestions adresse ─────────────────────────────────────────
let debSug;
const zi=document.getElementById('zi'), zs=document.getElementById('zs');
zi.addEventListener('input',()=>{
  clearTimeout(debSug);
  const q=zi.value.trim();
  if(q.length<3){zs.style.display='none';return;}
  debSug=setTimeout(async()=>{
    try{const r=await fetch('/ban?q='+encodeURIComponent(q));const d=await r.json();
    if(!d.features?.length){zs.style.display='none';return;}
    zs.innerHTML=d.features.map(f=>'<div class="zsi" data-lat="'+f.geometry.coordinates[1]+'" data-lng="'+f.geometry.coordinates[0]+'" onclick="goTo(this)">'+f.properties.label+'</div>').join('');
    zs.style.display='block';}catch{zs.style.display='none';}
  },280);
});
zi.addEventListener('keydown',e=>{if(e.key==='Enter'){zs.style.display='none';doExtract();}});
document.addEventListener('click',e=>{if(!e.target.closest('.swrap'))zs.style.display='none';});
function goTo(el){
  viewLat=parseFloat(el.dataset.lat); viewLng=parseFloat(el.dataset.lng);
  zoomLevel=15; tileCache={};
  zs.style.display='none';
  drawTiles();drawDots();
  setTimeout(doExtract,300);
}

// ── Filtres ─────────────────────────────────────────────────────
function tog(btn){
  const c=btn.dataset.c;
  if(active.has(c)){active.delete(c);btn.classList.add('off');}
  else{active.add(c);btn.classList.remove('off');}
  drawDots();
}

// ── Status ──────────────────────────────────────────────────────
function st(msg,type){
  const b=document.getElementById('sbar');
  b.textContent=msg; b.className='sbar '+type; b.style.display=msg?'block':'none';
}

// ── EXTRACTION ──────────────────────────────────────────────────
async function doExtract(){
  if(!active.size){st('Sélectionnez au moins une classe','err');return;}
  const W=tCanvas.width,H=tCanvas.height;
  const tl=pixelToLatLng(0,0), br=pixelToLatLng(W,H);
  const bbox=tl.lng+','+br.lat+','+br.lng+','+tl.lat;
  const classes=[...active].join(',');
  document.getElementById('xbtn').disabled=true;
  st('Extraction en cours...','load');
  document.getElementById('cnt').textContent='';
  document.getElementById('csvbtn').style.display='none';
  try{
    const r=await fetch('/api/extract?bbox='+encodeURIComponent(bbox)+'&classes='+encodeURIComponent(classes));
    const data=await r.json();
    document.getElementById('xbtn').disabled=false;
    if(data.error){st('Erreur: '+data.error,'err');return;}
    const rows=data.results||[];

    // Conserver les anciens points hors zone + ajouter nouveaux
    const newPts=rows.map(row=>({
      lat:parseFloat(row.latitude_ban||row.latitude||0),
      lng:parseFloat(row.longitude_ban||row.longitude||0),
      cl:row.etiquette_dpe||'N',
      adresse:row.adresse_ban||row.geo_adresse||'?',
      ges:row.etiquette_ges||'',
      conso:row.conso_5_usages_e_finale||row.consommation_energie||0,
      ges_val:row.emission_ges_5_usages||row.estimation_ges||0,
      energie:row.type_energie_principale_chauffage||'',
      chauffage:row.type_installation_chauffage||'',
      annee:row.annee_construction||'',
      type:row.type_batiment||'',
      date:(row.date_etablissement_dpe||'').substring(0,10),
      num:row.numero_dpe||'',
      raw:row
    })).filter(p=>p.lat&&p.lng);

    // Dédupliquer par numéro DPE
    const seen=new Set(allPts.map(p=>p.num));
    newPts.forEach(p=>{if(!seen.has(p.num)){allPts.push(p);seen.add(p.num);}});

    const total=data.total||rows.length;
    st(!rows.length?'Aucun DPE dans cette zone. Déplacez ou dézoomez.':'','ok');
    if(rows.length) st('','ok');
    document.getElementById('cnt').textContent=allPts.length+' DPE'+(total>rows.length?' ('+total+' total)':'');
    document.getElementById('csvbtn').style.display=allPts.length?'inline-block':'none';
    drawDots();
  }catch(e){
    document.getElementById('xbtn').disabled=false;
    st('Erreur: '+e.message,'err');
  }
}

// ── Export CSV ──────────────────────────────────────────────────
function dlCSV(){
  if(!allPts.length)return;
  const cols=['adresse','cl','ges','conso','ges_val','energie','chauffage','annee','type','date','num','lat','lng'];
  const labels=['Adresse','Classe DPE','Classe GES','Conso kWh/m²/an','Émissions kg/m²/an','Énergie chauffage','Type chauffage','Année construction','Type bâtiment','Date DPE','N° DPE','Latitude','Longitude'];
  const csv=[labels.join(';'),...allPts.filter(p=>active.has(p.cl)).map(p=>cols.map(k=>JSON.stringify(p[k]??'')).join(';'))].join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='dpe_extraction.csv';a.click();
}

// Init
drawTiles();
<\/script>
</body></html>`;
