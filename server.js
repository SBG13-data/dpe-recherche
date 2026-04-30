const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const PORT = process.env.PORT || 3000;
const GM_KEY = process.env.GOOGLE_MAPS_KEY || '';

// ── Chargement du CSV au démarrage ────────────────────────────────
let DPE_DATA = [];

function loadCSV() {
  const csvPath = path.join(__dirname, 'data.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('⚠️  Fichier data.csv non trouvé — mettez le CSV ADEME dans le repo');
    return;
  }
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  if (!lines.length) return;

  // Détection du séparateur (virgule ou point-virgule)
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  DPE_DATA = lines.slice(1).map(line => {
    const vals = line.split(sep).map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  }).filter(r => r.adresse_ban || r.adresse_ban_old || r.geo_adresse);

  console.log('✅ CSV chargé : ' + DPE_DATA.length + ' lignes');
}

loadCSV();

// ── Helpers ───────────────────────────────────────────────────────
function sendJSON(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}
function sendHTML(res, data) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(data);
}
function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    }).on('error', reject);
  });
}

// ── Normalisation des noms de colonnes ────────────────────────────
function getField(row, ...candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== '') return row[c];
  }
  return '';
}

function normalizeRow(row) {
  return {
    adresse_ban:                      getField(row, 'adresse_ban', 'geo_adresse', 'adresse_ban_old'),
    etiquette_dpe:                    getField(row, 'etiquette_dpe', 'classe_consommation_energie'),
    etiquette_ges:                    getField(row, 'etiquette_ges', 'classe_estimation_ges'),
    consommation_energie:             getField(row, 'conso_5_usages_e_finale', 'consommation_energie'),
    emission_ges:                     getField(row, 'emission_ges_5_usages', 'estimation_ges'),
    surface_habitable_logement:       getField(row, 'surface_habitable_logement', 'surface_thermique_lot'),
    annee_construction:               getField(row, 'annee_construction'),
    type_batiment:                    getField(row, 'type_batiment', 'tr002_type_batiment_description'),
    type_installation_chauffage:      getField(row, 'type_installation_chauffage'),
    type_energie_principale_chauffage:getField(row, 'type_energie_principale_chauffage'),
    type_installation_ecs:            getField(row, 'type_installation_ecs'),
    type_energie_principale_ecs:      getField(row, 'type_energie_principale_ecs'),
    type_ventilation:                 getField(row, 'type_ventilation'),
    nombre_niveau_logement:           getField(row, 'nombre_niveau_logement'),
    numero_dpe:                       getField(row, 'numero_dpe'),
    date_etablissement_dpe:           getField(row, 'date_etablissement_dpe'),
    latitude:  parseFloat(getField(row, 'latitude_ban', 'latitude') || '0'),
    longitude: parseFloat(getField(row, 'longitude_ban', 'longitude') || '0'),
  };
}

// ── SERVEUR ───────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  // Pages HTML
  if (p === '/' || p === '/index.html') { sendHTML(res, PAGE_SEARCH); return; }
  if (p === '/carte') { sendHTML(res, PAGE_MAP.replace('__GMKEY__', GM_KEY)); return; }

  // Autocomplétion adresses (BAN — pas bloqué)
  if (p === '/ban') {
    const q = u.searchParams.get('q') || '';
    try {
      const r = await fetchUrl('https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(q) + '&limit=6');
      sendJSON(res, r.body);
    } catch(e) { sendJSON(res, JSON.stringify({ features: [] })); }
    return;
  }

  // Recherche DPE par adresse (dans le CSV local)
  if (p === '/dpe') {
    const q = (u.searchParams.get('q') || '').toLowerCase().trim();
    if (!q || !DPE_DATA.length) {
      sendJSON(res, { results: [], _msg: DPE_DATA.length ? 'Requête vide' : 'CSV non chargé' });
      return;
    }
    const words = q.split(' ').filter(w => w.length > 1);
    const matches = DPE_DATA.filter(row => {
      const addr = (getField(row, 'adresse_ban', 'geo_adresse') || '').toLowerCase();
      return words.every(w => addr.includes(w));
    }).slice(0, 8).map(normalizeRow);
    sendJSON(res, { results: matches, total: matches.length });
    return;
  }

  // Extraction par bbox (dans le CSV local)
  if (p === '/extract') {
    const bboxStr = u.searchParams.get('bbox') || '';
    const classes = (u.searchParams.get('classes') || 'A,B,C,D,E,F,G').split(',');
    if (!bboxStr || !DPE_DATA.length) {
      sendJSON(res, { results: [], total: 0 });
      return;
    }
    const [lonMin, latMin, lonMax, latMax] = bboxStr.split(',').map(Number);
    const results = DPE_DATA
      .map(normalizeRow)
      .filter(r => {
        if (!r.latitude || !r.longitude) return false;
        if (!classes.includes(r.etiquette_dpe)) return false;
        return r.latitude >= latMin && r.latitude <= latMax &&
               r.longitude >= lonMin && r.longitude <= lonMax;
      })
      .slice(0, 500);
    sendJSON(res, { results, total: results.length });
    return;
  }

  if (p === '/health') { res.writeHead(200); res.end('OK - ' + DPE_DATA.length + ' DPE chargés'); return; }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log('🏠 Serveur DPE démarré sur le port ' + PORT));

// ════════════════════════════════════════════════════════════════════
// PAGE RECHERCHE
// ════════════════════════════════════════════════════════════════════
const PAGE_SEARCH = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Outil DPE</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#f0f2f5;min-height:100vh;padding:2rem 1rem;color:#1a1a2e}
.wrap{max-width:860px;margin:0 auto}
h1{font-size:1.8rem;font-weight:700;text-align:center;margin-bottom:.4rem}
.sub{text-align:center;color:#666;margin-bottom:1.5rem;font-size:.95rem}
.nav{display:flex;justify-content:center;gap:8px;margin-bottom:1.5rem}
.nav a{padding:.5rem 1.2rem;border-radius:8px;font-size:.88rem;font-weight:600;text-decoration:none;background:white;color:#3b5bdb;border:1.5px solid #3b5bdb}
.nav a:hover,.nav a.on{background:#3b5bdb;color:white}
.card{background:white;border-radius:14px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-bottom:1.2rem;position:relative}
.row{display:flex;gap:8px}
input{flex:1;padding:.72rem 1rem;border:1.5px solid #ddd;border-radius:9px;font-size:1rem;outline:none}
input:focus{border-color:#3b5bdb}
.btn{padding:.72rem 1.3rem;background:#3b5bdb;color:white;border:none;border-radius:9px;font-size:.95rem;font-weight:600;cursor:pointer}
.btn:hover{background:#2f4ac7}.btn:disabled{background:#a5b4fc;cursor:not-allowed}
#sug{position:absolute;left:1.5rem;right:1.5rem;top:calc(100% - .5rem);background:white;border:1.5px solid #ddd;border-radius:9px;z-index:100;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,.1);display:none}
.si{padding:10px 14px;font-size:.88rem;cursor:pointer;border-bottom:1px solid #f0f0f0}
.si:hover{background:#eff3ff;color:#3b5bdb}
#st{margin-top:.9rem;padding:.7rem 1rem;border-radius:9px;font-size:.88rem;display:none}
.sl{background:#eff3ff;color:#3b5bdb;display:flex!important;align-items:center;gap:8px}
.se{background:#fff0f0;color:#c92a2a;display:block!important}
.sp{width:15px;height:15px;border:2px solid #bac8ff;border-top-color:#3b5bdb;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
#multi{background:white;border-radius:14px;padding:1.2rem;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-bottom:1.2rem;display:none}
.mi{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid #eee;border-radius:9px;cursor:pointer;margin-bottom:6px}
.mi:hover{border-color:#3b5bdb;background:#eff3ff}
#res{display:none}
.rh{background:white;border-radius:14px;padding:1.2rem;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-bottom:1rem;display:flex;align-items:center;gap:14px}
.dpe{width:58px;height:58px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:800;flex-shrink:0}
.A{background:#b2f2bb;color:#1a4731}.B{background:#c3fae8;color:#1a4731}.C{background:#d8f5a2;color:#3a5a00}.D{background:#ffec99;color:#7a5200}.E{background:#ffd8a8;color:#7a3500}.F{background:#ffa8a8;color:#7a0000}.G{background:#ff6b6b;color:#4a0000}.N{background:#e9ecef;color:#666}
.rhi h2{font-size:1rem;font-weight:600;margin-bottom:3px}.rhi p{font-size:.82rem;color:#888}
.sc{display:flex;gap:3px;margin-top:6px}.sci{flex:1;height:5px;border-radius:3px;opacity:.2}.sci.on{opacity:1}
.sec{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#999;margin-bottom:.65rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px;margin-bottom:1rem}
.ic{background:white;border-radius:10px;padding:.85rem;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.ic .l{font-size:.68rem;font-weight:600;text-transform:uppercase;color:#aaa;margin-bottom:4px}
.ic .v{font-size:.95rem;font-weight:700;color:#1a1a2e}
.eg{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:8px;margin-bottom:1rem}
.ec{background:white;border-radius:10px;padding:.85rem;box-shadow:0 2px 8px rgba(0,0,0,.06);border-left:3px solid #3b5bdb}
.ec .l{font-size:.68rem;font-weight:600;text-transform:uppercase;color:#aaa;margin-bottom:4px}
.ec .v{font-size:.88rem;font-weight:600;color:#1a1a2e;line-height:1.4}
.nodpe{background:white;border-radius:14px;padding:2rem;text-align:center;color:#888;display:none}
.src{text-align:center;font-size:.72rem;color:#bbb;margin-top:1.2rem;padding-top:1rem;border-top:1px solid #eee}
@media(max-width:580px){.row{flex-direction:column}.grid{grid-template-columns:1fr 1fr}.eg{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
<h1>🏠 Outil DPE ADEME</h1>
<p class="sub">Données officielles — chauffage, énergie, isolation, classe énergétique</p>
<div class="nav">
  <a href="/" class="on">🔍 Recherche adresse</a>
  <a href="/carte">🗺️ Carte & Extraction</a>
</div>
<div class="card">
  <div class="row">
    <input type="text" id="ai" placeholder="Ex: 67 Residence les Hameaux de Biver 13120 Gardanne" autocomplete="off"/>
    <button class="btn" id="sb" onclick="go()">Rechercher</button>
  </div>
  <div id="sug"></div>
  <div id="st"></div>
</div>
<div class="nodpe" id="nodpe">❌ Aucun DPE trouvé. Vérifiez l'adresse ou le contenu du fichier data.csv.</div>
<div id="multi"><p style="font-size:.88rem;color:#555;margin-bottom:.75rem;font-weight:600">Plusieurs DPE — choisissez :</p><div id="ml"></div></div>
<div id="res">
  <div class="rh">
    <div id="db" class="dpe N">?</div>
    <div class="rhi"><h2 id="ad"></h2><p id="dm"></p><div class="sc" id="sc"></div></div>
  </div>
  <p class="sec">⚡ Performance</p><div class="grid" id="pg"></div>
  <p class="sec">🔧 Équipements</p><div class="eg" id="eg"></div>
  <p class="sec">🏗️ Logement</p><div class="grid" id="lg"></div>
  <div class="src">Données ADEME · Licence Ouverte Etalab</div>
</div>
</div>
<script>
const CC={A:'#b2f2bb',B:'#c3fae8',C:'#d8f5a2',D:'#ffec99',E:'#ffd8a8',F:'#ffa8a8',G:'#ff6b6b'};
let t;const ai=document.getElementById('ai'),sg=document.getElementById('sug');
ai.addEventListener('input',()=>{clearTimeout(t);const q=ai.value.trim();if(q.length<4){sg.style.display='none';return;}t=setTimeout(()=>fs(q),280);});
ai.addEventListener('keydown',e=>{if(e.key==='Enter')go();if(e.key==='Escape')sg.style.display='none';});
document.addEventListener('click',e=>{if(!e.target.closest('.card'))sg.style.display='none';});
async function fs(q){try{const r=await fetch('/ban?q='+encodeURIComponent(q));const d=await r.json();if(!d.features?.length){sg.style.display='none';return;}sg.innerHTML=d.features.map(f=>'<div class="si" onclick="pk(\''+f.properties.label.replace(/'/g,"\\'")+'\')">'+f.properties.label+'</div>').join('');sg.style.display='block';}catch{sg.style.display='none';}}
function pk(l){ai.value=l;sg.style.display='none';go();}
function ss(m,tp){const e=document.getElementById('st');if(!m){e.style.display='none';return;}e.innerHTML=tp==='l'?'<span class="sp"></span>'+m:m;e.className=tp==='l'?'sl':'se';e.style.display=tp==='l'?'flex':'block';}
function ha(){['res','multi','nodpe'].forEach(i=>document.getElementById(i).style.display='none');ss('','');}
async function go(){const a=ai.value.trim();if(!a)return;sg.style.display='none';ha();document.getElementById('sb').disabled=true;ss('Recherche en cours...','l');try{const r=await fetch('/dpe?q='+encodeURIComponent(a));const d=await r.json();ss('','');document.getElementById('sb').disabled=false;if(!d.results?.length){document.getElementById('nodpe').style.display='block';return;}d.results.length===1?rd(d.results[0]):sm(d.results);}catch(e){ss('Erreur : '+e.message,'e');document.getElementById('sb').disabled=false;}}
function sm(R){window._r=R;document.getElementById('ml').innerHTML=R.map((r,i)=>{const cl=r.etiquette_dpe||'N';const dt=(r.date_etablissement_dpe||'').substring(0,10);const sf=r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+'m²':'';return '<div class="mi" onclick="rd(window._r['+i+'])"><span class="dpe '+cl+'" style="width:36px;height:36px;font-size:1.1rem">'+cl+'</span><div><b style="font-size:.88rem">'+(r.adresse_ban||'')+'</b><br><span style="font-size:.78rem;color:#888">'+(dt?'DPE du '+dt:'')+(sf?' · '+sf:'')+'</span></div></div>';}).join('');document.getElementById('multi').style.display='block';}
function rd(r){document.getElementById('multi').style.display='none';const cl=r.etiquette_dpe||'N';const b=document.getElementById('db');b.textContent=cl==='N'?'?':cl;b.className='dpe '+cl;document.getElementById('ad').textContent=r.adresse_ban||ai.value;const dt=(r.date_etablissement_dpe||'').substring(0,10);document.getElementById('dm').textContent=(dt?'DPE du '+dt:'')+(r.numero_dpe?' · N°'+r.numero_dpe:'');document.getElementById('sc').innerHTML=['A','B','C','D','E','F','G'].map(c=>'<div class="sci '+(c===cl?'on':'')+'" style="background:'+(CC[c]||'#ccc')+'"></div>').join('');const cn=r.consommation_energie,gs=r.emission_ges;
document.getElementById('pg').innerHTML=[{l:'Classe énergie',v:cl!=='N'?cl:'N/A'},{l:'Classe GES',v:r.etiquette_ges||'N/A'},{l:'Consommation',v:cn?Math.round(cn)+' kWh/m²/an':'N/A'},{l:'Émissions CO₂',v:gs?Math.round(gs)+' kg/m²/an':'N/A'}].map(c=>'<div class="ic"><div class="l">'+c.l+'</div><div class="v">'+c.v+'</div></div>').join('');
document.getElementById('eg').innerHTML=[{l:'Chauffage',v:r.type_installation_chauffage||'N/A'},{l:'Énergie chauffage',v:r.type_energie_principale_chauffage||'N/A'},{l:'Eau chaude',v:r.type_installation_ecs||'N/A'},{l:'Énergie ECS',v:r.type_energie_principale_ecs||'N/A'},{l:'Ventilation',v:r.type_ventilation||'N/A'}].map(e=>'<div class="ec"><div class="l">'+e.l+'</div><div class="v">'+e.v+'</div></div>').join('');
document.getElementById('lg').innerHTML=[{l:'Surface',v:r.surface_habitable_logement?Math.round(r.surface_habitable_logement)+' m²':'N/A'},{l:'Année',v:r.annee_construction||'N/A'},{l:'Type',v:r.type_batiment||'N/A'},{l:'Niveaux',v:r.nombre_niveau_logement||'N/A'}].map(c=>'<div class="ic"><div class="l">'+c.l+'</div><div class="v">'+c.v+'</div></div>').join('');
document.getElementById('res').style.display='block';}
</script>
</body></html>`;

// ════════════════════════════════════════════════════════════════════
// PAGE CARTE GOOGLE MAPS
// ════════════════════════════════════════════════════════════════════
const PAGE_MAP = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carte DPE</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:'Segoe UI',sans-serif;overflow:hidden}
body{display:flex;flex-direction:column}
.bar{background:#1e2a4a;padding:.6rem 1rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;flex-shrink:0}
.bar h1{color:#fff;font-size:.95rem;font-weight:700;white-space:nowrap}
.navl{padding:.35rem .8rem;border-radius:7px;font-size:.8rem;font-weight:600;text-decoration:none;background:#2d3a5e;color:#90b4ff;white-space:nowrap}
.navl:hover{background:#3d4f7e;color:#fff}
.sw{position:relative;flex:1;min-width:130px;max-width:260px}
#zi{width:100%;padding:.4rem .8rem;border:1px solid #3d4f7e;border-radius:7px;font-size:.82rem;outline:none;background:#2d3a5e;color:#fff}
#zi::placeholder{color:#8899bb}#zi:focus{border-color:#4361ee}
#zs{position:absolute;top:100%;left:0;right:0;background:#1e2a4a;border:1px solid #3d4f7e;border-radius:7px;z-index:3000;display:none;margin-top:2px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.zsi{padding:8px 12px;font-size:.8rem;cursor:pointer;border-bottom:1px solid #2d3a5e;color:#cdd8f0}
.zsi:hover{background:#2d3a5e;color:#fff}
.filters{display:flex;gap:3px;flex-shrink:0}
.fb{padding:.3rem .55rem;border-radius:5px;font-size:.78rem;font-weight:700;cursor:pointer;border:2px solid transparent;transition:opacity .15s}
.fb.off{opacity:.25}
.fA{background:#b2f2bb;color:#1a4731}.fB{background:#c3fae8;color:#1a4731}.fC{background:#d8f5a2;color:#3a5a00}.fD{background:#ffec99;color:#7a5200}.fE{background:#ffd8a8;color:#7a3500}.fF{background:#ffa8a8;color:#7a0000}.fG{background:#ff6b6b;color:#4a0000}
.bx{padding:.38rem .85rem;background:#4361ee;color:white;border:none;border-radius:7px;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap}
.bx:hover{background:#3451d1}.bx:disabled{background:#2d3a5e;color:#5a7aaa;cursor:not-allowed}
.bc{padding:.38rem .85rem;background:#1a6b3a;color:white;border:none;border-radius:7px;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap;display:none}
.bc:hover{background:#15552e}
#cnt{font-size:.78rem;color:#90a8cc;white-space:nowrap}
.sb{padding:.35rem 1rem;font-size:.8rem;text-align:center;display:none;flex-shrink:0}
.sb.load{background:#1a2a4a;color:#90b4ff}.sb.err{background:#3a1a1a;color:#ff8888}
.main{flex:1;display:flex;min-height:0;overflow:hidden}
#gmap{flex:1;min-height:0}
#panel{width:300px;background:white;border-left:1px solid #e8e8e8;display:flex;flex-direction:column;flex-shrink:0}
.ph{padding:.7rem 1rem;background:#f8f9fa;border-bottom:1px solid #e8e8e8;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
.ph h3{font-size:.85rem;font-weight:700}.ph span{font-size:.72rem;color:#888}
.pb{flex:1;overflow-y:auto}
.nopt{padding:2rem;text-align:center;color:#aaa;font-size:.82rem}
table{width:100%;border-collapse:collapse;font-size:.76rem}
th{background:#eff3ff;padding:6px 8px;text-align:left;font-weight:600;color:#3b5bdb;position:sticky;top:0;white-space:nowrap;border-bottom:1px solid #dde4f7}
td{padding:5px 8px;border-bottom:1px solid #f5f5f5}
td:nth-child(2){max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tr:hover td{background:#f8f9ff;cursor:pointer}
.cl{display:inline-block;padding:1px 7px;border-radius:4px;font-weight:700;font-size:.8rem}
</style>
</head>
<body>
<div class="bar">
  <a href="/" class="navl">← Recherche</a>
  <h1>🗺️ Carte DPE</h1>
  <div class="sw">
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
  <button class="bx" id="xbtn" onclick="doExtract()">🔍 Extraire zone</button>
  <button class="bc" id="cbtn" onclick="dlCSV()">⬇️ CSV</button>
  <span id="cnt"></span>
</div>
<div id="sb" class="sb"></div>
<div class="main">
  <div id="gmap"></div>
  <div id="panel">
    <div class="ph"><h3>📋 Résultats</h3><span id="pcnt">0 logement</span></div>
    <div class="pb">
      <div class="nopt" id="nopt">Extraire une zone pour voir les résultats</div>
      <table id="tbl" style="display:none"><thead><tr><th>Cl.</th><th>Adresse</th><th>Énergie</th><th>Année</th></tr></thead><tbody id="tb"></tbody></table>
    </div>
  </div>
</div>
<script>
const DC={A:'#b2f2bb',B:'#c3fae8',C:'#d8f5a2',D:'#ffec99',E:'#ffd8a8',F:'#ffa8a8',G:'#ff6b6b',N:'#ddd'};
const DB={A:'#1a4731',B:'#1a4731',C:'#3a5a00',D:'#7a5200',E:'#7a3500',F:'#7a0000',G:'#4a0000',N:'#999'};
let gmap,iw,markers=[],pts=[],active=new Set(['A','B','C','D','E','F','G']),dbt;
function initMap(){
  gmap=new google.maps.Map(document.getElementById('gmap'),{center:{lat:43.45,lng:5.48},zoom:14,gestureHandling:'greedy',styles:[{featureType:'poi',stylers:[{visibility:'off'}]}]});
  iw=new google.maps.InfoWindow();
  gmap.addListener('click',()=>iw.close());
}
const zi=document.getElementById('zi'),zs=document.getElementById('zs');
zi.addEventListener('input',()=>{clearTimeout(dbt);const q=zi.value.trim();if(q.length<3){zs.style.display='none';return;}dbt=setTimeout(async()=>{try{const r=await fetch('/ban?q='+encodeURIComponent(q));const d=await r.json();if(!d.features?.length){zs.style.display='none';return;}zs.innerHTML=d.features.map(f=>'<div class="zsi" data-lat="'+f.geometry.coordinates[1]+'" data-lng="'+f.geometry.coordinates[0]+'" onclick="goTo(this)">'+f.properties.label+'</div>').join('');zs.style.display='block';}catch{zs.style.display='none';}},280);});
zi.addEventListener('keydown',e=>{if(e.key==='Enter'){zs.style.display='none';doExtract();}});
document.addEventListener('click',e=>{if(!e.target.closest('.sw'))zs.style.display='none';});
function goTo(el){gmap.setCenter({lat:parseFloat(el.dataset.lat),lng:parseFloat(el.dataset.lng)});gmap.setZoom(15);zs.style.display='none';setTimeout(doExtract,400);}
function tog(btn){const c=btn.dataset.c;if(active.has(c)){active.delete(c);btn.classList.add('off');}else{active.add(c);btn.classList.remove('off');}refresh();}
function setS(m,t){const b=document.getElementById('sb');b.textContent=m;b.className='sb '+(t||'');b.style.display=m?'block':'none';}
function svgIcon(cl){const c=DC[cl]||'#ddd',b=DB[cl]||'#999';return{url:'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="6" fill="'+c+'" stroke="'+b+'" stroke-width="1.5"/></svg>'),scaledSize:new google.maps.Size(14,14),anchor:new google.maps.Point(7,7)};}
function popHTML(p){const c=DC[p.cl]||'#ddd',b=DB[p.cl]||'#999';return '<div style="font-family:Segoe UI,sans-serif;font-size:.8rem;min-width:190px"><b style="font-size:.88rem;display:block;margin-bottom:5px">'+p.adresse+'</b>'+[['Classe DPE','<span style="background:'+c+';color:'+b+';padding:0 7px;border-radius:4px;font-weight:700">'+p.cl+'</span>'],['GES',p.ges||'N/A'],['Consommation',p.conso?Math.round(p.conso)+' kWh/m²/an':'N/A'],['Énergie',p.energie||'N/A'],['Année',p.annee||'N/A'],['Type',p.type||'N/A']].map(([l,v])=>'<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid #f0f0f0"><span style="color:#888">'+l+'</span><span style="font-weight:600">'+v+'</span></div>').join('')+'</div>';}
function refresh(){markers.forEach(m=>m.setMap(null));markers=[];pts.forEach(p=>{if(!active.has(p.cl))return;const m=new google.maps.Marker({position:{lat:p.lat,lng:p.lng},map:gmap,icon:svgIcon(p.cl),title:p.adresse});m.addListener('click',()=>{iw.setContent(popHTML(p));iw.open(gmap,m);});markers.push(m);});updateTable();}
function updateTable(){const f=pts.filter(p=>active.has(p.cl));document.getElementById('pcnt').textContent=f.length+' logement'+(f.length>1?'s':'');document.getElementById('nopt').style.display=f.length?'none':'block';document.getElementById('tbl').style.display=f.length?'table':'none';document.getElementById('tb').innerHTML=f.map(p=>{const c=DC[p.cl]||'#ddd',b=DB[p.cl]||'#999';return '<tr onclick="gmap.panTo({lat:'+p.lat+',lng:'+p.lng+'});gmap.setZoom(17)" title="'+p.adresse+'"><td><span class="cl" style="background:'+c+';color:'+b+'">'+p.cl+'</span></td><td title="'+p.adresse+'">'+p.adresse+'</td><td>'+(p.energie||'-')+'</td><td>'+(p.annee||'-')+'</td></tr>';}).join('');}
async function doExtract(){if(!gmap){alert('Carte non initialisée');return;}if(!active.size){setS('Sélectionnez au moins une classe','err');return;}const b=gmap.getBounds();if(!b){setS('Carte non prête','err');return;}const sw=b.getSouthWest(),ne=b.getNorthEast();const bbox=sw.lng()+','+sw.lat()+','+ne.lng()+','+ne.lat();const classes=[...active].join(',');document.getElementById('xbtn').disabled=true;setS('Extraction en cours...','load');document.getElementById('cbtn').style.display='none';try{const r=await fetch('/extract?bbox='+encodeURIComponent(bbox)+'&classes='+encodeURIComponent(classes));const data=await r.json();document.getElementById('xbtn').disabled=false;const rows=data.results||[];const seen=new Set(pts.map(p=>p.num));rows.forEach(row=>{const lat=parseFloat(row.latitude||0),lng=parseFloat(row.longitude||0);if(!lat||!lng)return;const num=row.numero_dpe||(lat+','+lng);if(seen.has(num))return;seen.add(num);pts.push({lat,lng,cl:row.etiquette_dpe||'N',adresse:row.adresse_ban||'?',ges:row.etiquette_ges||'',conso:row.consommation_energie||0,energie:row.type_energie_principale_chauffage||'',annee:row.annee_construction||'',type:row.type_batiment||'',num});});refresh();setS(!rows.length?'Aucun DPE dans cette zone.':'','load');if(rows.length)setS('','load');document.getElementById('cnt').textContent=pts.length+' DPE';if(pts.length)document.getElementById('cbtn').style.display='inline-block';}catch(e){document.getElementById('xbtn').disabled=false;setS('Erreur : '+e.message,'err');}}
function dlCSV(){const f=pts.filter(p=>active.has(p.cl));if(!f.length)return;const cols=['adresse','cl','ges','conso','energie','annee','type','num','lat','lng'];const labels=['Adresse','Classe DPE','Classe GES','Conso kWh/m2/an','Energie chauffage','Annee','Type','N DPE','Lat','Lng'];const csv=[labels.join(';'),...f.map(p=>cols.map(k=>JSON.stringify(p[k]??'')).join(';'))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv'}));a.download='dpe.csv';a.click();}
<\/script>
<script src="https://maps.googleapis.com/maps/api/js?key=__GMKEY__&callback=initMap&loading=async" async defer></script>
</body></html>`;
