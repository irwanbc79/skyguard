// Helper functions for ENote pages
window.getEnoteSectionPage = function(num) {
    const pages = {1:5,2:39,3:98,4:120,5:180,6:220,7:642,8:728,9:747,10:783,11:845,12:993,13:1014,14:1066,15:1090,16:1243,17:1527,18:1571,19:1681,20:1687,21:1726};
    return pages[num] || 1;
}

window.getEnoteChapterPage = function(num) {
    const pages = {1:5,2:9,3:15,4:25,5:31,6:39,7:43,8:51,9:58,10:64,11:68,12:76,13:86,14:92,15:98,16:120,17:126,18:132,19:135,20:144,21:152,22:160,23:168,24:177,25:180,26:200,27:209,28:222,29:432,30:508,31:519,32:525,33:529,34:540,35:551,36:560,37:569,38:590,39:613,40:680,41:727,42:739,43:746,44:750,45:792,46:800,47:805,48:817,49:869,50:886,51:893,52:895,53:900,54:903,55:906,56:908,57:908,58:915,59:936,60:948,61:952,62:970,63:982,64:993,65:1001,66:1007,67:1010,68:1014,69:1029,70:1043,71:1066,72:1094,73:1131,74:1159,75:1173,76:1180,77:1185,78:1190,79:1195,80:1200,81:1205,82:1216,83:1232,84:1250,85:1447,86:1531,87:1540,88:1560,89:1565,90:1571,91:1654,92:1670,93:1681,94:1687,95:1698,96:1708,97:1726};
    return pages[num] || 1;
}

// ========== MODAL CATATAN ==========
window.showNoteModal = function(type, num) {
    const endpoint = type === 'section' ? '/api/hs/notes/section/' : '/api/hs/notes/chapter/';
    const typeLabel = type === 'section' ? 'Bagian' : 'Bab';
    
    const modalHtml = `
        <div id="noteModal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onclick="if(event.target.id==='noteModal')closeNoteModal()">
            <div class="bg-gray-800 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl">
                <div class="p-6 border-b border-gray-700 flex justify-between items-center">
                    <h3 class="text-xl font-bold text-white">
                        <i class="fas fa-bookmark mr-2 text-amber-400"></i>
                        Catatan ${typeLabel} ${num}
                    </h3>
                    <button onclick="window.closeNoteModal()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
                </div>
                <div id="noteContent" class="p-6 overflow-y-auto max-h-[60vh]">
                    <div class="flex items-center justify-center py-8">
                        <i class="fas fa-spinner fa-spin text-3xl text-amber-400"></i>
                        <span class="ml-3 text-gray-400">Memuat catatan...</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    fetch(endpoint + num)
        .then(res => res.json())
        .then(data => {
            const noteDiv = document.getElementById('noteContent');
            if (data.success && data.note) {
                const formattedNote = data.note.replace(/\n/g, '<br>');
                noteDiv.innerHTML = `
                    <div class="mb-4">
                        <h4 class="text-lg font-semibold text-amber-400 mb-3">${data.title || 'Catatan'}</h4>
                        <div class="text-gray-300 leading-relaxed whitespace-pre-line">${formattedNote}</div>
                    </div>
                    <div class="mt-6 pt-4 border-t border-gray-700">
                        <a href="/docs/enote-btki-2022.pdf#page=${type === 'section' ? getEnoteSectionPage(num) : getEnoteChapterPage(num)}" 
                           target="_blank" 
                           class="inline-flex items-center text-cyan-400 hover:text-cyan-300">
                            <i class="fas fa-file-pdf mr-2"></i>Lihat PDF Lengkap
                        </a>
                    </div>
                `;
            } else {
                noteDiv.innerHTML = `
                    <div class="text-center py-8">
                        <i class="fas fa-info-circle text-4xl text-gray-500 mb-4"></i>
                        <p class="text-gray-400">${data.note || 'Catatan belum tersedia.'}</p>
                        <a href="/docs/enote-btki-2022.pdf#page=${type === 'section' ? getEnoteSectionPage(num) : getEnoteChapterPage(num)}" 
                           target="_blank" 
                           class="inline-flex items-center text-cyan-400 hover:text-cyan-300 mt-4">
                            <i class="fas fa-file-pdf mr-2"></i>Lihat PDF Lengkap
                        </a>
                    </div>
                `;
            }
        })
        .catch(err => {
            document.getElementById('noteContent').innerHTML = `
                <div class="text-center py-8 text-red-400">
                    <i class="fas fa-exclamation-circle text-4xl mb-4"></i>
                    <p>Gagal memuat catatan.</p>
                </div>
            `;
        });
}

window.closeNoteModal = function() {
    const modal = document.getElementById('noteModal');
    if (modal) modal.remove();
}
// ========== END MODAL CATATAN ==========


// ==========================================
// HS CODE EXPLORER MOLECULAR JAVASCRIPT
// ==========================================

// Global state
let explorerLocale = 'id'; // 'id' or 'en'
let hsState = {
  currentSection: null,
  currentChapter: null,
  searchQuery: '',
  viewMode: 'sections' // 'sections', 'chapters', 'hsList'
};

// Physics parameters
const PHYSICS_CONFIG = {
  kCenter: 0.015,
  kRepulsion: 1800,
  kLink: 0.04,
  damp: 0.82,
  minDistBonus: 40
};

// Roman numerals mapping
const romanNumerals = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI'];

// Molecular graph data structures
let canvas, ctx;
let nodes = [];
let links = [];
let draggedNode = null;
let hoveredNode = null;
let starfield = [];
let animationId = null;

// Initialize Molecular Graph Canvas
function initMolecularCanvas() {
  canvas = document.getElementById('hsMolecularCanvas');
  if (!canvas) return;
  
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  // Setup mouse/touch interactions
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseLeave);
  
  // Generate background starfield
  starfield = [];
  for (let i = 0; i < 40; i++) {
    starfield.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.5 + 0.2,
      speed: Math.random() * 0.02 + 0.005
    });
  }
  
  // Start animation loop
  if (animationId) cancelAnimationFrame(animationId);
  animationLoop();
}

function resizeCanvas() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = 500 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

// Word bigram similarity matching (Dice's Coefficient)
function getBigramSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  s1 = s1.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  s2 = s2.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0;
  
  let bigrams1 = new Map();
  for (let i = 0; i < s1.length - 1; i++) {
    const bigram = s1.slice(i, i + 2);
    bigrams1.set(bigram, (bigrams1.get(bigram) || 0) + 1);
  }
  
  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bigram = s2.slice(i, i + 2);
    const count = bigrams1.get(bigram) || 0;
    if (count > 0) {
      intersection++;
      bigrams1.set(bigram, count - 1);
    }
  }
  
  return (2.0 * intersection) / (s1.length + s2.length - 2);
}

// Calculate total similarity score (supporting exact substrings and Dice's score in both lang)
function getRelevanceScore(query, item) {
  const q = query.toLowerCase().trim();
  const descId = (item.descriptionId || '').toLowerCase();
  const descEn = (item.descriptionEn || '').toLowerCase();
  const code = (item.hsCode || '').replace(/\./g, '');
  
  // High score for exact code start
  if (code.startsWith(q.replace(/\./g, ''))) {
    return 1.0;
  }
  
  const hasSubId = descId.includes(q);
  const hasSubEn = descEn.includes(q);
  
  const simId = getBigramSimilarity(q, descId);
  const simEn = getBigramSimilarity(q, descEn);
  const maxSim = Math.max(simId, simEn);
  
  if (hasSubId || hasSubEn) {
    return Math.max(0.65 + maxSim * 0.35, maxSim);
  }
  return maxSim;
}

// Local UI strings
const UI_STRINGS = {
  id: {
    title: 'HS Code Explorer',
    subtitle: 'BTKI 2022 - Buku Tarif Kepabeanan Indonesia',
    sections: 'Bagian',
    chapters: 'Bab',
    tariffs: 'Pos Tarif',
    placeholder: 'Cari kode HS atau uraian barang dalam ID/EN...',
    all_sections: 'Semua Bagian',
    insw_ref: 'Data BTKI 2022 (Agustus). Untuk tarif terkini, cek di',
    loading_sections: 'Membuat jaringan molekul bagian...',
    loading_chapters: 'Mempercepat ikatan molekul bab...',
    loading_hs: 'Menyusun orbital pos tarif...',
    relevance: 'Kemiripan',
    bm: 'Bea Masuk',
    ppn: 'PPN',
    ppnbm: 'PPnBM',
    excess: 'Lartas / Keterangan',
    btn_all: 'Semua',
    btn_4: 'Pos 4 Digit',
    btn_6: 'Sub-Pos 6 Digit',
    btn_8: 'BTKI 8+ Digit',
    sitemap_title: 'Hierarki Klasifikasi',
    insw_btn: 'Cek di INSW',
    copy_btn: 'Salin Kode',
    toast_copy: 'Disalin',
    triple_title: '3 JAWABAN TERDEKAT (NUKLEUS)',
    other_results: 'Molekul Satelit Terkait',
    no_results: 'Tidak ditemukan molekul HS untuk kata kunci tersebut.',
    guide_tip: 'Tarik node untuk menggeser, klik node untuk masuk atau melihat detail.'
  },
  en: {
    title: 'HS Code Explorer',
    subtitle: 'BTKI 2022 - Indonesian Customs Tariff Book',
    sections: 'Sections',
    chapters: 'Chapters',
    tariffs: 'Tariff Lines',
    placeholder: 'Search HS codes or goods description in ID/EN...',
    all_sections: 'All Sections',
    insw_ref: 'BTKI 2022 Data (August). For live updates, verify at',
    loading_sections: 'Loading section molecular network...',
    loading_chapters: 'Accelerating chapter covalent bonds...',
    loading_hs: 'Arranging tariff line orbitals...',
    relevance: 'Relevance',
    bm: 'Import Duty',
    ppn: 'VAT',
    ppnbm: 'Surtax',
    excess: 'Restricted / Info',
    btn_all: 'All',
    btn_4: 'Heading 4-Digit',
    btn_6: 'Subheading 6-Digit',
    btn_8: 'BTKI 8+ Digit',
    sitemap_title: 'Classification Hierarchy',
    insw_btn: 'Verify on INSW',
    copy_btn: 'Copy Code',
    toast_copy: 'Copied',
    triple_title: '3 CLOSEST MATCHES (NUCLEUS)',
    other_results: 'Related Satellite Molecules',
    no_results: 'No HS molecules found matching your keyword.',
    guide_tip: 'Drag nodes to shift, click nodes to enter or view details.'
  }
};

// Set locale dynamically
window.setExplorerLocale = function(locale) {
  explorerLocale = locale;
  
  // Toggle active button states
  const btnId = document.getElementById('btnLocaleId');
  const btnEn = document.getElementById('btnLocaleEn');
  if (btnId && btnEn) {
    if (locale === 'id') {
      btnId.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-purple-500 text-white';
      btnEn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-gray-400 hover:text-white';
    } else {
      btnEn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-purple-500 text-white';
      btnId.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-gray-400 hover:text-white';
    }
  }
  
  // Re-localize static text labels
  const textTitle = document.getElementById('hsExpTitle');
  if (textTitle) textTitle.textContent = UI_STRINGS[locale].title;
  const textSub = document.getElementById('hsExpSubtitle');
  if (textSub) textSub.textContent = UI_STRINGS[locale].subtitle;
  const textSearch = document.getElementById('hsSearchInput');
  if (textSearch) textSearch.placeholder = UI_STRINGS[locale].placeholder;
  const textSec = document.getElementById('lblStatSec');
  if (textSec) textSec.textContent = UI_STRINGS[locale].sections;
  const textCh = document.getElementById('lblStatCh');
  if (textCh) textCh.textContent = UI_STRINGS[locale].chapters;
  const textTar = document.getElementById('lblStatTar');
  if (textTar) textTar.textContent = UI_STRINGS[locale].tariffs;
  
  // Refresh views to match new language
  if (hsState.searchQuery) {
    searchHSCodes(hsState.searchQuery);
  } else if (hsState.viewMode === 'sections') {
    loadHSSections();
  } else if (hsState.viewMode === 'chapters') {
    loadSectionChapters(hsState.currentSection);
  } else if (hsState.viewMode === 'hsList') {
    loadChapterHS(hsState.currentChapter);
  }
};

// Get HTML Template for Explorer
function getHSExplorerHTML() {
  const t = UI_STRINGS[explorerLocale];
  return `
    <div class="space-y-6">
      <!-- Header Card -->
      <div class="glass-card rounded-2xl p-6">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div class="flex items-center gap-3.5">
            <span class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <i class="fas fa-search-dollar text-xl text-white"></i>
            </span>
            <div>
              <h2 class="text-2xl font-bold text-white tracking-tight" id="hsExpTitle">${t.title}</h2>
              <p class="text-gray-400 text-sm mt-0.5" id="hsExpSubtitle">${t.subtitle}</p>
            </div>
          </div>
          
          <div class="flex items-center gap-4">
            <!-- Language Toggle Group -->
            <div class="flex bg-white/5 rounded-xl border border-white/10 p-1 flex-shrink-0">
              <button onclick="setExplorerLocale('id')" id="btnLocaleId" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${explorerLocale === 'id' ? 'bg-purple-500 text-white' : 'text-gray-400 hover:text-white'}">ID</button>
              <button onclick="setExplorerLocale('en')" id="btnLocaleEn" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${explorerLocale === 'en' ? 'bg-purple-500 text-white' : 'text-gray-400 hover:text-white'}">EN</button>
            </div>
            
            <!-- Quick Stats -->
            <div id="hsStats" class="flex gap-3 text-center">
              <div class="bg-white/5 rounded-xl px-3 py-1.5 border border-white/5">
                <div class="text-lg font-bold text-purple-400" id="statSections">21</div>
                <div class="text-[10px] text-gray-400 uppercase tracking-wider" id="lblStatSec">${t.sections}</div>
              </div>
              <div class="bg-white/5 rounded-xl px-3 py-1.5 border border-white/5">
                <div class="text-lg font-bold text-cyan-400" id="statChapters">97</div>
                <div class="text-[10px] text-gray-400 uppercase tracking-wider" id="lblStatCh">${t.chapters}</div>
              </div>
              <div class="bg-white/5 rounded-xl px-3 py-1.5 border border-white/5">
                <div class="text-lg font-bold text-green-400" id="statHS">-</div>
                <div class="text-[10px] text-gray-400 uppercase tracking-wider" id="lblStatTar">${t.tariffs}</div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Search Bar -->
        <div class="mt-6">
          <div class="relative">
            <input type="text" id="hsSearchInput" 
              placeholder="${t.placeholder}"
              class="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 pl-12 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all">
            <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
            <div id="hsSearchLoading" class="absolute right-4 top-1/2 -translate-y-1/2 hidden">
              <i class="fas fa-spinner fa-spin text-purple-400"></i>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Breadcrumb -->
      <div id="hsBreadcrumb" class="flex items-center gap-2 text-sm text-gray-400 px-2 font-medium">
        <button onclick="loadHSSections()" class="hover:text-white transition-colors">
          <i class="fas fa-home mr-1"></i> ${t.all_sections}
        </button>
      </div>
      
      <!-- Interactive Molecular Container -->
      <div class="relative w-full rounded-2xl border border-white/10 bg-slate-950 overflow-hidden group shadow-2xl">
        <!-- Floating Interactive Canvas -->
        <canvas id="hsMolecularCanvas" class="w-full block"></canvas>
        
        <!-- Navigation Guide Tip -->
        <div class="absolute bottom-4 left-4 text-xs text-gray-500 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-white/5 backdrop-blur-sm pointer-events-none select-none">
          <i class="fas fa-hand-pointer mr-1.5 text-purple-400 animate-pulse"></i>
          <span id="canvasGuideText">${t.guide_tip}</span>
        </div>
        
        <!-- Interactive Node Tooltip -->
        <div id="hsNodeTooltip" class="absolute hidden bg-slate-900/90 border border-white/15 rounded-xl p-4 shadow-2xl text-xs text-white max-w-sm z-30 pointer-events-none backdrop-blur-sm"></div>
      </div>
      
      <!-- Bottom Section / Detailed Listing -->
      <div id="hsMainContent" class="space-y-4">
        <!-- Tabular list fallback / details rendered here -->
      </div>
      
      <!-- INSW Reference -->
      <div class="glass-card rounded-xl p-4 text-center">
        <p class="text-gray-400 text-sm">
          <i class="fas fa-info-circle mr-2 text-cyan-400"></i>
          <span id="lblInswRef">${t.insw_ref}</span>
          <a href="https://www.insw.go.id/intr" target="_blank" class="text-cyan-400 hover:text-cyan-300 underline font-semibold ml-1">
            INSW - Indonesia National Single Window
          </a>
        </p>
      </div>
    </div>
  `;
}

// Load HS Explorer module
function loadBarangContent(subId) {
  const container = document.getElementById('content-barang');
  if (!container) return;
  
  container.innerHTML = getHSExplorerHTML();
  
  setTimeout(() => {
    initMolecularCanvas();
    loadHSSections();
    setupHSSearch();
  }, 100);
}

// Set up Search Box
function setupHSSearch() {
  const input = document.getElementById('hsSearchInput');
  if (!input) return;
  
  let debounceTimer;
  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();
    hsState.searchQuery = query;
    
    if (query.length < 2) {
      if (hsState.viewMode === 'sections') {
        loadHSSections();
      } else if (hsState.viewMode === 'chapters') {
        loadSectionChapters(hsState.currentSection);
      } else {
        loadChapterHS(hsState.currentChapter);
      }
      return;
    }
    
    document.getElementById('hsSearchLoading').classList.remove('hidden');
    debounceTimer = setTimeout(() => {
      searchHSCodes(query);
    }, 400);
  });
}

// Core Physics-Based Particle Animation Loop
function animationLoop() {
  if (!canvas || !ctx) return;
  
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;
  
  ctx.clearRect(0, 0, w, h);
  
  // 1. Draw Space Background (Cosmic Stars)
  starfield.forEach(s => {
    s.alpha += s.speed;
    if (s.alpha > 0.8 || s.alpha < 0.1) s.speed = -s.speed;
    ctx.fillStyle = `rgba(147, 197, 253, ${s.alpha})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  });
  
  // 2. Physics Simulation Update
  if (nodes.length > 0) {
    const kCenter = PHYSICS_CONFIG.kCenter;
    const kRepulsion = PHYSICS_CONFIG.kRepulsion;
    const kLink = PHYSICS_CONFIG.kLink;
    const damp = PHYSICS_CONFIG.damp;
    
    const centerX = w / 2;
    const centerY = h / 2;
    
    // Apply center attraction gravity
    nodes.forEach(n => {
      if (n === draggedNode) return;
      n.vx += (centerX - n.x) * kCenter;
      n.vy += (centerY - n.y) * kCenter;
    });
    
    // Apply spring link forces
    links.forEach(link => {
      const source = nodes[link.source];
      const target = nodes[link.target];
      if (!source || !target) return;
      
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - link.distance) * kLink;
      
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      
      if (source !== draggedNode) {
        source.vx += fx;
        source.vy += fy;
      }
      if (target !== draggedNode) {
        target.vx -= fx;
        target.vy -= fy;
      }
    });
    
    // Apply repulsion between nodes
    for (let i = 0; i < nodes.length; i++) {
      const n1 = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const n2 = nodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        const minDist = n1.radius + n2.radius + PHYSICS_CONFIG.minDistBonus;
        if (dist < minDist) {
          const force = (minDist - dist) * 0.08;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          
          if (n1 !== draggedNode) {
            n1.vx -= fx;
            n1.vy -= fy;
          }
          if (n2 !== draggedNode) {
            n2.vx += fx;
            n2.vy += fy;
          }
        }
      }
    }
    
    // Apply inertia and screen boundaries
    nodes.forEach(n => {
      if (n === draggedNode) return;
      n.x += n.vx;
      n.y += n.vy;
      n.vx *= damp;
      n.vy *= damp;
      
      // Boundary checks
      n.x = Math.max(n.radius + 10, Math.min(w - n.radius - 10, n.x));
      n.y = Math.max(n.radius + 10, Math.min(h - n.radius - 10, n.y));
    });
  }
  
  // 3. Draw Covalent Links (Connections)
  links.forEach(link => {
    const source = nodes[link.source];
    const target = nodes[link.target];
    if (!source || !target) return;
    
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    
    // Color link: glow connection based on compliance/hierarchy status
    let strokeColor = 'rgba(255, 255, 255, 0.08)';
    if (source.isNucleus && target.isNucleus) {
      strokeColor = 'rgba(168, 85, 247, 0.4)'; // Purple neon
    } else if (source.color === '#10b981' || target.color === '#10b981') {
      strokeColor = 'rgba(16, 185, 129, 0.15)'; // Green neon
    } else if (source.color === '#06b6d4' || target.color === '#06b6d4') {
      strokeColor = 'rgba(6, 182, 212, 0.15)'; // Cyan neon
    }
    
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = source.isNucleus ? 2.5 : 1.2;
    ctx.stroke();
  });
  
  // 4. Draw Molecular Nodes
  nodes.forEach(n => {
    // Glow effect
    ctx.shadowColor = n.color;
    ctx.shadowBlur = hoveredNode === n ? 25 : n.isNucleus ? 15 : 5;
    
    // Spherical Glass Radial Gradient
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    
    const grad = ctx.createRadialGradient(
      n.x - n.radius/3, n.y - n.radius/3, n.radius/10,
      n.x, n.y, n.radius
    );
    
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.2, n.color + '44');
    grad.addColorStop(0.9, n.color + '15');
    grad.addColorStop(1, '#020617');
    
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Draw Glass Outline Ring
    ctx.strokeStyle = hoveredNode === n ? '#ffffff' : n.color + '77';
    ctx.lineWidth = hoveredNode === n ? 2 : 1;
    ctx.stroke();
    
    // Clear shadow properties for performance/clean text
    ctx.shadowBlur = 0;
    
    // Draw Label Text inside Node (e.g. HS Code prefix or Section num)
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${n.isNucleus ? 13 : 11}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.label, n.x, n.y);
    
    // Draw matched percentage if Nucleus (AI relevance score)
    if (n.isNucleus && n.score) {
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 9px system-ui';
      ctx.fillText(`${Math.round(n.score * 100)}%`, n.x, n.y + 16);
    }
  });
  
  animationId = requestAnimationFrame(animationLoop);
}

// Search HS Codes and generate Molecular Network
async function searchHSCodes(query) {
  try {
    const response = await fetch(`/api/hs/search?q=${encodeURIComponent(query)}&limit=45`);
    const result = await response.json();
    
    document.getElementById('hsSearchLoading').classList.add('hidden');
    
    const listContainer = document.getElementById('hsMainContent');
    if (!result.success || !result.data.length) {
      listContainer.innerHTML = `
        <div class="glass-card rounded-xl p-8 text-center text-gray-400 border border-white/5">
          <i class="fas fa-search-minus text-4xl mb-3 text-purple-400/60"></i>
          <p>${UI_STRINGS[explorerLocale].no_results}</p>
        </div>
      `;
      // Clear molecular nodes
      nodes = [];
      links = [];
      return;
    }
    
    // 1. Calculate relevance scores in the client side
    const scoredData = result.data.map(item => {
      const score = getRelevanceScore(query, item);
      return { ...item, score };
    }).sort((a, b) => b.score - a.score);
    
    // 2. Identify Triple Nucleus
    const tripleNucleus = scoredData.slice(0, 3);
    const satelliteNodes = scoredData.slice(3, 18); // limit satellite count for performance
    
    // 3. Build Molecular Graph Data
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;
    
    nodes = [];
    links = [];
    
    // Add 3 Nucleus Nodes in the Center
    tripleNucleus.forEach((item, idx) => {
      // Color-coding based on compliance/lartas status (e.g. duty rating or placeholder BM)
      const duty = parseFloat(item.importDuty);
      let color = '#a855f7'; // Purple nucleus by default
      if (duty > 10) color = '#ef4444'; // Red restricted/high duty
      else if (duty === 0) color = '#10b981'; // Green safe duty-free
      
      nodes.push({
        id: `nucleus_${idx}`,
        label: item.hsCode.replace(/\./g, '').slice(0, 4),
        hsCode: item.hsCode,
        descriptionId: item.descriptionId,
        descriptionEn: item.descriptionEn,
        importDuty: item.importDuty,
        ppn: item.ppn,
        ppnbm: item.ppnbm,
        isNucleus: true,
        score: item.score,
        x: w/2 + (idx - 1) * 90,
        y: h/2 + (idx === 1 ? -30 : 20),
        vx: 0,
        vy: 0,
        radius: 36,
        color: color
      });
    });
    
    // Connect the 3 Nucleus nodes together in a core ring/triangle
    if (nodes.length >= 2) links.push({ source: 0, target: 1, distance: 95 });
    if (nodes.length >= 3) {
      links.push({ source: 1, target: 2, distance: 95 });
      links.push({ source: 2, target: 0, distance: 95 });
    }
    
    // Add Satellite Nodes orbiting around the center
    satelliteNodes.forEach((item, idx) => {
      const duty = parseFloat(item.importDuty);
      let color = '#06b6d4'; // Cyan default satellite
      if (duty > 10) color = '#f59e0b'; // Amber high duty
      else if (duty === 0) color = '#10b981';
      
      const angle = (idx / satelliteNodes.length) * Math.PI * 2;
      const radiusDist = Math.random() * 80 + 160;
      
      nodes.push({
        id: `sat_${idx}`,
        label: item.hsCode.replace(/\./g, '').slice(0, 4),
        hsCode: item.hsCode,
        descriptionId: item.descriptionId,
        descriptionEn: item.descriptionEn,
        importDuty: item.importDuty,
        ppn: item.ppn,
        ppnbm: item.ppnbm,
        isNucleus: false,
        score: item.score,
        x: w/2 + Math.cos(angle) * radiusDist,
        y: h/2 + Math.sin(angle) * radiusDist,
        vx: 0,
        vy: 0,
        radius: 24,
        color: color
      });
      
      // Connect each satellite to one of the 3 Nucleus nodes randomly to build network bonds
      const targetNucleusIdx = idx % Math.min(3, tripleNucleus.length);
      links.push({
        source: nodes.length - 1,
        target: targetNucleusIdx,
        distance: 120
      });
    });
    
    // 4. Render HTML Results below the canvas
    const t = UI_STRINGS[explorerLocale];
    listContainer.innerHTML = `
      <!-- Triple Nucleus Matches -->
      <div class="glass-card rounded-2xl p-6 border border-purple-500/20 bg-gradient-to-br from-slate-900 to-slate-950">
        <h3 class="font-black text-sm text-purple-400 tracking-wider mb-4 uppercase flex items-center gap-2">
          <i class="fas fa-atom text-purple-400 animate-spin" style="animation-duration:8s;"></i>
          ${t.triple_title}
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${tripleNucleus.map((hs, idx) => `
            <div onclick="showHSDetail('${hs.hsCode}')" 
                 class="relative p-5 rounded-xl border border-white/5 bg-slate-900/60 hover:bg-slate-900 cursor-pointer transition-all hover:-translate-y-1 group">
              <div class="absolute top-4 right-4 text-xs font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                ${t.relevance}: ${Math.round(hs.score * 100)}%
              </div>
              <span class="inline-block px-2.5 py-1 rounded bg-purple-500/20 text-purple-300 font-mono text-xs font-bold mb-3">
                ${hs.hsCode}
              </span>
              <p class="text-white text-sm font-semibold mb-1 truncate">${explorerLocale === 'id' ? hs.descriptionId : (hs.descriptionEn || hs.descriptionId)}</p>
              <p class="text-gray-400 text-xs line-clamp-2">${explorerLocale === 'id' ? (hs.descriptionEn || '') : hs.descriptionId}</p>
              
              <div class="flex gap-4 mt-4 text-xs pt-3 border-t border-white/5">
                <span class="text-gray-400">BM: <strong class="text-white">${hs.importDuty}%</strong></span>
                <span class="text-gray-400">PPN: <strong class="text-white">${hs.ppn}%</strong></span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <!-- Other Satellite Matches -->
      <div class="glass-card rounded-2xl p-6 border border-white/5">
        <h3 class="font-bold text-sm text-white/90 tracking-wide mb-4 uppercase">
          <i class="fas fa-network-wired mr-2 text-cyan-400"></i>
          ${t.other_results}
        </h3>
        <div class="space-y-2">
          ${satelliteNodes.map(hs => renderHSItem(hs)).join('')}
        </div>
      </div>
    `;
    
  } catch (error) {
    console.error('Search error:', error);
    document.getElementById('hsSearchLoading').classList.add('hidden');
  }
}

// Load Sections Network
async function loadHSSections() {
  hsState.viewMode = 'sections';
  hsState.currentSection = null;
  hsState.currentChapter = null;
  
  updateBreadcrumb([{ label: UI_STRINGS[explorerLocale].all_sections, action: 'loadHSSections()' }]);
  
  const container = document.getElementById('hsMainContent');
  if (container) {
    container.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-spinner fa-spin text-4xl text-purple-400"></i>
        <p class="text-gray-400 mt-4">${UI_STRINGS[explorerLocale].loading_sections}</p>
      </div>
    `;
  }
  
  try {
    const response = await fetch('/api/hs/sections');
    const result = await response.json();
    
    if (!result.success) throw new Error(result.error);
    
    // Update stats
    document.getElementById('statSections').textContent = result.data.length;
    
    const statsRes = await fetch('/api/hs/stats');
    const statsData = await statsRes.json();
    if (statsData.success) {
      document.getElementById('statHS').textContent = statsData.stats.totalHS.toLocaleString();
      document.getElementById('statChapters').textContent = statsData.stats.totalChapters;
    }
    
    // Construct Section Nodes for the Canvas
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;
    
    nodes = [];
    links = [];
    
    result.data.forEach((sec, idx) => {
      const angle = (idx / result.data.length) * Math.PI * 2;
      const radiusDist = 130;
      
      // Group colors by sets
      const colors = ['#a855f7', '#06b6d4', '#10b981', '#f59e0b', '#3b82f6', '#ec4899'];
      const color = colors[idx % colors.length];
      
      nodes.push({
        id: `section_${sec.sectionNumber}`,
        label: romanNumerals[sec.sectionNumber - 1] || String(sec.sectionNumber),
        sectionNumber: sec.sectionNumber,
        titleId: sec.titleId,
        titleEn: sec.titleEn,
        type: 'section',
        x: w/2 + Math.cos(angle) * radiusDist,
        y: h/2 + Math.sin(angle) * radiusDist,
        vx: 0,
        vy: 0,
        radius: 28,
        color: color
      });
    });
    
    // Link sections sequentially to form a gorgeous cosmic ring
    for (let i = 0; i < nodes.length; i++) {
      links.push({
        source: i,
        target: (i + 1) % nodes.length,
        distance: 85
      });
    }
    
    // Render standard list at the bottom for accessibility
    if (container) {
      container.innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          ${result.data.map(sec => `
            <div onclick="loadSectionChapters('${sec.sectionNumber}')" 
                 class="glass-card rounded-xl p-4 hover:bg-white/10 cursor-pointer transition-all group border border-white/5 hover:border-purple-500/30">
              <div class="text-center">
                <div class="w-12 h-12 mx-auto rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3">
                  <span class="text-sm font-bold text-purple-400 font-mono">${romanNumerals[sec.sectionNumber - 1]}</span>
                </div>
                <h3 class="font-bold text-white text-xs group-hover:text-purple-300 transition-colors mb-1">
                  ${explorerLocale === 'id' ? `Bagian ${sec.sectionNumber}` : `Section ${sec.sectionNumber}`}
                </h3>
                <p class="text-gray-400 text-[10px] line-clamp-2 mb-2 font-body">${explorerLocale === 'id' ? sec.titleId : (sec.titleEn || sec.titleId)}</p>
                <div class="flex justify-center gap-3 text-[10px] text-slate-500">
                  <span><i class="fas fa-book mr-1 text-cyan-500/70"></i>${sec.chapters?.length || 0}</span>
                  <span><i class="fas fa-list mr-1 text-green-500/70"></i>${sec.hsCount?.toLocaleString() || 0}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
    
  } catch (error) {
    console.error('Error loading sections:', error);
  }
}

// Load Chapters Network
async function loadSectionChapters(sectionNumber) {
  hsState.viewMode = 'chapters';
  hsState.currentSection = sectionNumber;
  hsState.currentChapter = null;
  
  const container = document.getElementById('hsMainContent');
  if (container) {
    container.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-spinner fa-spin text-4xl text-cyan-400"></i>
        <p class="text-gray-400 mt-4">${UI_STRINGS[explorerLocale].loading_chapters}</p>
      </div>
    `;
  }
  
  try {
    const response = await fetch(`/api/hs/sections/${sectionNumber}/chapters`);
    const result = await response.json();
    
    if (!result.success) throw new Error(result.error);
    
    const section = result.section;
    
    updateBreadcrumb([
      { label: UI_STRINGS[explorerLocale].all_sections, action: 'loadHSSections()' },
      { label: explorerLocale === 'id' ? `Bagian ${sectionNumber}` : `Section ${sectionNumber}`, action: null }
    ]);
    
    // Construct Chapter Nodes
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;
    
    nodes = [];
    links = [];
    
    // Add central Section Node
    nodes.push({
      id: `section_${sectionNumber}`,
      label: romanNumerals[sectionNumber - 1],
      sectionNumber: sectionNumber,
      titleId: section.titleId,
      titleEn: section.titleEn,
      type: 'section_center',
      x: w/2,
      y: h/2,
      vx: 0,
      vy: 0,
      radius: 36,
      color: '#a855f7'
    });
    
    // Add Chapter Satellite Nodes orbiting around the center Section Node
    result.data.forEach((chapter, idx) => {
      const angle = (idx / result.data.length) * Math.PI * 2;
      const radiusDist = 120;
      
      nodes.push({
        id: `chapter_${chapter.chapterNumber}`,
        label: chapter.chapterNumber,
        chapterNumber: chapter.chapterNumber,
        titleId: chapter.titleId,
        titleEn: chapter.titleEn,
        type: 'chapter',
        x: w/2 + Math.cos(angle) * radiusDist,
        y: h/2 + Math.sin(angle) * radiusDist,
        vx: 0,
        vy: 0,
        radius: 24,
        color: '#06b6d4'
      });
      
      // Connect to center Section node
      links.push({
        source: idx + 1,
        target: 0,
        distance: 100
      });
    });
    
    if (container) {
      container.innerHTML = `
        <div class="glass-card rounded-xl p-5 border border-purple-500/20 bg-gradient-to-r from-purple-500/5 to-pink-500/5 mb-6">
          <h4 class="text-white font-bold text-base mb-1">${explorerLocale === 'id' ? `Bagian ${sectionNumber}` : `Section ${sectionNumber}`}</h4>
          <p class="text-gray-400 text-sm">${explorerLocale === 'id' ? section.titleId : (section.titleEn || section.titleId)}</p>
          <a href="javascript:void(0)" onclick="showNoteModal('section', ${sectionNumber})" 
             class="inline-flex items-center mt-3 text-xs text-yellow-400 hover:text-yellow-300 hover:underline font-semibold">
            <i class="fas fa-book-open mr-1.5"></i>${explorerLocale === 'id' ? 'Catatan Bagian' : 'Section Notes'}
          </a>
        </div>
        
        <div class="grid md:grid-cols-2 gap-4">
          ${result.data.map(ch => `
            <div onclick="loadChapterHS('${ch.chapterNumber}')" 
                 class="glass-card rounded-xl p-4 hover:bg-white/10 cursor-pointer transition-all border border-white/5 hover:border-cyan-500/30 group">
              <div class="flex items-start gap-4">
                <div class="w-10 h-10 rounded bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center flex-shrink-0 text-cyan-400 font-bold font-mono">
                  ${ch.chapterNumber}
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-bold text-white text-sm group-hover:text-cyan-300 transition-colors">
                    ${explorerLocale === 'id' ? `Bab ${parseInt(ch.chapterNumber)}` : `Chapter ${parseInt(ch.chapterNumber)}`}
                  </h3>
                  <p class="text-gray-400 text-xs mt-1 line-clamp-2 font-body">${explorerLocale === 'id' ? ch.titleId : (ch.titleEn || ch.titleId)}</p>
                  <span class="inline-block mt-2 text-[10px] text-green-400">
                    <i class="fas fa-list mr-1"></i> ${ch.hsCount?.toLocaleString() || 0} pos tarif
                  </span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
    
  } catch (error) {
    console.error('Error loading chapters:', error);
  }
}

// Load HS Codes List Network
async function loadChapterHS(chapterNumber) {
  hsState.viewMode = 'hsList';
  hsState.currentChapter = chapterNumber;
  
  const container = document.getElementById('hsMainContent');
  if (container) {
    container.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-spinner fa-spin text-4xl text-green-400"></i>
        <p class="text-gray-400 mt-4">${UI_STRINGS[explorerLocale].loading_hs}</p>
      </div>
    `;
  }
  
  try {
    const chaptersRes = await fetch('/api/hs/chapters');
    const chaptersData = await chaptersRes.json();
    const chapter = chaptersData.data?.find(c => c.chapterNumber === chapterNumber);
    
    const response = await fetch(`/api/hs/chapters/${chapterNumber}/hs`);
    const result = await response.json();
    
    if (!result.success) throw new Error(result.error);
    
    const sectionsRes = await fetch('/api/hs/sections');
    const sectionsData = await sectionsRes.json();
    const section = sectionsData.data?.find(s => s.chapters?.includes(chapterNumber));
    
    updateBreadcrumb([
      { label: UI_STRINGS[explorerLocale].all_sections, action: 'loadHSSections()' },
      { label: explorerLocale === 'id' ? `Bagian ${section?.sectionNumber || '-'}` : `Section ${section?.sectionNumber || '-'}`, action: `loadSectionChapters('${section?.sectionNumber}')` },
      { label: explorerLocale === 'id' ? `Bab ${chapterNumber}` : `Chapter ${chapterNumber}`, action: null }
    ]);
    
    // Group categories
    const pos4 = result.data.filter(h => h.level === 4);
    const subpos = result.data.filter(h => h.level === 6);
    const btki = result.data.filter(h => h.level === 8 || h.level === 10);
    
    // Construct Molecular nodes of HS codes in the chapter
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;
    
    nodes = [];
    links = [];
    
    // Central Chapter node
    nodes.push({
      id: `chapter_${chapterNumber}`,
      label: chapterNumber,
      chapterNumber: chapterNumber,
      titleId: chapter?.titleId,
      titleEn: chapter?.titleEn,
      type: 'chapter_center',
      x: w/2,
      y: h/2,
      vx: 0,
      vy: 0,
      radius: 34,
      color: '#10b981'
    });
    
    // Orbiting heading (4 digit) nodes
    pos4.slice(0, 12).forEach((heading, idx) => {
      const angle = (idx / Math.min(12, pos4.length)) * Math.PI * 2;
      const radiusDist = 120;
      
      nodes.push({
        id: `hs_${heading.hsCode}`,
        label: heading.hsCode.replace(/\./g, '').slice(0, 4),
        hsCode: heading.hsCode,
        descriptionId: heading.descriptionId,
        descriptionEn: heading.descriptionEn,
        type: 'hs_item',
        x: w/2 + Math.cos(angle) * radiusDist,
        y: h/2 + Math.sin(angle) * radiusDist,
        vx: 0,
        vy: 0,
        radius: 22,
        color: '#06b6d4'
      });
      
      // Link to chapter center
      links.push({
        source: idx + 1,
        target: 0,
        distance: 100
      });
    });
    
    if (container) {
      container.innerHTML = `
        <div class="glass-card rounded-xl p-5 border border-cyan-500/20 bg-gradient-to-r from-cyan-500/5 to-green-500/5 mb-6">
          <div class="flex justify-between items-start">
            <div>
              <h4 class="text-white font-bold text-base mb-1">${explorerLocale === 'id' ? `Bab ${parseInt(chapterNumber)}` : `Chapter ${parseInt(chapterNumber)}`}</h4>
              <p class="text-gray-400 text-sm">${explorerLocale === 'id' ? chapter?.titleId : (chapter?.titleEn || '')}</p>
            </div>
            <a href="javascript:void(0)" onclick="showNoteModal('chapter', ${chapterNumber})" 
               class="px-3 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 rounded-lg text-yellow-400 text-xs font-semibold transition-all">
              <i class="fas fa-book-open mr-1.5"></i>${explorerLocale === 'id' ? 'Catatan Bab' : 'Chapter Notes'}
            </a>
          </div>
          
          <div class="flex gap-3 mt-4 text-xs font-body">
            <span class="px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 font-semibold">${pos4.length} Heading</span>
            <span class="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-semibold">${subpos.length} Subheading</span>
            <span class="px-2 py-0.5 rounded bg-green-500/15 text-green-400 font-semibold">${btki.length} BTKI (8+)</span>
          </div>
        </div>
        
        <div class="flex gap-2 mb-4">
          <button onclick="filterHSLevel('all')" id="btnAll" class="px-4 py-2 rounded-lg bg-white/10 text-white text-xs font-semibold hover:bg-white/20 hs-filter-active">${UI_STRINGS[explorerLocale].btn_all} (${result.data.length})</button>
          <button onclick="filterHSLevel(4)" id="btn4" class="px-4 py-2 rounded-lg bg-white/5 text-gray-400 text-xs font-semibold hover:bg-white/10">${UI_STRINGS[explorerLocale].btn_4} (${pos4.length})</button>
          <button onclick="filterHSLevel(6)" id="btn6" class="px-4 py-2 rounded-lg bg-white/5 text-gray-400 text-xs font-semibold hover:bg-white/10">${UI_STRINGS[explorerLocale].btn_6} (${subpos.length})</button>
          <button onclick="filterHSLevel(8)" id="btn8" class="px-4 py-2 rounded-lg bg-white/5 text-gray-400 text-xs font-semibold hover:bg-white/10">${UI_STRINGS[explorerLocale].btn_8} (${btki.length})</button>
        </div>
        
        <div id="hsListContainer" class="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          ${result.data.map(hs => renderHSItem(hs)).join('')}
        </div>
      `;
      
      window.currentHSData = result.data;
    }
    
  } catch (error) {
    console.error('Error loading HS codes:', error);
  }
}

// Render Single HS Code Row Item
function renderHSItem(hs) {
  const indent = hs.level === 4 ? '' : hs.level === 6 ? 'pl-6' : 'pl-12';
  const bgColor = hs.level === 4 ? 'bg-purple-500/10 border-purple-500/20' : 
                  hs.level === 6 ? 'bg-cyan-500/5 border-cyan-500/10' : 
                  'bg-white/5 border-white/5';
  const codeColor = hs.level === 4 ? 'text-purple-400' : 
                    hs.level === 6 ? 'text-cyan-400' : 'text-green-400';
  
  return `
    <div onclick="showHSDetail('${hs.hsCode}')" 
         class="hs-item glass-card rounded-lg p-4 ${indent} ${bgColor} border hover:bg-white/10 cursor-pointer transition-all flex items-start gap-4"
         data-level="${hs.level}">
      <span class="font-mono font-bold ${codeColor} flex-shrink-0 w-28">${hs.hsCode}</span>
      <div class="flex-1 min-w-0">
        <p class="text-white text-sm font-semibold">${explorerLocale === 'id' ? hs.descriptionId : (hs.descriptionEn || hs.descriptionId)}</p>
        <p class="text-gray-500 text-xs mt-0.5">${explorerLocale === 'id' ? (hs.descriptionEn || '') : hs.descriptionId}</p>
      </div>
      <div class="flex-shrink-0 text-right space-y-1">
        ${hs.level === 8 || hs.level === 10 ? `
          <span class="block text-xs px-2 py-0.5 rounded ${hs.importDuty === '0' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}">
            BM: ${hs.importDuty || '-'}%
          </span>
          ${hs.ppn && hs.ppn !== '-' ? `
            <span class="block text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
              PPN: ${hs.ppn}%
            </span>
          ` : ''}
        ` : ''}
      </div>
    </div>
  `;
}

// Filter Pos/Subpos
function filterHSLevel(level) {
  const container = document.getElementById('hsListContainer');
  if (!container) return;
  const items = container.querySelectorAll('.hs-item');
  
  ['btnAll', 'btn4', 'btn6', 'btn8'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.className = 'px-4 py-2 rounded-lg bg-white/5 text-gray-400 text-xs font-semibold hover:bg-white/10';
    }
  });
  
  const activeBtn = level === 'all' ? 'btnAll' : `btn${level}`;
  const btn = document.getElementById(activeBtn);
  if (btn) {
    btn.className = 'px-4 py-2 rounded-lg bg-white/10 text-white text-xs font-semibold hover:bg-white/20 hs-filter-active';
  }
  
  items.forEach(item => {
    const itemLevel = parseInt(item.dataset.level);
    if (level === 'all') {
      item.style.display = 'flex';
    } else if (level === 8) {
      item.style.display = (itemLevel === 8 || itemLevel === 10) ? 'flex' : 'none';
    } else {
      item.style.display = itemLevel === level ? 'flex' : 'none';
    }
  });
}

// Show Detail Modal
async function showHSDetail(hsCode) {
  try {
    const response = await fetch(`/api/hs/detail/${encodeURIComponent(hsCode)}`);
    const result = await response.json();
    
    if (!result.success) throw new Error(result.error);
    
    const hs = result.data;
    const chapter = result.chapter;
    const section = result.section;
    const t = UI_STRINGS[explorerLocale];
    
    const modal = document.createElement('div');
    modal.id = 'hsDetailModal';
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    modal.innerHTML = `
      <div class="glass-card rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-white/10 animate-fade-in bg-slate-900 shadow-2xl">
        <div class="flex justify-between items-start mb-6">
          <div>
            <span class="px-3 py-1 rounded bg-purple-500 text-white font-mono font-bold text-sm tracking-wide">
              ${hs.hsCode}
            </span>
            <p class="text-gray-400 text-xs mt-2 font-body">
              ${explorerLocale === 'id' ? `Bagian ${section?.sectionNumber || '-'} > Bab ${chapter?.chapterNumber || '-'}` : `Section ${section?.sectionNumber || '-'} > Chapter ${chapter?.chapterNumber || '-'}`}
            </p>
          </div>
          <button onclick="document.getElementById('hsDetailModal').remove()" class="text-gray-400 hover:text-white p-2">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        
        <div class="mb-6">
          <h3 class="text-xl font-bold text-white mb-2 leading-snug">${explorerLocale === 'id' ? hs.descriptionId : (hs.descriptionEn || hs.descriptionId)}</h3>
          <p class="text-gray-400 text-sm font-body">${explorerLocale === 'id' ? (hs.descriptionEn || '') : hs.descriptionId}</p>
        </div>
        
        <!-- Tariff Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white/5 border border-white/5 rounded-xl p-4 text-center">
            <div class="text-2xl font-bold ${hs.importDuty === '0' ? 'text-green-400' : 'text-yellow-400'}">${hs.importDuty || '-'}%</div>
            <div class="text-xs text-gray-400 mt-1">${t.bm}</div>
          </div>
          <div class="bg-white/5 border border-white/5 rounded-xl p-4 text-center">
            <div class="text-2xl font-bold text-blue-400">${hs.ppn || '-'}%</div>
            <div class="text-xs text-gray-400 mt-1">${t.ppn}</div>
          </div>
          <div class="bg-white/5 border border-white/5 rounded-xl p-4 text-center">
            <div class="text-2xl font-bold text-pink-400">${hs.ppnbm || '-'}%</div>
            <div class="text-xs text-gray-400 mt-1">${t.ppnbm}</div>
          </div>
          <div class="bg-white/5 border border-white/5 rounded-xl p-4 text-center relative group/bk">
            <div class="text-2xl font-bold text-cyan-400">${hs.exportDuty || '-'}%</div>
            <div class="text-xs text-gray-400 mt-1 cursor-help">
              Bea Keluar <i class="fas fa-info-circle ml-0.5 text-cyan-400"></i>
            </div>
            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-[10px] rounded-lg opacity-0 group-hover/bk:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10">
              Tarif Bea Keluar sesuai ketentuan Kementerian Keuangan.<br>Cek portal INSW untuk status terbaru.
              <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
            </div>
          </div>
        </div>
        
        <!-- Classification Hierarchy -->
        ${result.parents?.length ? `
          <div class="mb-6">
            <h4 class="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <i class="fas fa-sitemap text-purple-400"></i> ${t.sitemap_title}
            </h4>
            <div class="space-y-2 font-body text-xs">
              ${result.parents.map(p => `
                <div class="flex items-center gap-3">
                  <span class="font-mono text-purple-400">${p.hsCode}</span>
                  <span class="text-gray-600">→</span>
                  <span class="text-gray-300 truncate max-w-md">${p.descriptionId}</span>
                </div>
              `).join('')}
              <div class="flex items-center gap-3 font-semibold pt-1">
                <span class="font-mono text-green-400">${hs.hsCode}</span>
                <span class="text-gray-600">→</span>
                <span class="text-white">${explorerLocale === 'id' ? hs.descriptionId : (hs.descriptionEn || hs.descriptionId)}</span>
              </div>
            </div>
          </div>
        ` : ''}
        
        <!-- Actions -->
        <div class="flex gap-3">
          <a href="https://www.insw.go.id/intr?search=${hs.hsCode.replace(/\./g, '')}" target="_blank"
             class="flex-1 px-4 py-3 bg-cyan-500/20 hover:bg-cyan-500/30 rounded-xl text-cyan-400 text-center transition-all font-semibold flex items-center justify-center gap-2">
            <i class="fas fa-external-link-alt"></i> ${t.insw_btn}
          </a>
          <button onclick="copyToClipboard('${hs.hsCode}')" 
                  class="px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white transition-all font-semibold flex items-center justify-center gap-2">
            <i class="fas fa-copy text-gray-400"></i> ${t.copy_btn}
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
  } catch (error) {
    console.error('Error showing detail:', error);
  }
}

// Update Breadcrumb List
function updateBreadcrumb(items) {
  const container = document.getElementById('hsBreadcrumb');
  if (!container) return;
  
  container.innerHTML = items.map((item, idx) => {
    const isLast = idx === items.length - 1;
    if (isLast) {
      return `<span class="text-white font-semibold">${item.label}</span>`;
    }
    return `
      <button onclick="${item.action}" class="hover:text-white transition-colors text-purple-400">
        ${idx === 0 ? '<i class="fas fa-home mr-1"></i>' : ''}${item.label}
      </button>
      <i class="fas fa-chevron-right text-xs text-gray-600"></i>
    `;
  }).join('');
}

// Copy Code Clipboard Toast
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-6 right-6 bg-emerald-500 text-white px-4 py-3 rounded-xl shadow-2xl z-50 animate-fade-in flex items-center gap-2 border border-emerald-400/20';
    toast.innerHTML = `<i class="fas fa-check-circle"></i> <span>${UI_STRINGS[explorerLocale].toast_copy}: <strong>${text}</strong></span>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  });
}

// Interaction Event Handlers (Canvas Physics)
function getMousePos(e) {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function onMouseDown(e) {
  const pos = getMousePos(e);
  const clicked = nodes.find(n => {
    const dx = n.x - pos.x;
    const dy = n.y - pos.y;
    return Math.sqrt(dx*dx + dy*dy) < n.radius;
  });
  
  if (clicked) {
    draggedNode = clicked;
    draggedNode.vx = 0;
    draggedNode.vy = 0;
  }
}

function onMouseMove(e) {
  const pos = getMousePos(e);
  
  if (draggedNode) {
    draggedNode.x = pos.x;
    draggedNode.y = pos.y;
  } else {
    const hovering = nodes.find(n => {
      const dx = n.x - pos.x;
      const dy = n.y - pos.y;
      return Math.sqrt(dx*dx + dy*dy) < n.radius;
    });
    
    const tooltip = document.getElementById('hsNodeTooltip');
    
    if (hovering) {
      hoveredNode = hovering;
      canvas.style.cursor = 'pointer';
      
      if (tooltip) {
        let content = '';
        if (hovering.type.startsWith('section')) {
          content = `
            <div class="space-y-1">
              <div class="font-bold text-purple-400">Bagian ${hovering.sectionNumber}</div>
              <div class="font-semibold text-white leading-snug">${explorerLocale === 'id' ? hovering.titleId : (hovering.titleEn || hovering.titleId)}</div>
              <div class="text-[10px] text-gray-500">${explorerLocale === 'id' ? (hovering.titleEn || '') : hovering.titleId}</div>
            </div>
          `;
        } else if (hovering.type === 'chapter') {
          content = `
            <div class="space-y-1">
              <div class="font-bold text-cyan-400">Bab ${parseInt(hovering.chapterNumber)}</div>
              <div class="font-semibold text-white leading-snug">${explorerLocale === 'id' ? hovering.titleId : (hovering.titleEn || hovering.titleId)}</div>
              <div class="text-[10px] text-gray-500">${explorerLocale === 'id' ? (hovering.titleEn || '') : hovering.titleId}</div>
            </div>
          `;
        } else {
          content = `
            <div class="space-y-1">
              <div class="font-mono font-bold text-green-400">${hovering.hsCode}</div>
              <div class="font-semibold text-white leading-normal line-clamp-3">${explorerLocale === 'id' ? hovering.descriptionId : (hovering.descriptionEn || hovering.descriptionId)}</div>
              ${hovering.importDuty !== undefined ? `<div class="text-[10px] text-yellow-400 font-bold mt-1.5">Bea Masuk: ${hovering.importDuty}%</div>` : ''}
            </div>
          `;
        }
        tooltip.innerHTML = content;
        tooltip.style.left = `${pos.x + 15}px`;
        tooltip.style.top = `${pos.y + 15}px`;
        tooltip.classList.remove('hidden');
      }
    } else {
      hoveredNode = null;
      canvas.style.cursor = 'default';
      if (tooltip) tooltip.classList.add('hidden');
    }
  }
}

function onMouseUp(e) {
  if (draggedNode) {
    const pos = getMousePos(e);
    const dist = Math.sqrt(Math.pow(draggedNode.x - pos.x, 2) + Math.pow(draggedNode.y - pos.y, 2));
    if (dist < 5) {
      if (draggedNode.type === 'section') {
        loadSectionChapters(draggedNode.sectionNumber);
      } else if (draggedNode.type === 'chapter') {
        loadChapterHS(draggedNode.chapterNumber);
      } else if (draggedNode.type === 'hs_item') {
        showHSDetail(draggedNode.hsCode);
      } else if (draggedNode.type === 'section_center') {
        loadHSSections();
      } else if (draggedNode.type === 'chapter_center') {
        loadSectionChapters(hsState.currentSection);
      }
    }
  }
  draggedNode = null;
}

function onMouseLeave() {
  draggedNode = null;
  hoveredNode = null;
  const tooltip = document.getElementById('hsNodeTooltip');
  if (tooltip) tooltip.classList.add('hidden');
}

// Export modules to window namespace
window.loadBarangContent = loadBarangContent;
window.loadHSSections = loadHSSections;
window.loadSectionChapters = loadSectionChapters;
window.loadChapterHS = loadChapterHS;
window.showHSDetail = showHSDetail;
window.filterHSLevel = filterHSLevel;
window.searchHSCodes = searchHSCodes;
