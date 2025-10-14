// Elements
const input = document.getElementById('urlInput');
const loadBtn = document.getElementById('loadBtn');
const fileInput = document.getElementById('fileInput');
const themeBtn = document.getElementById('themeToggle');
const listDiv = document.getElementById('list');
const video = document.getElementById('videoPlayer');
const audio = document.getElementById('audioPlayer');
const iframe = document.getElementById('ytPlayer');
const noSource = document.getElementById('noSource');
const logoBox = document.querySelector('header .logo');
const searchInput = document.getElementById('searchInput');
const catBar = document.getElementById('catBar');

const tabs = {
  channels: document.getElementById('tab-channels'),
  favorites: document.getElementById('tab-favorites'),
  history: document.getElementById('tab-history'),
  playlists: document.getElementById('tab-playlists')
};

const nowTitle = document.getElementById('nowTitle');
const copyBtn = document.getElementById('copyBtn');
const openBtn = document.getElementById('openBtn');

// LocalStorage
const LS_KEYS = { favorites: 'iptv.favorites', history: 'iptv.history', theme: 'theme', playlists: 'iptv.playlists', last: 'iptv.lastUrl' };
function load(key, def){ try{ const v=localStorage.getItem(key); return v?JSON.parse(v):def; }catch{ return def; } }
function save(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch{} }

let channels = []; // {name,url,group,logo}
let favorites = load(LS_KEYS.favorites, []); // {name,url,logo}
let historyList = load(LS_KEYS.history, []); // [url]
let mode = 'channels';
let categories = ['ALL'];
let categoryFilter = 'ALL';
let channelFilter = '';

// Playlist sources
let defaultPlaylists = []; // loaded on demand
let userPlaylists = load(LS_KEYS.playlists, []); // [{name,url}]
let eqBars;

// libs
const HLS = window.Hls;
const DASH = window.dashjs?.MediaPlayer;

// Tabs
tabs.channels.onclick = () => switchTab('channels');
tabs.favorites.onclick = () => switchTab('favorites');
tabs.history.onclick = () => switchTab('history');
tabs.playlists.onclick = () => switchTab('playlists');

// Buttons
loadBtn.onclick = () => input.value.trim() && loadUrl(input.value.trim());
themeBtn.onclick = toggleTheme;
fileInput.onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  parseM3U(text);
};

// Drag & drop M3U
listDiv.addEventListener('dragover', (e)=>e.preventDefault());
listDiv.addEventListener('drop', async (e)=>{
  e.preventDefault();
  const file = e.dataTransfer.files?.[0];
  if (file && /\.m3u8?$/i.test(file.name)) {
    const text = await file.text();
    parseM3U(text);
  }
});

// Search
searchInput?.addEventListener('input', (e)=>{ channelFilter = e.target.value.toLowerCase(); renderList(); });

// Theme init
(function initTheme(){
  const saved = load(LS_KEYS.theme, 'dark');
  if (saved === 'light') document.body.classList.add('light');
})();
function toggleTheme(){
  const isLight = document.body.classList.toggle('light');
  save(LS_KEYS.theme, isLight ? 'light' : 'dark');
}

// Helpers
function classify(url){
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.endsWith('.m3u') || u.endsWith('.m3u8')) return 'm3u';
  if (u.endsWith('.mp4')) return 'mp4';
  if (u.endsWith('.mp3')) return 'mp3';
  if (u.endsWith('.mpd')) return 'dash';
  if (u.includes('.m3u8')) return 'hls';
  return 'unknown';
}
function extractYT(url){ const m = url.match(/[?&]v=([^&]+)/); return m ? m[1] : url.split('/').pop(); }
function setLogoActive(playing){ logoBox?.classList.toggle('playing', !!playing); }

// Placeholder logo data URI
const PLACEHOLDER_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
  <rect width="64" height="64" rx="10" fill="#111"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="34">📺</text>
</svg>`);

// Loader core
async function loadUrl(url){
  save(LS_KEYS.last, url);
  const type = classify(url);
  resetPlayers();
  noSource.style.display = 'none';
  addHistory(url);

  switch(type){
    case 'youtube': return playYouTube(url);
    case 'mp4': return playVideo(url);
    case 'mp3': return playAudio(url);
    case 'dash': return playDash(url);
    case 'm3u':
    case 'hls':
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (text.startsWith('#EXTM3U')) { parseM3U(text); return; }
        playHls(url);
      } catch (e) {
        toast(`Erreur de chargement: ${e.message || e}`);
        playHls(url);
      }
      return;
    default:
      alert('Type non reconnu');
  }
}

function resetPlayers(){
  [video, audio].forEach(el => { try{ el.pause(); }catch{} el.style.display='none'; });
  iframe.style.display='none';
  setLogoActive(false);
}

function updateNowBar(nameOrUrl, url){
  nowTitle.textContent = nameOrUrl || url || 'Flux';
  openBtn.href = url || '#';
  copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(url); toast('URL copiée'); } catch {} };
}

// Players
function playHls(url){
  video.style.display = 'block';
  if (HLS && HLS.isSupported()) {
    const hls = new HLS();
    hls.loadSource(url);
    hls.attachMedia(video);
  } else {
    video.src = url;
  }
  updateNowBar(undefined, url);
}
function playDash(url){
  video.style.display = 'block';
  if (!DASH) { video.src = url; return; }
  const player = DASH().create();
  player.initialize(video, url, true);
  updateNowBar(undefined, url);
}
function playVideo(url){
  video.src = url;
  video.style.display = 'block';
  updateNowBar(undefined, url);
}
function playAudio(url){
  audio.src = url;
  audio.style.display = 'block';
  updateNowBar(undefined, url);
}
function playYouTube(url){
  iframe.src = `https://www.youtube.com/embed/${extractYT(url)}?autoplay=1`;
  iframe.style.display = 'block';
  updateNowBar(undefined, url);
}

// M3U parsing with logos and groups
function parseM3U(text){
  const lines = text.split(/\r?\n/);
  let name = '', group = 'Autres', logo = '';
  channels = [];
  categories = ['ALL'];

  for (let i=0; i<lines.length; i++){
    const l = lines[i].trim();
    if (l.startsWith('#EXTINF')){
      const nameMatch = l.match(/,(.*)$/);
      name = nameMatch ? nameMatch[1].trim() : 'Chaîne';
      const grp = l.match(/group-title="([^"]+)"/i);
      group = grp ? grp[1] : 'Autres';
      const lg = l.match(/tvg-logo="([^"]+)"/i) || l.match(/logo="([^"]+)"/i);
      logo = lg ? lg[1] : '';
      if (!categories.includes(group)) categories.push(group);
    } else if (/^https?:\/\//i.test(l)){
      channels.push({ name, url: l, group, logo: logo || PLACEHOLDER_LOGO });
    }
  }
  categoryFilter = 'ALL';
  switchTab('channels');
}

// Render categories
function renderCategories(){
  if (!catBar) return;
  if (categories.length <= 1) { catBar.innerHTML = ''; return; }
  catBar.innerHTML = categories.map(c => 
    `<button class="cat ${c===categoryFilter?'active':''}" data-cat="${c}">${c}</button>`
  ).join('');
  catBar.querySelectorAll('button').forEach(btn=>{
    btn.onclick = ()=>{ categoryFilter = btn.dataset.cat; renderList(); };
  });
}

// Render list (channels/favorites/history/playlists)
function renderList(){
  listDiv.innerHTML = '';
  if (mode==='channels') renderCategories(); else catBar.innerHTML = '';

  let data = [];
  if (mode==='channels') data = channels;
  if (mode==='favorites') data = favorites;
  if (mode==='history') data = historyList.map(u => ({ url:u, name:u }));
  if (mode==='playlists') return renderPlaylists();

  if (mode==='channels' && categoryFilter!=='ALL') data = data.filter(x => x.group === categoryFilter);
  if (channelFilter) data = data.filter(x => (x.name||x.url).toLowerCase().includes(channelFilter));

  data.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="left">
        <span class="logo-sm">${ renderLogo(item.logo) }</span>
        <div class="meta">
          <div class="name">${escapeHtml(item.name || item.url)}</div>
          ${ item.group ? `<div class="sub" style="font-size:.8em;opacity:.7">${escapeHtml(item.group)}</div>` : ''}
        </div>
      </div>
      <span class="star">${isFav(item.url) ? '★' : '☆'}</span>`;

    div.onclick = () => { playByType(item.url); updateNowBar(item.name || item.url, item.url); };
    div.querySelector('.star').onclick = e => { e.stopPropagation(); toggleFavorite(item); renderList(); };
    listDiv.appendChild(div);
  });

  if (!data.length) listDiv.innerHTML += '<p style="opacity:0.6;padding:10px;">Aucune donnée.</p>';
}

function renderLogo(logo){
  if (!logo) return `<span class="ph">📺</span>`;
  const safe = logo.startsWith('http') || logo.startsWith('data:') ? logo : PLACEHOLDER_LOGO;
  return `<img src="${safe}" alt="logo" onerror="this.src='${PLACEHOLDER_LOGO}'" />`;
}

// Safe escapeHtml
function escapeHtml(s){
  const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', \"'\":'&#39;' };
  return (s||'').replace(/[&<>\"']/g, m => map[m]);
}

function playByType(url){
  const t = classify(url);
  if (t==='youtube') return playYouTube(url);
  if (t==='mp4') return playVideo(url);
  if (t==='mp3') return playAudio(url);
  if (t==='dash') return playDash(url);
  return playHls(url);
}

// Favorites & History
function isFav(url){ return favorites.some(f => f.url === url); }
function toggleFavorite(item){
  if (isFav(item.url)) favorites = favorites.filter(f => f.url !== item.url);
  else favorites.unshift({ name: item.name || item.url, url: item.url, logo: item.logo || '' });
  save(LS_KEYS.favorites, favorites);
}
function addHistory(url){
  historyList = [url, ...historyList.filter(u => u !== url)].slice(0, 30);
  save(LS_KEYS.history, historyList);
}
function switchTab(t){
  mode = t;
  Object.values(tabs).forEach(b => b.classList.remove('active'));
  tabs[t].classList.add('active');
  renderList();
  if (t==='playlists') ensureDefaultPlaylistsLoaded(); // load on demand
}

// Equalizer (real)
eqBars = document.getElementById('eqBars');
let audioCtx, analyser, source, dataArray, rafId;
function setEqualizer(active){
  if (!eqBars) return;
  eqBars.classList.toggle('hidden', !active);
  if (active){
    if (!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
      source = audioCtx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
    loopEq();
  } else {
    cancelAnimationFrame(rafId);
    eqBars.querySelectorAll('div').forEach(b => b.style.height = '10%');
  }
}
function loopEq(){
  const bars = eqBars.querySelectorAll('div');
  analyser.getByteFrequencyData(dataArray);
  const slice = Math.floor(dataArray.length / bars.length);
  for (let i=0; i<bars.length; i++){
    let sum=0; for (let j=i*slice;j<(i+1)*slice;j++) sum+=dataArray[j];
    const avg = sum / slice;
    const height = Math.max(5, Math.min(100, 1.2*(avg/255)*100));
    bars[i].style.height = `${height}%`;
  }
  rafId = requestAnimationFrame(loopEq);
}

// Splash: **always** close after 2s no matter what
window.addEventListener('load', () => {
  const splash = document.getElementById('splash');
  setTimeout(() => { splash.classList.add('hidden'); setTimeout(() => splash.remove(), 600); }, 2000);
});

// Toast
function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(), 1800); }

// --- Playlists UI (JSON + ajout local, loaded on demand) ---
async function ensureDefaultPlaylistsLoaded(force=false){
  if (defaultPlaylists.length && !force) return;
  try{
    const res = await fetch('playlists.json', { cache: 'no-store' });
    if (!res.ok) throw 0;
    const data = await res.json();
    defaultPlaylists = (data.playlists || []).filter(x => x.url);
  }catch{
    defaultPlaylists = [];
  }finally{
    renderList(); // refresh UI
  }
}
function renderPlaylists(){
  listDiv.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.padding = '8px';

  const bar = document.createElement('div');
  bar.style.display='flex'; bar.style.gap='8px'; bar.style.margin='6px';
  bar.innerHTML = `<button id="plReload">Charger playlists.json</button>`;
  wrap.appendChild(bar);

  bar.querySelector('#plReload').onclick = () => ensureDefaultPlaylistsLoaded(true);

  const h1 = document.createElement('h3');
  h1.textContent = 'Listes par défaut (playlists.json)';
  h1.style.opacity = '.8'; h1.style.margin = '6px 0';
  wrap.appendChild(h1);

  const def = document.createElement('div');
  (defaultPlaylists.length? defaultPlaylists : [{name:'(aucune – clique sur "Charger playlists.json")',url:''}]).forEach(p => {
    const it = document.createElement('div');
    it.className='item';
    it.innerHTML = `<div class="left"><span class="logo-sm"><span class="ph">📚</span></span><div class="meta"><div class="name">${escapeHtml(p.name||p.url)}</div></div></div>`;
    if (p.url){
      it.onclick = async () => {
        try{
          const res = await fetch(p.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          parseM3U(text);
          toast('Playlist chargée');
        }catch(e){ toast('Erreur playlist: ' + (e.message||e)); }
      };
    }
    def.appendChild(it);
  });
  wrap.appendChild(def);

  const h2 = document.createElement('h3');
  h2.textContent = 'Mes listes (localStorage)';
  h2.style.opacity = '.8'; h2.style.margin = '10px 0 6px';
  wrap.appendChild(h2);

  const mine = document.createElement('div');
  userPlaylists.forEach((p, idx) => {
    const it = document.createElement('div');
    it.className='item';
    it.innerHTML = `
      <div class="left">
        <span class="logo-sm"><span class="ph">🗂️</span></span>
        <div class="meta"><div class="name">${escapeHtml(p.name||p.url)}</div></div>
      </div>
      <div>
        <button class="btn-small" data-idx="${idx}" data-act="del" title="Supprimer">🗑️</button>
      </div>`;
    it.onclick = async (e) => {
      if (e.target.dataset.act === 'del') return;
      try{
        const res = await fetch(p.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        parseM3U(text);
        toast('Playlist chargée');
      }catch(e){ toast('Erreur playlist: ' + (e.message||e)); }
    };
    it.querySelector('[data-act="del"]').onclick = (e)=>{
      e.stopPropagation();
      userPlaylists.splice(idx,1);
      save(LS_KEYS.playlists, userPlaylists);
      renderPlaylists();
    };
    mine.appendChild(it);
  });
  wrap.appendChild(mine);

  const form = document.createElement('div');
  form.style.marginTop='10px';
  form.innerHTML = `
    <input id="plName" placeholder="Nom de la liste" style="margin-bottom:6px;">
    <input id="plUrl" placeholder="URL de la liste M3U">
    <button id="plAdd">Ajouter</button>`;
  wrap.appendChild(form);

  listDiv.appendChild(wrap);

  form.querySelector('#plAdd').onclick = () => {
    const name = form.querySelector('#plName').value.trim();
    const url = form.querySelector('#plUrl').value.trim();
    if (!url) return toast('URL requise');
    userPlaylists.unshift({ name: name || url, url });
    save(LS_KEYS.playlists, userPlaylists);
    renderPlaylists();
    toast('Liste ajoutée');
  };
}

// Auto-fill last url (no auto-play)
const last = load(LS_KEYS.last, '');
if (last) { input.value = last; }

// Initial render only (no dynamic fetch here)
renderList();
