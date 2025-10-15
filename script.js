// ============= IPTV Player – RESCUE SCRIPT (baseline propre) =============
// Ce fichier remplace intégralement script.js pour déblocage rapide.
// Fonctions: coller URL, importer M3U, lister chaînes (logos, groupes), jouer HLS/MP4/MP3/MPD/YouTube.
// ========================================================================
// état par défaut : son actif


// --- Sécurité & logs ---
window.addEventListener('error', e => console.error('[IPTV:error]', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', e => console.error('[IPTV:promise]', e.reason));

// --- Elements ---
const input = document.getElementById('urlInput');
const loadBtn = document.getElementById('loadBtn');
const fileInput = document.getElementById('fileInput');
const themeBtn = document.getElementById('themeToggle');
const listDiv = document.getElementById('list');
const video = document.getElementById('videoPlayer');
const audio = document.getElementById('audioPlayer');
const iframe = document.getElementById('ytPlayer');
const noSource = document.getElementById('noSource');
const playerSection = document.getElementById('playerSection');
const searchInput = document.getElementById('searchInput');
const catBar = document.getElementById('catBar');

const tabs = {
  channels: document.getElementById('tab-channels'),
  favorites: document.getElementById('tab-favorites'),
  history: document.getElementById('tab-history'),
  playlists: document.getElementById('tab-playlists'),
};

const nowTitle = document.getElementById('nowTitle');
const copyBtn  = document.getElementById('copyBtn');
const openBtn  = document.getElementById('openBtn');

// --- Storage helpers ---
const LS = { fav:'iptv.favorites', hist:'iptv.history', last:'iptv.lastUrl', theme:'theme', playlists:'iptv.playlists' };
const loadLS = (k, d) => { try { const v = localStorage.getItem(k); return v?JSON.parse(v):d; } catch { return d; } };
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// --- State ---
let channels = [];              // {name,url,group,logo}
let favorites = loadLS(LS.fav, []);
let historyList = loadLS(LS.hist, []);
let categories = ['ALL'];
let categoryFilter = 'ALL';
let channelFilter = '';
let mode = 'channels';
let defaultPlaylists = [];      // chargé à la demande
let userPlaylists = loadLS(LS.playlists, []);

// --- Utils ---
function escapeHtml(s){
  const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
  return (s ?? '').toString().replace(/[&<>"']/g, m => map[m]);
}
function classify(url){
  const u = (url||'').toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.endsWith('.m3u') || u.includes('.m3u8')) return 'hls';
  if (u.endsWith('.mp4')) return 'mp4';
  if (u.endsWith('.mp3')) return 'mp3';
  if (u.endsWith('.mpd')) return 'dash';
  return 'unknown';
}
const extractYT = (url) => { const m = url.match(/[?&]v=([^&]+)/); return m?m[1]:url.split('/').pop(); };
const PLACEHOLDER_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="10" fill="#111"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="34">📺</text></svg>`);

// --- UI helpers ---
function setPlaying(on){
  try {
    playerSection && playerSection.classList.toggle('playing', !!on);
    if (noSource) noSource.style.display = on ? 'none' : 'flex';
  } catch {}
}
function resetPlayers(){
  try { video.pause(); } catch {}
  try { audio.pause(); } catch {}
  video.style.display = 'none';
  audio.style.display = 'none';
  iframe.style.display = 'none';
  setPlaying(false);
}
function updateNowBar(nameOrUrl, url){
  nowTitle && (nowTitle.textContent = nameOrUrl || url || 'Flux');
  if (openBtn) openBtn.href = url || '#';
  if (copyBtn) copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(url); } catch {} };
}

// --- Players ---
function playHls(url){
  video.style.display = 'block';
  setPlaying(true);
  try {
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls();
      hls.on(window.Hls.Events.ERROR, (evt, data) => {
        console.warn('[HLS.js error]', data);
        if (data?.fatal) { hls.destroy(); video.src = url; }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url; // Safari iOS lit HLS nativement
    }
  } catch (e) {
    console.error('[playHls]', e);
    video.src = url;
  }
  updateNowBar(undefined, url);
}
function playDash(url){
  video.style.display = 'block';
  setPlaying(true);
  const DASH = window.dashjs?.MediaPlayer;
  if (DASH && typeof DASH.create === 'function') {
    const p = DASH.create();
    p.initialize(video, url, true);
  } else {
    video.src = url; // fallback
  }
  updateNowBar(undefined, url);
}
function playVideo(url){
  video.style.display = 'block';
  setPlaying(true);
  video.src = url;
  updateNowBar(undefined, url);
}
function playAudio(url){
  audio.style.display = 'block';
  setPlaying(true);
  audio.src = url;
  updateNowBar(undefined, url);
}
function playYouTube(url){
  iframe.style.display = 'block';
  setPlaying(true);
  iframe.src = `https://www.youtube.com/embed/${extractYT(url)}?autoplay=1`;
  updateNowBar(undefined, url);
}
function playByType(url){
  const t = classify(url);
  if (t==='youtube') return playYouTube(url);
  if (t==='mp4') return playVideo(url);
  if (t==='mp3') return playAudio(url);
  if (t==='dash') return playDash(url);
  return playHls(url);
}

// --- M3U ---
function parseM3U(text){
  text = String(text||'').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).map(l => l.trim());
  let name='', group='Autres', logo='';
  channels = []; categories = ['ALL'];

  for (let i=0; i<lines.length; i++){
    const l = lines[i];
    if (!l) continue;
    if (l.startsWith('#EXTINF')){
      const nm = l.match(/,(.*)$/); name = nm ? nm[1].trim() : 'Chaîne';
      const gm = l.match(/group-title="([^"]+)"/i); group = gm?gm[1]:'Autres';
      const lg = l.match(/tvg-logo="([^"]+)"/i) || l.match(/logo="([^"]+)"/i); logo = lg?lg[1]:'';
      if (!categories.includes(group)) categories.push(group);
    } else if (/^https?:\/\//i.test(l)){
      channels.push({ name, url:l, group, logo: logo || PLACEHOLDER_LOGO });
    }
  }
  categoryFilter = 'ALL';
  switchTab('channels');
}

// --- Rendu ---
function renderCategories(){
  if (!catBar) return;
  if (categories.length <= 1) { catBar.innerHTML = ''; return; }
  catBar.innerHTML = categories.map(c => `<button class="cat ${c===categoryFilter?'active':''}" data-cat="${c}">${escapeHtml(c)}</button>`).join('');
  catBar.querySelectorAll('button').forEach(btn=>{
    btn.onclick = () => { categoryFilter = btn.dataset.cat; renderList(); };
  });
}
function renderLogo(logo){
  if (!logo) return `<span class="ph">📺</span>`;
  const safe = (logo.startsWith('http') || logo.startsWith('data:')) ? logo : PLACEHOLDER_LOGO;
  return `<img src="${safe}" alt="logo" onerror="this.src='${PLACEHOLDER_LOGO}'">`;
}
function isFav(url){ return favorites.some(f => f.url === url); }
function toggleFavorite(it){
  if (isFav(it.url)) favorites = favorites.filter(f => f.url !== it.url);
  else favorites.unshift({ name: it.name || it.url, url: it.url, logo: it.logo || '' });
  saveLS(LS.fav, favorites);
}
function addHistory(url){
  historyList = [url, ...historyList.filter(u=>u!==url)].slice(0,30);
  saveLS(LS.hist, historyList);
}
function renderPlaylists(){
  listDiv.innerHTML = '';
  const wrap = document.createElement('div'); wrap.style.padding = '8px';

  const bar = document.createElement('div'); bar.style.display='flex'; bar.style.gap='8px'; bar.style.margin='6px';
  bar.innerHTML = `<button id="plReload">Charger playlists.json</button>`;
  wrap.appendChild(bar);
  bar.querySelector('#plReload').onclick = () => ensureDefaultPlaylistsLoaded(true);

  const h1 = document.createElement('h3'); h1.textContent='Listes par défaut'; h1.style.margin='6px 0'; h1.style.opacity='.8';
  wrap.appendChild(h1);

  const def = document.createElement('div');
  (defaultPlaylists.length ? defaultPlaylists : [{name:'(aucune – clique “Charger playlists.json”)', url:''}]).forEach(p=>{
    const it = document.createElement('div'); it.className='item';
    it.innerHTML = `<div class="left"><span class="logo-sm"><span class="ph">📚</span></span><div class="meta"><div class="name">${escapeHtml(p.name||p.url)}</div></div></div>`;
    if (p.url) {
      it.onclick = async () => {
        try{
          const res = await fetch(p.url);
          if (!res.ok) throw new Error('HTTP '+res.status);
          const txt = await res.text();
          parseM3U(txt);
        }catch(e){ console.error('[playlist]', e); }
      };
    }
    def.appendChild(it);
  });
  wrap.appendChild(def);

  const h2 = document.createElement('h3'); h2.textContent='Mes listes'; h2.style.margin='10px 0 6px'; h2.style.opacity='.8';
  wrap.appendChild(h2);

  const mine = document.createElement('div');
  userPlaylists.forEach((p, idx)=>{
    const it = document.createElement('div'); it.className='item';
    it.innerHTML = `
      <div class="left">
        <span class="logo-sm"><span class="ph">🗂️</span></span>
        <div class="meta"><div class="name">${escapeHtml(p.name||p.url)}</div></div>
      </div>
      <div><button class="btn-small" data-idx="${idx}" data-act="del">🗑️</button></div>`;
    it.onclick = async (e) => {
      if (e.target.dataset.act === 'del') return;
      try{
        const res = await fetch(p.url);
        if (!res.ok) throw new Error('HTTP '+res.status);
        const txt = await res.text();
        parseM3U(txt);
      }catch(e){ console.error('[playlist:mine]', e); }
    };
    it.querySelector('[data-act="del"]').onclick = (e)=>{
      e.stopPropagation();
      userPlaylists.splice(idx,1);
      saveLS(LS.playlists, userPlaylists);
      renderPlaylists();
    };
    mine.appendChild(it);
  });
  wrap.appendChild(mine);

  const form = document.createElement('div'); form.style.marginTop='10px';
  form.innerHTML = `
    <input id="plName" placeholder="Nom de la liste" style="margin-bottom:6px;">
    <input id="plUrl" placeholder="URL de la liste M3U">
    <button id="plAdd">Ajouter</button>`;
  wrap.appendChild(form);
  form.querySelector('#plAdd').onclick = () => {
    const name = form.querySelector('#plName').value.trim();
    const url  = form.querySelector('#plUrl').value.trim();
    if (!url) return;
    userPlaylists.unshift({ name: name || url, url });
    saveLS(LS.playlists, userPlaylists);
    renderPlaylists();
  };

  listDiv.appendChild(wrap);
}
function renderList(){
  listDiv.innerHTML = '';
  if (mode==='channels') renderCategories(); else catBar.innerHTML = '';
// Barre d'action spécifique à l'historique
if (mode === 'history') {
  const bar = document.createElement('div');
  bar.className = 'history-toolbar';
  bar.innerHTML = `
    <button id="btnClearHistory" class="btn-danger" title="Effacer tout l'historique">🧹 Effacer l'historique</button>
  `;
  bar.querySelector('#btnClearHistory').onclick = () => {
    if (confirm('Effacer tout l’historique ?')) clearHistory();
  };
  listDiv.appendChild(bar);
}

  let data = [];
  if (mode==='channels') data = channels;
  if (mode==='favorites') data = favorites;
  if (mode==='history') data = historyList.map(u => ({url:u, name:u}));
  if (mode==='playlists') { renderPlaylists(); return; }

  if (mode==='channels' && categoryFilter!=='ALL') data = data.filter(x=>x.group===categoryFilter);
  if (channelFilter) data = data.filter(x => (x.name||x.url).toLowerCase().includes(channelFilter.toLowerCase()));

  data.forEach(item=>{
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="left">
        <span class="logo-sm">${renderLogo(item.logo)}</span>
        <div class="meta">
          <div class="name">${escapeHtml(item.name||item.url)}</div>
          ${ item.group ? `<div class="sub" style="font-size:.8em;opacity:.7">${escapeHtml(item.group)}</div>` : '' }
        </div>
      </div>
      <span class="star">${isFav(item.url) ? '★' : '☆'}</span>
    `;
    div.onclick = () => {
      try { resetPlayers(); } catch {}
      if (noSource) noSource.style.display = 'none';
      playByType(item.url);
      updateNowBar(item.name || item.url, item.url);
      try {
        if (video && video.style.display === 'block') {
          video.muted = false;            // anti-autoplay
          const p = video.play();
          if (p && p.catch) p.catch(()=>{});
        }
      } catch {}
      addHistory(item.url);
    };
    div.querySelector('.star').onclick = (e)=>{
      e.stopPropagation();
      toggleFavorite(item);
      renderList();
    };
    listDiv.appendChild(div);
  });

  if (!data.length) listDiv.innerHTML = '<p style="opacity:.6;padding:10px;">Aucune donnée.</p>';
}

// --- Tabs ---
function switchTab(t){
  mode = t;
  Object.values(tabs).forEach(b => b && b.classList.remove('active'));
  tabs[t] && tabs[t].classList.add('active');
  renderList();
  if (t==='playlists') ensureDefaultPlaylistsLoaded();
}
tabs.channels && (tabs.channels.onclick = ()=>switchTab('channels'));
tabs.favorites && (tabs.favorites.onclick = ()=>switchTab('favorites'));
tabs.history && (tabs.history.onclick   = ()=>switchTab('history'));
tabs.playlists && (tabs.playlists.onclick=()=>switchTab('playlists'));

// --- Controls ---
loadBtn && (loadBtn.onclick = ()=>{
  const v = (input.value||'').trim();
  if (!v) return;
  resetPlayers();
  if (noSource) noSource.style.display = 'none';
  playByType(v);
  updateNowBar(v, v);
  addHistory(v);
});
fileInput && (fileInput.onchange = async (e)=>{
  const f = e.target.files?.[0]; if (!f) return;
  const txt = await f.text();
  parseM3U(txt);
});
searchInput && (searchInput.oninput = (e) => {
  channelFilter = e.target.value || '';
  renderList();
});

// --- Playlists par défaut (à la demande) ---
async function ensureDefaultPlaylistsLoaded(force){
  if (defaultPlaylists.length && !force) return;
  try{
    const res = await fetch('playlists.json', { cache:'no-store' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    defaultPlaylists = (data.playlists||[]).filter(x => x.url);
  }catch(e){
    console.warn('[playlists.json]', e);
    defaultPlaylists = [];
  }finally{
    if (mode==='playlists') renderPlaylists();
  }
}

// --- Init ---
(function init(){
  // thème
  const t = loadLS(LS.theme, 'dark');
  if (t==='light') document.body.classList.add('light');

  // dernière URL (pas d’autoplay, juste remplir le champ)
  const last = loadLS(LS.last, '');
  if (last && input) input.value = last;

  // rendu initial (aucun fetch ici)
  renderList();

  // fermer le splash quoi qu'il arrive (2s)
  const splash = document.getElementById('splash');
  setTimeout(()=>{ if (splash){ splash.classList.add('hidden'); setTimeout(()=>splash.remove(),600);} }, 2000);

  console.log('[IPTV] RESCUE script chargé');
})();
// --- Ajuste la hauteur disponible pour le player (Chaînes & co.)
function updatePlayerLayout() {
  try {
    const root = document.documentElement;
    const header = document.querySelector('header');
    const headerH = header ? header.offsetHeight : 0;
    root.style.setProperty('--header-h', headerH + 'px');
  } catch (e) { console.warn('[layout]', e); }
}

// Appels initiaux + écoute redimensionnement/orientation
window.addEventListener('resize', updatePlayerLayout);
window.addEventListener('orientationchange', updatePlayerLayout);
document.addEventListener('DOMContentLoaded', updatePlayerLayout);
// petit tick pour after-paint (polices chargées etc.)
setTimeout(updatePlayerLayout, 50);

// --- Ferme le splash dans tous les cas ---
(function killSplash(){
  const s = document.getElementById('splash');
  if (!s) return;
  const hide = () => { s.classList.add('hidden'); setTimeout(()=>s.remove?.(), 600); };
  setTimeout(hide, 2200);                           // auto-hide
  document.addEventListener('DOMContentLoaded', hide, { once:true });
  window.addEventListener('load', hide, { once:true });
  s.addEventListener('click', hide, { once:true });  // clic = fermer
})();

// Petit toast (optionnel) pour confirmer l'action
function showToast(msg){
  try {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1600);
  } catch {}
}

// Effacer l'historique (mémoire + écran)
function clearHistory(){
  try {
    historyList = [];
    saveLS(LS.hist, historyList);   // LS.hist = 'iptv.history'
    if (mode === 'history') renderList();
    showToast('Historique effacé ✅');
  } catch(e){
    console.error('[clearHistory]', e);
  }
}

// === Thème clair/sombre — init SAFE (anti-conflit) =======================
(() => {
  // Empêche une double initialisation si le code est chargé 2x
  if (window.__IPTV_THEME_INIT__) return;
  window.__IPTV_THEME_INIT__ = true;

  const LSKEY = 'theme';
  const btn = document.getElementById('themeToggle');

  const apply = (t) => {
    const isLight = t === 'light';
    document.body.classList.toggle('light', isLight);
    try { localStorage.setItem(LSKEY, isLight ? 'light' : 'dark'); } catch {}
    if (btn) btn.textContent = isLight ? '☀️' : '🌙';
  };

  // init: préférence sauvegardée > préférence système > sombre
  let t = 'dark';
  try {
    const saved = localStorage.getItem(LSKEY);
    if (saved === 'light' || saved === 'dark') t = saved;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) t = 'light';
  } catch {}
  apply(t);

  // handler unique (écrase les anciens avec onclick)
  if (btn) {
    btn.onclick = () => apply(document.body.classList.contains('light') ? 'dark' : 'light');
  }
})();



