// ==================== EDIT PRICE & DEVICE FUNCTIONS ====================

function openEditModal(priceId, priceUsd, taxIdr, brand, model, capacity, deviceId) {
    if ((!priceId || priceId === 'undefined' || priceId === 'null') && 
        (!deviceId || deviceId === 'undefined' || deviceId === 'null')) {
        alert('Device ini belum memiliki data untuk diedit');
        return;
    }
    
    var existingModal = document.getElementById('editPriceModal');
    if (existingModal) existingModal.remove();
    
    var modal = document.createElement('div');
    modal.id = 'editPriceModal';
    modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4';
    modal.innerHTML = 
        '<div class="bg-slate-800 rounded-xl p-6 w-full max-w-lg mx-auto border border-slate-600 max-h-[90vh] overflow-y-auto shadow-2xl">' +
            '<div class="flex justify-between items-center mb-4">' +
                '<h3 class="text-lg font-semibold text-white"><i class="fas fa-edit mr-2 text-yellow-400"></i>Kelola Data Device</h3>' +
                '<button onclick="closeEditModal()" class="text-gray-400 hover:text-white text-xl p-1"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="bg-slate-700/50 rounded-lg p-3 mb-4 border border-slate-600/50">' +
                '<div class="flex justify-between items-center">' +
                    '<div>' +
                        '<p class="text-blue-400 font-bold text-base">' + brand + ' ' + model + '</p>' +
                        '<p class="text-gray-300 text-xs mt-0.5"><span class="bg-slate-800 px-2 py-0.5 rounded border border-slate-600">' + capacity + '</span></p>' +
                    '</div>' +
                    '<div class="text-right">' +
                        '<p class="text-xs text-gray-400">Harga Terpasang</p>' +
                        '<p class="text-green-400 font-bold">$' + (priceUsd ? Number(priceUsd).toLocaleString() : '0') + '</p>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="grid grid-cols-3 gap-2 mb-4">' +
                '<button id="tabPrice" onclick="switchEditTab(\'price\')" class="py-2 px-2 text-xs md:text-sm rounded-lg bg-yellow-500 text-black font-semibold transition text-center"><i class="fas fa-dollar-sign mr-1"></i>Harga</button>' +
                '<button id="tabDevice" onclick="switchEditTab(\'device\')" class="py-2 px-2 text-xs md:text-sm rounded-lg bg-slate-700 text-gray-300 font-medium hover:bg-slate-600 transition text-center"><i class="fas fa-mobile-alt mr-1"></i>Nama</button>' +
                '<button id="tabDelete" onclick="switchEditTab(\'delete\')" class="py-2 px-2 text-xs md:text-sm rounded-lg bg-slate-700 text-red-400 font-medium hover:bg-red-500/20 hover:text-red-300 transition text-center"><i class="fas fa-trash-alt mr-1"></i>Hapus</button>' +
            '</div>' +
            '<div id="priceEditForm">' +
                '<div class="space-y-4">' +
                    '<div><label class="block text-sm text-gray-300 mb-1 font-medium">Harga USD <span class="text-yellow-400">*</span></label>' +
                    '<input type="number" id="editPriceUsd" value="' + priceUsd + '" step="0.01" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-yellow-500 font-mono"></div>' +
                    '<div><label class="block text-sm text-gray-300 mb-1 font-medium">Pajak IDR (Estimasi CEISA)</label>' +
                    '<input type="number" id="editTaxIdr" value="' + (taxIdr || 0) + '" step="1" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-yellow-500 font-mono"></div>' +
                    '<div><label class="block text-sm text-gray-300 mb-1 font-medium">Alasan Koreksi <span class="text-red-400">*</span></label>' +
                    '<input type="text" id="editPriceReason" placeholder="Contoh: Penyesuaian kurs / acuan HKT terbaru" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-yellow-500 text-sm"></div>' +
                    '<div class="flex gap-3 pt-2">' +
                        '<button onclick="closeEditModal()" class="flex-1 bg-slate-700 hover:bg-slate-600 text-gray-300 py-2.5 rounded-lg transition font-medium text-sm">Batal</button>' +
                        '<button onclick="submitEditPrice(\'' + priceId + '\')" class="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2 shadow-lg shadow-yellow-500/20"><i class="fas fa-save"></i>Simpan Harga</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div id="deviceEditForm" class="hidden">' +
                '<div class="space-y-4">' +
                    '<div><label class="block text-sm text-gray-300 mb-1 font-medium">Nama Model <span class="text-blue-400">*</span></label>' +
                    '<input type="text" id="editModel" value="' + model + '" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" placeholder="Contoh: iPhone 16 Pro Max"></div>' +
                    '<div><label class="block text-sm text-gray-300 mb-1 font-medium">Storage/Capacity <span class="text-blue-400">*</span></label>' +
                    '<input type="text" id="editCapacity" value="' + capacity + '" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" placeholder="Contoh: 256GB"></div>' +
                    '<div><label class="block text-sm text-gray-300 mb-1 font-medium">Alasan Edit <span class="text-red-400">*</span></label>' +
                    '<input type="text" id="editDeviceReason" placeholder="Contoh: Koreksi typo penamaan model" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 text-sm"></div>' +
                    '<div class="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-blue-300 text-xs flex gap-2"><i class="fas fa-info-circle mt-0.5"></i><span>Perubahan nama model atau kapasitas akan langsung terupdate di katalog dan kalkulator pabean.</span></div>' +
                    '<div class="flex gap-3 pt-2">' +
                        '<button onclick="closeEditModal()" class="flex-1 bg-slate-700 hover:bg-slate-600 text-gray-300 py-2.5 rounded-lg transition font-medium text-sm">Batal</button>' +
                        '<button onclick="submitEditDevice(\'' + deviceId + '\')" class="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"><i class="fas fa-save"></i>Simpan Nama</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div id="deleteDeviceForm" class="hidden">' +
                '<div class="space-y-4">' +
                    '<div class="bg-red-500/10 border border-red-500/40 rounded-xl p-4 text-red-300 text-sm">' +
                        '<div class="flex items-center gap-2 font-bold text-red-400 mb-1.5"><i class="fas fa-exclamation-triangle"></i>Peringatan Hapus Device</div>' +
                        '<p class="text-xs text-red-300/90 leading-relaxed">Device <strong>' + brand + ' ' + model + ' (' + capacity + ')</strong> beserta seluruh riwayat harga terkait akan dihapus permanen dari sistem.</p>' +
                    '</div>' +
                    '<div><label class="block text-sm text-gray-300 mb-1 font-medium">Alasan Penghapusan <span class="text-red-400">*</span></label>' +
                    '<input type="text" id="deleteDeviceReason" placeholder="Contoh: Data double / salah input di KNO" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-red-500 text-sm"></div>' +
                    '<div class="flex gap-3 pt-2">' +
                        '<button onclick="closeEditModal()" class="flex-1 bg-slate-700 hover:bg-slate-600 text-gray-300 py-2.5 rounded-lg transition font-medium text-sm">Batal</button>' +
                        '<button onclick="submitDeleteDevice(\'' + deviceId + '\', \'' + brand + ' ' + model + ' (' + capacity + ')\')" class="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-500/20"><i class="fas fa-trash-alt"></i>Hapus Permanen</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    document.body.appendChild(modal);
}

function switchEditTab(tab) {
    var tabPrice = document.getElementById('tabPrice');
    var tabDevice = document.getElementById('tabDevice');
    var tabDelete = document.getElementById('tabDelete');
    var priceForm = document.getElementById('priceEditForm');
    var deviceForm = document.getElementById('deviceEditForm');
    var deleteForm = document.getElementById('deleteDeviceForm');
    
    // Reset all tabs
    tabPrice.className = 'py-2 px-2 text-xs md:text-sm rounded-lg bg-slate-700 text-gray-300 font-medium hover:bg-slate-600 transition text-center';
    tabDevice.className = 'py-2 px-2 text-xs md:text-sm rounded-lg bg-slate-700 text-gray-300 font-medium hover:bg-slate-600 transition text-center';
    tabDelete.className = 'py-2 px-2 text-xs md:text-sm rounded-lg bg-slate-700 text-red-400 font-medium hover:bg-red-500/20 hover:text-red-300 transition text-center';
    
    priceForm.classList.add('hidden');
    deviceForm.classList.add('hidden');
    deleteForm.classList.add('hidden');
    
    if (tab === 'price') {
        tabPrice.className = 'py-2 px-2 text-xs md:text-sm rounded-lg bg-yellow-500 text-black font-semibold transition text-center shadow';
        priceForm.classList.remove('hidden');
    } else if (tab === 'device') {
        tabDevice.className = 'py-2 px-2 text-xs md:text-sm rounded-lg bg-blue-600 text-white font-semibold transition text-center shadow';
        deviceForm.classList.remove('hidden');
    } else if (tab === 'delete') {
        tabDelete.className = 'py-2 px-2 text-xs md:text-sm rounded-lg bg-red-600 text-white font-semibold transition text-center shadow';
        deleteForm.classList.remove('hidden');
    }
}

function closeEditModal() { 
    var m = document.getElementById('editPriceModal'); 
    if (m) m.remove(); 
}

async function submitEditPrice(priceId) {
    if (!priceId || priceId === 'undefined' || priceId === 'null') {
        alert('Price ID tidak valid!');
        return;
    }
    var priceUsd = parseFloat(document.getElementById('editPriceUsd').value);
    var taxIdr = parseInt(document.getElementById('editTaxIdr').value) || 0;
    var editReason = document.getElementById('editPriceReason').value.trim();
    
    if (!editReason) { alert('Alasan edit wajib diisi!'); return; }
    if (isNaN(priceUsd) || priceUsd <= 0) { alert('Harga USD tidak valid!'); return; }
    
    try {
        var res = await fetch('/api/devices/price/' + priceId, {
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ price_usd: priceUsd, tax_idr: taxIdr, edit_reason: editReason, edited_by: 'customs_officer' })
        });
        var result = await res.json();
        if (result.status === 'ok') {
            closeEditModal();
            showNotification('Harga berhasil diupdate!', 'success');
            refreshAfterEdit();
        } else { alert('Gagal: ' + result.message); }
    } catch (err) { alert('Error: ' + err.message); }
}

async function submitEditDevice(deviceId) {
    if (!deviceId || deviceId === 'undefined' || deviceId === 'null') {
        alert('Device ID tidak valid!');
        return;
    }
    var model = document.getElementById('editModel').value.trim();
    var capacity = document.getElementById('editCapacity').value.trim();
    var editReason = document.getElementById('editDeviceReason').value.trim();
    
    if (!editReason) { alert('Alasan edit wajib diisi!'); return; }
    if (!model) { alert('Nama model tidak boleh kosong!'); return; }
    if (!capacity) { alert('Storage tidak boleh kosong!'); return; }
    
    try {
        var res = await fetch('/api/devices/device/' + deviceId, {
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model, capacity: capacity, edit_reason: editReason, edited_by: 'customs_officer' })
        });
        var result = await res.json();
        if (result.status === 'ok') {
            closeEditModal();
            showNotification('Nama device berhasil diupdate!', 'success');
            refreshAfterEdit();
        } else { alert('Gagal: ' + result.message); }
    } catch (err) { alert('Error: ' + err.message); }
}

async function submitDeleteDevice(deviceId, deviceName) {
    if (!deviceId || deviceId === 'undefined' || deviceId === 'null') {
        alert('Device ID tidak valid!');
        return;
    }
    var deleteReason = document.getElementById('deleteDeviceReason').value.trim();
    if (!deleteReason) {
        alert('Alasan penghapusan wajib diisi!');
        return;
    }

    if (!confirm('Apakah Anda yakin ingin menghapus data device "' + (deviceName || deviceId) + '" secara permanen?')) {
        return;
    }

    try {
        var res = await fetch('/api/devices/device/' + deviceId, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delete_reason: deleteReason, deleted_by: 'customs_officer' })
        });
        var result = await res.json();
        if (result.status === 'ok') {
            closeEditModal();
            showNotification(result.message || 'Device berhasil dihapus!', 'success');
            refreshAfterEdit();
        } else {
            alert('Gagal menghapus: ' + result.message);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// ==================== DUPLICATE DETECTION & MANAGER ====================

var cachedDuplicateGroups = [];

async function checkDeviceDuplicates() {
    try {
        var res = await fetch('/api/devices/duplicates');
        var json = await res.json();
        if (json.status === 'ok') {
            cachedDuplicateGroups = json.data || [];
            updateDuplicateBanner(json.total_duplicate_groups, json.total_excess_items, json.data);
        }
    } catch (err) {
        console.error('Error checking duplicates:', err);
    }
}

function updateDuplicateBanner(totalGroups, totalExcess, groups) {
    var banner = document.getElementById('deviceDuplicateAlertBanner');
    if (!banner) return;

    if (totalGroups > 0) {
        var sampleModels = groups.slice(0, 3).map(function(g) { return g.model + ' ' + g.capacity; }).join(', ');
        if (groups.length > 3) sampleModels += ', dll.';

        banner.className = 'mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 animate-pulse';
        banner.innerHTML = 
            '<div class="flex items-center gap-3">' +
                '<div class="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 text-lg">' +
                    '<i class="fas fa-exclamation-triangle"></i>' +
                '</div>' +
                '<div>' +
                    '<div class="flex items-center gap-2">' +
                        '<h4 class="font-semibold text-amber-400 text-sm">Terdeteksi ' + totalGroups + ' Grup Data Duplikat (' + totalExcess + ' item ganda)</h4>' +
                        '<span class="bg-amber-500 text-black font-bold text-[10px] px-2 py-0.5 rounded-full uppercase">KNO Alert</span>' +
                    '</div>' +
                    '<p class="text-xs text-gray-300 mt-0.5">Model terdeteksi dobel: <span class="text-amber-200 font-medium">' + sampleModels + '</span></p>' +
                '</div>' +
            '</div>' +
            '<div class="flex items-center gap-2 shrink-0 w-full md:w-auto">' +
                '<button onclick="openDuplicateManagerModal()" class="w-full md:w-auto px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-lg transition flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20">' +
                    '<i class="fas fa-layer-group"></i>Kelola & Bersihkan Duplikat' +
                '</button>' +
            '</div>';
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

function openDuplicateManagerModal() {
    var existingModal = document.getElementById('duplicateManagerModal');
    if (existingModal) existingModal.remove();

    var modal = document.createElement('div');
    modal.id = 'duplicateManagerModal';
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4';
    
    var groupsHtml = '';
    if (cachedDuplicateGroups.length === 0) {
        groupsHtml = 
            '<div class="text-center py-12 text-gray-400">' +
                '<div class="w-16 h-16 rounded-full bg-green-500/10 text-green-400 flex items-center justify-center mx-auto mb-3 text-2xl"><i class="fas fa-check-circle"></i></div>' +
                '<p class="text-base font-medium text-white">Semua Data Bersih & Rapi!</p>' +
                '<p class="text-xs text-gray-400 mt-1">Tidak ditemukan data duplikat pada database referensi device.</p>' +
            '</div>';
    } else {
        cachedDuplicateGroups.forEach(function(group, gIdx) {
            var itemsHtml = group.items.map(function(item, idx) {
                var isMaster = (idx === 0);
                var formattedDate = item.latest_updated_at ? new Date(item.latest_updated_at).toLocaleString('id-ID') : '-';
                return (
                    '<div class="p-3 rounded-lg ' + (isMaster ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-slate-700/50 border border-slate-600/50') + ' flex flex-col md:flex-row justify-between items-start md:items-center gap-3">' +
                        '<div class="flex items-center gap-3">' +
                            '<span class="text-xs px-2 py-0.5 rounded font-bold ' + (isMaster ? 'bg-emerald-500 text-black' : 'bg-slate-600 text-gray-300') + '">' +
                                (isMaster ? 'MASTER (Terbaru)' : 'DUPLIKAT #' + idx) +
                            '</span>' +
                            '<div>' +
                                '<div class="flex items-center gap-2">' +
                                    '<span class="text-sm font-bold text-white">$' + Number(item.latest_price_usd).toLocaleString() + '</span>' +
                                    '<span class="text-xs text-gray-400">| Pajak: Rp ' + Number(item.latest_tax_idr).toLocaleString() + '</span>' +
                                '</div>' +
                                '<p class="text-[11px] text-gray-400 mt-0.5">Update: ' + formattedDate + ' &bull; Sumber: ' + (item.latest_source || 'Manual') + ' &bull; ID: <code class="text-blue-400 font-mono text-[10px]">' + item._id + '</code></p>' +
                            '</div>' +
                        '</div>' +
                        '<div class="flex items-center gap-2 self-end md:self-center">' +
                            (!isMaster ? 
                                '<button onclick="executeSingleDelete(\'' + item._id + '\', \'' + group.brand + ' ' + group.model + ' (' + group.capacity + ')\')" class="px-2.5 py-1.5 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition flex items-center gap-1"><i class="fas fa-trash"></i> Hapus</button>' : 
                                '<span class="text-xs text-emerald-400 font-semibold px-2 py-1"><i class="fas fa-shield-alt mr-1"></i>Akan Dipertahankan</span>'
                            ) +
                        '</div>' +
                    '</div>'
                );
            }).join('');

            groupsHtml += 
                '<div class="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4 shadow-lg">' +
                    '<div class="flex justify-between items-center mb-3 pb-2 border-b border-slate-700">' +
                        '<div class="flex items-center gap-2">' +
                            '<span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>' +
                            '<h4 class="font-bold text-white text-base">' + group.brand + ' ' + group.model + ' <span class="text-amber-400">(' + group.capacity + ')</span></h4>' +
                        '</div>' +
                        '<span class="bg-amber-500/20 text-amber-300 text-xs px-2.5 py-1 rounded-full font-semibold">' + group.count + ' Entitas Terdaftar</span>' +
                    '</div>' +
                    '<div class="space-y-2">' + itemsHtml + '</div>' +
                '</div>';
        });
    }

    modal.innerHTML = 
        '<div class="bg-slate-900 rounded-2xl p-6 w-full max-w-3xl mx-auto border border-slate-700 max-h-[90vh] flex flex-col shadow-2xl">' +
            '<div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">' +
                '<div>' +
                    '<h3 class="text-xl font-bold text-white flex items-center gap-2">' +
                        '<i class="fas fa-layer-group text-amber-400"></i>Duplicate Device Manager' +
                    '</h3>' +
                    '<p class="text-xs text-gray-400 mt-1">Audit dan pembersihan data handphone ganda di sistem KNO SkyGuard</p>' +
                '</div>' +
                '<button onclick="closeDuplicateManagerModal()" class="text-gray-400 hover:text-white text-xl p-1.5 rounded-lg hover:bg-slate-800 transition"><i class="fas fa-times"></i></button>' +
            '</div>' +
            
            (cachedDuplicateGroups.length > 0 ? 
                '<div class="bg-gradient-to-r from-amber-500/20 via-orange-500/10 to-transparent border border-amber-500/30 rounded-xl p-4 mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">' +
                    '<div>' +
                        '<p class="text-sm font-bold text-white">Rekomendasi Tindakan Cepat (1-Klik)</p>' +
                        '<p class="text-xs text-gray-300 mt-0.5">Gabungkan riwayat harga ke entitas master terbaru & hapus duplikat yang berlebih secara aman.</p>' +
                    '</div>' +
                    '<button onclick="executeAutoCleanDuplicates()" class="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-extrabold text-xs rounded-xl transition flex items-center gap-2 shadow-lg shadow-amber-500/20 shrink-0">' +
                        '<i class="fas fa-magic"></i>Otomatis Bersihkan Semua' +
                    '</button>' +
                '</div>' : ''
            ) +
            
            '<div class="flex-1 overflow-y-auto pr-1 space-y-3">' +
                groupsHtml +
            '</div>' +
            
            '<div class="mt-4 pt-3 border-t border-slate-800 flex justify-end">' +
                '<button onclick="closeDuplicateManagerModal()" class="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-gray-300 text-sm font-medium rounded-xl transition">Tutup</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(modal);
}

function closeDuplicateManagerModal() {
    var m = document.getElementById('duplicateManagerModal');
    if (m) m.remove();
}

async function executeAutoCleanDuplicates() {
    if (!confirm('Jalankan pembersihan otomatis untuk semua data ganda? Riwayat harga akan dikonsolidasikan ke entitas master dan entitas duplikat akan dihapus secara aman.')) {
        return;
    }

    try {
        var res = await fetch('/api/devices/duplicates/auto-clean', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        var result = await res.json();
        if (result.status === 'ok') {
            showNotification(result.message, 'success');
            closeDuplicateManagerModal();
            refreshAfterEdit();
            checkDeviceDuplicates();
        } else {
            alert('Gagal membersihkan duplikat: ' + result.message);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function executeSingleDelete(deviceId, deviceName) {
    if (!confirm('Hapus entitas duplikat untuk "' + deviceName + '"?')) {
        return;
    }

    try {
        var res = await fetch('/api/devices/device/' + deviceId, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delete_reason: 'Pembersihan duplikat manual dari Duplicate Manager' })
        });
        var result = await res.json();
        if (result.status === 'ok') {
            showNotification('Entitas duplikat berhasil dihapus', 'success');
            // Refresh duplicates data and re-render modal
            var dupRes = await fetch('/api/devices/duplicates');
            var dupJson = await dupRes.json();
            if (dupJson.status === 'ok') {
                cachedDuplicateGroups = dupJson.data || [];
                updateDuplicateBanner(dupJson.total_duplicate_groups, dupJson.total_excess_items, dupJson.data);
                openDuplicateManagerModal();
            }
            refreshAfterEdit();
        } else {
            alert('Gagal menghapus: ' + result.message);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function showNotification(message, type) {
    var existing = document.getElementById('notificationToast');
    if (existing) existing.remove();
    var bgColor = type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600';
    var icon = type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'info-circle';
    var notif = document.createElement('div');
    notif.id = 'notificationToast';
    notif.className = 'fixed top-4 right-4 ' + bgColor + ' text-white px-5 py-3 rounded-xl shadow-2xl z-50 flex items-center gap-3 border border-white/20 transition-all transform animate-bounce';
    notif.innerHTML = '<i class="fas fa-' + icon + ' text-lg"></i><span class="text-sm font-medium">' + message + '</span>';
    document.body.appendChild(notif);
    setTimeout(function() { 
        notif.classList.remove('animate-bounce');
        notif.style.opacity = '0';
        setTimeout(function() { notif.remove(); }, 500);
    }, 3500);
}

function refreshAfterEdit() {
    if (typeof loadAllDevices === 'function') loadAllDevices();
    if (typeof loadGroupedView === 'function' && typeof currentBrandGrouped !== 'undefined') {
        setTimeout(function() { loadGroupedView(currentBrandGrouped); }, 300);
    }
    if (typeof loadHomeData === 'function') loadHomeData();
    if (typeof checkDeviceDuplicates === 'function') {
        setTimeout(checkDeviceDuplicates, 400);
    }
}

// Auto-check duplicates on script load
if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(checkDeviceDuplicates, 1000);
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(checkDeviceDuplicates, 1000);
        });
    }
}

