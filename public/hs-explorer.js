
// Helper function untuk mendapatkan halaman ENote
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
    
    // Show loading modal
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
    
    // Fetch note content
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


// HS CODE EXPLORER MODULE
// ========================

// State
let hsState = {
  currentSection: null,
  currentChapter: null,
  searchQuery: '',
  viewMode: 'sections' // sections, chapters, hsList, detail
};

// Roman numerals mapping
const romanNumerals = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI'];

// Load HS Explorer main content
function loadBarangContent(subId) {
  const container = document.getElementById('content-barang');
  if (!container) return;
  
  container.innerHTML = getHSExplorerHTML();
  
  // Initialize
  setTimeout(() => {
    loadHSSections();
    setupHSSearch();
  }, 100);
}

// Get main HTML structure
function getHSExplorerHTML() {
  return `
    <div class="space-y-6">
      <!-- Header -->
      <div class="glass-card rounded-2xl p-6">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 class="text-2xl font-bold text-white flex items-center gap-3">
              <span class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <i class="fas fa-search-dollar text-xl"></i>
              </span>
              HS Code Explorer
            </h2>
            <p class="text-gray-400 mt-2">BTKI 2022 - Buku Tarif Kepabeanan Indonesia</p>
          </div>
          
          <!-- Quick Stats -->
          <div id="hsStats" class="flex gap-4 text-center">
            <div class="bg-white/5 rounded-xl px-4 py-2">
              <div class="text-2xl font-bold text-purple-400" id="statSections">21</div>
              <div class="text-xs text-gray-400">Bagian</div>
            </div>
            <div class="bg-white/5 rounded-xl px-4 py-2">
              <div class="text-2xl font-bold text-cyan-400" id="statChapters">97</div>
              <div class="text-xs text-gray-400">Bab</div>
            </div>
            <div class="bg-white/5 rounded-xl px-4 py-2">
              <div class="text-2xl font-bold text-green-400" id="statHS">-</div>
              <div class="text-xs text-gray-400">Pos Tarif</div>
            </div>
          </div>
        </div>
        
        <!-- Search Bar -->
        <div class="mt-6">
          <div class="relative">
            <input type="text" id="hsSearchInput" 
              placeholder="Cari kode HS atau deskripsi barang... (min. 2 karakter)"
              class="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 pl-12 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all">
            <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
            <div id="hsSearchLoading" class="absolute right-4 top-1/2 -translate-y-1/2 hidden">
              <i class="fas fa-spinner fa-spin text-purple-400"></i>
            </div>
          </div>
          <div id="hsSearchResults" class="mt-4 hidden"></div>
        </div>
      </div>
      
      <!-- Breadcrumb -->
      <div id="hsBreadcrumb" class="flex items-center gap-2 text-sm text-gray-400 px-2">
        <button onclick="loadHSSections()" class="hover:text-white transition-colors">
          <i class="fas fa-home mr-1"></i> Semua Bagian
        </button>
      </div>
      
      <!-- Main Content Area -->
      <div id="hsMainContent" class="space-y-4">
        <!-- Content will be loaded here -->
      </div>
      
      <!-- INSW Reference Link -->
      <div class="glass-card rounded-xl p-4 text-center">
        <p class="text-gray-400 text-sm">
          <i class="fas fa-info-circle mr-2"></i>
          Data BTKI 2022 (Agustus). Untuk tarif terkini, cek langsung di 
          <a href="https://www.insw.go.id/intr" target="_blank" class="text-cyan-400 hover:text-cyan-300 underline">
            INSW - Indonesia National Single Window
          </a>
        </p>
      </div>
    </div>
  `;
}

// Setup search functionality
function setupHSSearch() {
  const input = document.getElementById('hsSearchInput');
  if (!input) return;
  
  let debounceTimer;
  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();
    
    if (query.length < 2) {
      document.getElementById('hsSearchResults').classList.add('hidden');
      return;
    }
    
    document.getElementById('hsSearchLoading').classList.remove('hidden');
    
    debounceTimer = setTimeout(() => {
      searchHSCodes(query);
    }, 300);
  });
}

// Search HS Codes
async function searchHSCodes(query) {
  try {
    const response = await fetch(`/api/hs/search?q=${encodeURIComponent(query)}&limit=30`);
    const result = await response.json();
    
    document.getElementById('hsSearchLoading').classList.add('hidden');
    
    const container = document.getElementById('hsSearchResults');
    if (!result.success || !result.data.length) {
      container.innerHTML = `
        <div class="glass-card rounded-xl p-6 text-center text-gray-400">
          <i class="fas fa-search text-3xl mb-3 opacity-50"></i>
          <p>Tidak ditemukan hasil untuk "<strong>${query}</strong>"</p>
          <p class="text-sm mt-2">Coba kata kunci lain atau kode HS</p>
        </div>
      `;
      container.classList.remove('hidden');
      return;
    }
    
    container.innerHTML = `
      <div class="glass-card rounded-xl p-4">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-semibold text-white">
            <i class="fas fa-list mr-2 text-purple-400"></i>
            Hasil Pencarian (${result.count})
          </h3>
          <button onclick="document.getElementById('hsSearchResults').classList.add('hidden')" class="text-gray-400 hover:text-white">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="space-y-2 max-h-96 overflow-y-auto">
          ${result.data.map(hs => `
            <div onclick="showHSDetail('${hs.hsCode}')" 
                 class="flex items-start gap-4 p-3 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer transition-all group">
              <div class="flex-shrink-0">
                <span class="px-2 py-1 rounded bg-purple-500/20 text-purple-400 font-mono text-sm">
                  ${hs.hsCode}
                </span>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-white text-sm truncate">${hs.descriptionId}</p>
                <p class="text-gray-500 text-xs truncate">${hs.descriptionEn || ''}</p>
              </div>
              <div class="flex-shrink-0 text-right">
                <span class="text-xs px-2 py-0.5 rounded ${hs.importDuty === '0' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}">
                  BM: ${hs.importDuty || '-'}%
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    container.classList.remove('hidden');
    
  } catch (error) {
    console.error('Search error:', error);
    document.getElementById('hsSearchLoading').classList.add('hidden');
  }
}

// Load all sections
async function loadHSSections() {
  const container = document.getElementById('hsMainContent');
  if (!container) return;
  
  // Update breadcrumb
  updateBreadcrumb([{ label: 'Semua Bagian', action: 'loadHSSections()' }]);
  
  container.innerHTML = `
    <div class="text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-purple-400"></i>
      <p class="text-gray-400 mt-4">Memuat data bagian...</p>
    </div>
  `;
  
  try {
    const response = await fetch('/api/hs/sections');
    const result = await response.json();
    
    if (!result.success) throw new Error(result.error);
    
    // Update stats
    document.getElementById('statSections').textContent = result.data.length;
    
    // Get total HS count
    const statsRes = await fetch('/api/hs/stats');
    const statsData = await statsRes.json();
    if (statsData.success) {
      document.getElementById('statHS').textContent = statsData.stats.totalHS.toLocaleString();
      document.getElementById('statChapters').textContent = statsData.stats.totalChapters;
    }
    
    container.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        ${result.data.map((section) => `
          <div onclick="loadSectionChapters('${section.sectionNumber}')" 
               class="glass-card rounded-xl p-4 hover:bg-white/10 cursor-pointer transition-all group border border-transparent hover:border-purple-500/30 hover:scale-105">
            <div class="text-center">
              <div class="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center border border-purple-500/20 mb-3">
                <span class="text-lg font-bold text-purple-400">${section.sectionNumber}</span>
              </div>
              <h3 class="font-semibold text-white text-sm group-hover:text-purple-300 transition-colors mb-1">
                Bagian ${section.sectionNumber}
              </h3>
              <p class="text-gray-400 text-xs line-clamp-2 mb-2">${section.titleId}</p>
              <div class="flex justify-center gap-3 text-xs">
                <span class="text-cyan-400"><i class="fas fa-book mr-1"></i>${section.chapters?.length || 0}</span>
                <span class="text-green-400"><i class="fas fa-list mr-1"></i>${section.hsCount?.toLocaleString() || 0}</span>
              </div>
              <a href="javascript:void(0)" onclick="showNoteModal('section', ${section.sectionNumber})" 
                 onclick="event.stopPropagation()" 
                 class="mt-2 text-xs text-yellow-400 hover:text-yellow-300 hover:underline">
                <i class="fas fa-book-open mr-1"></i>Catatan Bagian
              </a
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    
  } catch (error) {
    console.error('Error loading sections:', error);
    container.innerHTML = `
      <div class="glass-card rounded-xl p-8 text-center">
        <i class="fas fa-exclamation-triangle text-4xl text-yellow-500 mb-4"></i>
        <h3 class="text-xl font-bold text-white mb-2">Gagal Memuat Data</h3>
        <p class="text-gray-400 mb-4">${error.message}</p>
        <button onclick="loadHSSections()" class="px-6 py-2 bg-purple-500 hover:bg-purple-600 rounded-lg text-white transition-colors">
          <i class="fas fa-redo mr-2"></i> Coba Lagi
        </button>
      </div>
    `;
  }
}

// Load chapters by section
async function loadSectionChapters(sectionNumber) {
  const container = document.getElementById('hsMainContent');
  if (!container) return;
  
  container.innerHTML = `
    <div class="text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-cyan-400"></i>
      <p class="text-gray-400 mt-4">Memuat bab-bab...</p>
    </div>
  `;
  
  try {
    const response = await fetch(`/api/hs/sections/${sectionNumber}/chapters`);
    const result = await response.json();
    
    if (!result.success) throw new Error(result.error);
    
    const section = result.section;
    
    // Update breadcrumb
    updateBreadcrumb([
      { label: 'Semua Bagian', action: 'loadHSSections()' },
      { label: `Bagian ${sectionNumber}`, action: null }
    ]);
    
    container.innerHTML = `
      <!-- Section Header -->
      <div class="glass-card rounded-xl p-6 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
        <div class="flex items-start gap-4">
          <div class="w-16 h-16 rounded-xl bg-purple-500/20 flex items-center justify-center">
            <span class="text-2xl font-bold text-purple-400">${sectionNumber}</span>
          </div>
          <div class="flex-1">
            <h2 class="text-xl font-bold text-white">Bagian ${sectionNumber}</h2>
            <p class="text-gray-300 mt-1">${section.titleId}</p>
            <p class="text-gray-500 text-sm mt-1">${section.titleEn || ''}</p>
          </div>
        </div>
        ${section.notes ? `
          <div class="mt-4 p-4 bg-white/5 rounded-lg">
            <h4 class="text-sm font-semibold text-yellow-400 mb-2">
              <i class="fas fa-sticky-note mr-2"></i>Catatan Bagian:
            </h4>
            <p class="text-gray-400 text-sm">${section.notes}</p>
          </div>
        ` : ''}
      </div>
      
      <!-- Chapters Grid -->
      <div class="grid md:grid-cols-2 gap-4">
        ${result.data.map(chapter => `
          <div onclick="loadChapterHS('${chapter.chapterNumber}')" 
               class="glass-card rounded-xl p-5 hover:bg-white/10 cursor-pointer transition-all group border border-transparent hover:border-cyan-500/30">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 w-12 h-12 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                <span class="text-lg font-bold text-cyan-400">${chapter.chapterNumber}</span>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-white group-hover:text-cyan-300 transition-colors">
                  Bab ${parseInt(chapter.chapterNumber)}
                </h3>
                <p class="text-gray-400 text-sm mt-1 line-clamp-2">${chapter.titleId}</p>
                <span class="inline-block mt-2 text-xs text-green-400">
                  <i class="fas fa-list mr-1"></i> ${chapter.hsCount?.toLocaleString() || 0} pos tarif
                </span>
              </div>
              <i class="fas fa-chevron-right text-gray-600 group-hover:text-cyan-400 transition-colors"></i>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    
  } catch (error) {
    console.error('Error loading chapters:', error);
    container.innerHTML = `
      <div class="glass-card rounded-xl p-8 text-center">
        <i class="fas fa-exclamation-triangle text-4xl text-yellow-500 mb-4"></i>
        <p class="text-gray-400">${error.message}</p>
        <button onclick="loadHSSections()" class="mt-4 px-4 py-2 bg-purple-500 rounded-lg text-white">
          <i class="fas fa-arrow-left mr-2"></i> Kembali
        </button>
      </div>
    `;
  }
}

// Load HS codes by chapter
async function loadChapterHS(chapterNumber) {
  const container = document.getElementById('hsMainContent');
  if (!container) return;
  
  container.innerHTML = `
    <div class="text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-green-400"></i>
      <p class="text-gray-400 mt-4">Memuat pos tarif...</p>
    </div>
  `;
  
  try {
    // Get chapter info
    const chaptersRes = await fetch('/api/hs/chapters');
    const chaptersData = await chaptersRes.json();
    const chapter = chaptersData.data?.find(c => c.chapterNumber === chapterNumber);
    
    // Get HS codes
    const response = await fetch(`/api/hs/chapters/${chapterNumber}/hs`);
    const result = await response.json();
    
    if (!result.success) throw new Error(result.error);
    
    // Find section
    const sectionsRes = await fetch('/api/hs/sections');
    const sectionsData = await sectionsRes.json();
    const section = sectionsData.data?.find(s => s.chapters?.includes(chapterNumber));
    
    // Update breadcrumb
    updateBreadcrumb([
      { label: 'Semua Bagian', action: 'loadHSSections()' },
      { label: `Bagian ${section?.sectionNumber || '-'}`, action: `loadSectionChapters('${section?.sectionNumber}')` },
      { label: `Bab ${chapterNumber}`, action: null }
    ]);
    
    // Group by level
    const pos4 = result.data.filter(h => h.hsLevel === 4);
    const subpos = result.data.filter(h => h.hsLevel === 6);
    const btki = result.data.filter(h => h.hsLevel === 8 || h.hsLevel === 10);
    
    container.innerHTML = `
      <!-- Chapter Header -->
      <div class="glass-card rounded-xl p-6 bg-gradient-to-r from-cyan-500/10 to-green-500/10 border border-cyan-500/20">
        <div class="flex items-start gap-4">
          <div class="w-16 h-16 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <span class="text-2xl font-bold text-cyan-400">${chapterNumber}</span>
          </div>
          <div class="flex-1">
            <h2 class="text-xl font-bold text-white">Bab ${parseInt(chapterNumber)}</h2>
            <p class="text-gray-300 mt-1">${chapter?.titleId || ''}</p>
            <p class="text-gray-500 text-sm mt-1">${chapter?.titleEn || ''}</p>
            <a href="javascript:void(0)" onclick="showNoteModal('chapter', ${chapterNumber})" 
               class="inline-flex items-center mt-2 px-3 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 rounded-lg text-yellow-300 text-sm transition-colors">
              <i class="fas fa-book-open mr-2"></i>Lihat Catatan Bab
            </a>
          </div>
        </div>
        <div class="flex gap-4 mt-4">
          <span class="px-3 py-1 rounded-full bg-purple-500/20 text-purple-400 text-sm">
            <i class="fas fa-cube mr-1"></i> ${pos4.length} Pos (4 digit)
          </span>
          <span class="px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-400 text-sm">
            <i class="fas fa-cubes mr-1"></i> ${subpos.length} Sub-Pos (6 digit)
          </span>
          <span class="px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-sm">
            <i class="fas fa-th mr-1"></i> ${btki.length} BTKI (8+ digit)
          </span>
        </div>
      </div>
      
      <!-- Filter Tabs -->
      <div class="flex gap-2">
        <button onclick="filterHSLevel('all')" id="btnAll" class="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition-all hs-filter-active">
          Semua (${result.data.length})
        </button>
        <button onclick="filterHSLevel(4)" id="btn4" class="px-4 py-2 rounded-lg bg-white/5 text-gray-400 text-sm hover:bg-white/10 transition-all">
          Pos 4 digit (${pos4.length})
        </button>
        <button onclick="filterHSLevel(6)" id="btn6" class="px-4 py-2 rounded-lg bg-white/5 text-gray-400 text-sm hover:bg-white/10 transition-all">
          Sub-Pos 6 digit (${subpos.length})
        </button>
        <button onclick="filterHSLevel(8)" id="btn8" class="px-4 py-2 rounded-lg bg-white/5 text-gray-400 text-sm hover:bg-white/10 transition-all">
          BTKI 8+ digit (${btki.length})
        </button>
      </div>
      
      <!-- HS List -->
      <div id="hsListContainer" class="space-y-2">
        ${result.data.map(hs => renderHSItem(hs)).join('')}
      </div>
    `;
    
    // Store data for filtering
    window.currentHSData = result.data;
    
  } catch (error) {
    console.error('Error loading HS codes:', error);
    container.innerHTML = `
      <div class="glass-card rounded-xl p-8 text-center">
        <i class="fas fa-exclamation-triangle text-4xl text-yellow-500 mb-4"></i>
        <p class="text-gray-400">${error.message}</p>
        <button onclick="loadHSSections()" class="mt-4 px-4 py-2 bg-purple-500 rounded-lg text-white">
          <i class="fas fa-arrow-left mr-2"></i> Kembali
        </button>
      </div>
    `;
  }
}

// Render single HS item
function renderHSItem(hs) {
  const indent = hs.hsLevel === 4 ? '' : hs.hsLevel === 6 ? 'pl-6' : 'pl-12';
  const bgColor = hs.hsLevel === 4 ? 'bg-purple-500/10 border-purple-500/20' : 
                  hs.hsLevel === 6 ? 'bg-cyan-500/5 border-cyan-500/10' : 
                  'bg-white/5 border-white/5';
  const codeColor = hs.hsLevel === 4 ? 'text-purple-400' : 
                    hs.hsLevel === 6 ? 'text-cyan-400' : 'text-green-400';
  
  return `
    <div onclick="showHSDetail('${hs.hsCode}')" 
         class="hs-item glass-card rounded-lg p-4 ${indent} ${bgColor} border hover:bg-white/10 cursor-pointer transition-all"
         data-level="${hs.hsLevel}">
      <div class="flex items-start gap-4">
        <span class="font-mono font-bold ${codeColor} flex-shrink-0 w-28">${hs.hsCode}</span>
        <div class="flex-1 min-w-0">
          <p class="text-white text-sm">${hs.descriptionId}</p>
          ${hs.descriptionEn ? `<p class="text-gray-500 text-xs mt-1">${hs.descriptionEn}</p>` : ''}
        </div>
        <div class="flex-shrink-0 text-right space-y-1">
          ${hs.hsLevel === 8 || hs.hsLevel === 10 ? `
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
    </div>
  `;
}

// Filter by level
function filterHSLevel(level) {
  const container = document.getElementById('hsListContainer');
  const items = container.querySelectorAll('.hs-item');
  
  // Update buttons
  ['btnAll', 'btn4', 'btn6', 'btn8'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.classList.remove('bg-white/10', 'text-white', 'hs-filter-active');
      btn.classList.add('bg-white/5', 'text-gray-400');
    }
  });
  
  const activeBtn = level === 'all' ? 'btnAll' : `btn${level}`;
  const btn = document.getElementById(activeBtn);
  if (btn) {
    btn.classList.remove('bg-white/5', 'text-gray-400');
    btn.classList.add('bg-white/10', 'text-white', 'hs-filter-active');
  }
  
  items.forEach(item => {
    const itemLevel = parseInt(item.dataset.level);
    if (level === 'all') {
      item.style.display = '';
    } else if (level === 8) {
      item.style.display = (itemLevel === 8 || itemLevel === 10) ? '' : 'none';
    } else {
      item.style.display = itemLevel === level ? '' : 'none';
    }
  });
}

// Show HS Detail
async function showHSDetail(hsCode) {
  try {
    const response = await fetch(`/api/hs/detail/${encodeURIComponent(hsCode)}`);
    const result = await response.json();
    
    if (!result.success) throw new Error(result.error);
    
    const hs = result.data;
    const chapter = result.chapter;
    const section = result.section;
    
    // Create modal
    const modal = document.createElement('div');
    modal.id = 'hsDetailModal';
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    modal.innerHTML = `
      <div class="glass-card rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-fade-in">
        <!-- Header -->
        <div class="flex justify-between items-start mb-6">
          <div>
            <span class="px-3 py-1 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-mono font-bold">
              ${hs.hsCode}
            </span>
            <p class="text-gray-400 text-sm mt-2">
              Bagian ${section?.sectionNumber || '-'} > Bab ${chapter?.chapterNumber || '-'}
            </p>
          </div>
          <button onclick="document.getElementById('hsDetailModal').remove()" class="text-gray-400 hover:text-white p-2">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        
        <!-- Description -->
        <div class="mb-6">
          <h3 class="text-xl font-bold text-white mb-2">${hs.descriptionId}</h3>
          ${hs.descriptionEn ? `<p class="text-gray-400">${hs.descriptionEn}</p>` : ''}
        </div>
        
        <!-- Tariff Info -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white/5 rounded-xl p-4 text-center">
            <div class="text-2xl font-bold ${hs.importDuty === '0' ? 'text-green-400' : 'text-yellow-400'}">
              ${hs.importDuty || '-'}%
            </div>
            <div class="text-xs text-gray-400 mt-1">Bea Masuk</div>
          </div>
          <div class="bg-white/5 rounded-xl p-4 text-center">
            <div class="text-2xl font-bold text-blue-400">${hs.ppn || '-'}%</div>
            <div class="text-xs text-gray-400 mt-1">PPN</div>
          </div>
          <div class="bg-white/5 rounded-xl p-4 text-center">
            <div class="text-2xl font-bold text-pink-400">${hs.ppnbm || '-'}%</div>
            <div class="text-xs text-gray-400 mt-1">PPnBM</div>
          </div>
          <div class="bg-white/5 rounded-xl p-4 text-center relative group/bk">
            <div class="text-2xl font-bold text-cyan-400">${hs.exportDuty || '-'}%</div>
            <div class="text-xs text-gray-400 mt-1 cursor-help">
              Bea Keluar
              <i class="fas fa-info-circle ml-1 text-cyan-400"></i>
            </div>
            <!-- Tooltip -->
            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover/bk:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 pointer-events-none">
              Tarif BK dapat berubah sesuai ketentuan.<br>Cek info terkini di portal INSW.
              <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
            </div>
          </div>
        </div>
        
        <!-- Hierarchy -->
        ${result.parents?.length ? `
          <div class="mb-6">
            <h4 class="text-sm font-semibold text-gray-400 mb-3">
              <i class="fas fa-sitemap mr-2"></i>Hierarki Klasifikasi
            </h4>
            <div class="space-y-2">
              ${result.parents.map(p => `
                <div class="flex items-center gap-3 text-sm">
                  <span class="font-mono text-purple-400">${p.hsCode}</span>
                  <span class="text-gray-500">→</span>
                  <span class="text-gray-300">${p.descriptionId}</span>
                </div>
              `).join('')}
              <div class="flex items-center gap-3 text-sm font-semibold">
                <span class="font-mono text-green-400">${hs.hsCode}</span>
                <span class="text-gray-500">→</span>
                <span class="text-white">${hs.descriptionId}</span>
              </div>
            </div>
          </div>
        ` : ''}
        
        <!-- Actions -->
        <div class="flex gap-3">
          <a href="https://www.insw.go.id/intr?search=${hs.hsCode.replace(/\./g, '')}" target="_blank"
             class="flex-1 px-4 py-3 bg-cyan-500/20 hover:bg-cyan-500/30 rounded-xl text-cyan-400 text-center transition-all">
            <i class="fas fa-external-link-alt mr-2"></i>Cek di INSW
          </a>
          <button onclick="copyToClipboard('${hs.hsCode}')" 
                  class="px-4 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-white transition-all">
            <i class="fas fa-copy mr-2"></i>Salin Kode
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
  } catch (error) {
    console.error('Error showing detail:', error);
    alert('Gagal memuat detail: ' + error.message);
  }
}

// Update breadcrumb
function updateBreadcrumb(items) {
  const container = document.getElementById('hsBreadcrumb');
  if (!container) return;
  
  container.innerHTML = items.map((item, idx) => {
    const isLast = idx === items.length - 1;
    if (isLast) {
      return `<span class="text-white font-semibold">${item.label}</span>`;
    }
    return `
      <button onclick="${item.action}" class="hover:text-white transition-colors">
        ${idx === 0 ? '<i class="fas fa-home mr-1"></i>' : ''}${item.label}
      </button>
      <i class="fas fa-chevron-right text-xs"></i>
    `;
  }).join('');
}

// Copy to clipboard helper
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Show toast
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in';
    toast.innerHTML = `<i class="fas fa-check mr-2"></i>Disalin: ${text}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  });
}

// Export for global access
window.loadBarangContent = loadBarangContent;
window.loadHSSections = loadHSSections;
window.loadSectionChapters = loadSectionChapters;
window.loadChapterHS = loadChapterHS;
window.showHSDetail = showHSDetail;
window.filterHSLevel = filterHSLevel;
window.searchHSCodes = searchHSCodes;
