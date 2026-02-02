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
    modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';
    modal.innerHTML = 
        '<div class="bg-slate-800 rounded-xl p-6 w-full max-w-lg mx-4 border border-slate-600 max-h-[90vh] overflow-y-auto">' +
            '<div class="flex justify-between items-center mb-4">' +
                '<h3 class="text-lg font-semibold text-white"><i class="fas fa-edit mr-2 text-yellow-400"></i>Edit Data Device</h3>' +
                '<button onclick="closeEditModal()" class="text-gray-400 hover:text-white text-xl"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="bg-slate-700/50 rounded-lg p-3 mb-4">' +
                '<p class="text-blue-400 font-medium">' + brand + ' ' + model + '</p>' +
                '<p class="text-gray-400 text-sm">' + capacity + '</p>' +
            '</div>' +
            '<div class="flex gap-2 mb-4">' +
                '<button id="tabPrice" onclick="switchEditTab(\'price\')" class="flex-1 py-2 px-4 rounded-lg bg-yellow-500 text-black font-medium transition"><i class="fas fa-dollar-sign mr-1"></i>Edit Harga</button>' +
                '<button id="tabDevice" onclick="switchEditTab(\'device\')" class="flex-1 py-2 px-4 rounded-lg bg-slate-600 text-gray-300 font-medium hover:bg-slate-500 transition"><i class="fas fa-mobile-alt mr-1"></i>Edit Nama</button>' +
            '</div>' +
            '<div id="priceEditForm">' +
                '<div class="space-y-4">' +
                    '<div><label class="block text-sm text-gray-300 mb-1">Harga USD</label>' +
                    '<input type="number" id="editPriceUsd" value="' + priceUsd + '" step="0.01" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"></div>' +
                    '<div><label class="block text-sm text-gray-300 mb-1">Pajak IDR</label>' +
                    '<input type="number" id="editTaxIdr" value="' + (taxIdr || 0) + '" step="1" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"></div>' +
                    '<div><label class="block text-sm text-gray-300 mb-1">Alasan Edit <span class="text-red-400">*</span></label>' +
                    '<input type="text" id="editPriceReason" placeholder="Contoh: Koreksi harga" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"></div>' +
                    '<div class="flex gap-3 pt-2">' +
                        '<button onclick="closeEditModal()" class="flex-1 bg-slate-600 hover:bg-slate-500 text-white py-2 rounded-lg transition">Batal</button>' +
                        '<button onclick="submitEditPrice(\'' + priceId + '\')" class="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-semibold py-2 rounded-lg transition"><i class="fas fa-save mr-2"></i>Simpan Harga</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div id="deviceEditForm" class="hidden">' +
                '<div class="space-y-4">' +
                    '<div><label class="block text-sm text-gray-300 mb-1">Nama Model</label>' +
                    '<input type="text" id="editModel" value="' + model + '" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500" placeholder="Contoh: iPhone 17 Pro Max"></div>' +
                    '<div><label class="block text-sm text-gray-300 mb-1">Storage/Capacity</label>' +
                    '<input type="text" id="editCapacity" value="' + capacity + '" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500" placeholder="Contoh: 256GB"></div>' +
                    '<div><label class="block text-sm text-gray-300 mb-1">Alasan Edit <span class="text-red-400">*</span></label>' +
                    '<input type="text" id="editDeviceReason" placeholder="Contoh: Koreksi nama model yang salah" class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"></div>' +
                    '<div class="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-amber-400 text-sm"><i class="fas fa-exclamation-triangle mr-2"></i><strong>Perhatian:</strong> Mengubah nama akan mempengaruhi semua data terkait device ini.</div>' +
                    '<div class="flex gap-3 pt-2">' +
                        '<button onclick="closeEditModal()" class="flex-1 bg-slate-600 hover:bg-slate-500 text-white py-2 rounded-lg transition">Batal</button>' +
                        '<button onclick="submitEditDevice(\'' + deviceId + '\')" class="flex-1 bg-blue-500 hover:bg-blue-400 text-white font-semibold py-2 rounded-lg transition"><i class="fas fa-save mr-2"></i>Simpan Nama</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    document.body.appendChild(modal);
}

function switchEditTab(tab) {
    var tabPrice = document.getElementById('tabPrice');
    var tabDevice = document.getElementById('tabDevice');
    var priceForm = document.getElementById('priceEditForm');
    var deviceForm = document.getElementById('deviceEditForm');
    
    if (tab === 'price') {
        tabPrice.className = 'flex-1 py-2 px-4 rounded-lg bg-yellow-500 text-black font-medium transition';
        tabDevice.className = 'flex-1 py-2 px-4 rounded-lg bg-slate-600 text-gray-300 font-medium hover:bg-slate-500 transition';
        priceForm.classList.remove('hidden');
        deviceForm.classList.add('hidden');
    } else {
        tabPrice.className = 'flex-1 py-2 px-4 rounded-lg bg-slate-600 text-gray-300 font-medium hover:bg-slate-500 transition';
        tabDevice.className = 'flex-1 py-2 px-4 rounded-lg bg-blue-500 text-white font-medium transition';
        priceForm.classList.add('hidden');
        deviceForm.classList.remove('hidden');
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

function showNotification(message, type) {
    var existing = document.getElementById('notificationToast');
    if (existing) existing.remove();
    var bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    var icon = type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'info-circle';
    var notif = document.createElement('div');
    notif.id = 'notificationToast';
    notif.className = 'fixed top-4 right-4 ' + bgColor + ' text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2';
    notif.innerHTML = '<i class="fas fa-' + icon + '"></i><span>' + message + '</span>';
    document.body.appendChild(notif);
    setTimeout(function() { notif.remove(); }, 3000);
}

function refreshAfterEdit() {
    if (typeof loadAllDevices === 'function') loadAllDevices();
    if (typeof loadGroupedView === 'function' && typeof currentBrandGrouped !== 'undefined') {
        setTimeout(function() { loadGroupedView(currentBrandGrouped); }, 500);
    }
    if (typeof loadHomeData === 'function') loadHomeData();
}
