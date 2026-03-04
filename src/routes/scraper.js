/**
 * Scraper API Routes
 * Endpoints for browser-to-server CEISA data bridge
 */
const express = require("express");
const router = express.Router();
const scraperService = require("../services/scraperService");
const { requireAuth } = require("../middleware/auth");

// ── POST /api/scraper/session - Create new scraping session ──
router.post("/session", requireAuth, async (req, res) => {
  try {
    const session = await scraperService.createSession(req.body);
    res.json({
      status: "ok",
      session_id: session.session_id,
      message: "Scraping session created",
    });
  } catch (err) {
    console.error("[Scraper] Create session error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── POST /api/scraper/ingest - Receive batch of scraped records ──
router.post("/ingest", requireAuth, async (req, res) => {
  try {
    const { session_id, records, meta } = req.body;
    if (!session_id || !records || !Array.isArray(records)) {
      return res.status(400).json({
        status: "error",
        message: "Required: session_id, records[]",
      });
    }

    const result = await scraperService.ingestBatch(session_id, records, meta);
    res.json({ status: "ok", ...result });
  } catch (err) {
    console.error("[Scraper] Ingest error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── GET /api/scraper/status/:session_id - Get session status ──
router.get("/status/:session_id", async (req, res) => {
  try {
    const session = await scraperService.getSession(req.params.session_id);
    if (!session)
      return res.status(404).json({ status: "error", message: "Not found" });
    res.json({ status: "ok", session });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── GET /api/scraper/latest - Get latest session ──
router.get("/latest", async (req, res) => {
  try {
    const session = await scraperService.getLatestSession();
    res.json({ status: "ok", session });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── GET /api/scraper/sessions - List all sessions ──
router.get("/sessions", async (req, res) => {
  try {
    const sessions = await scraperService.getAllSessions(
      Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20)),
    );
    res.json({ status: "ok", sessions });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── PUT /api/scraper/session/:session_id - Update session status ──
router.put("/session/:session_id", requireAuth, async (req, res) => {
  try {
    const { status, notes, elapsed_seconds, current_page } = req.body;
    const extra = {};
    if (notes) extra.notes = notes;
    if (elapsed_seconds) extra.elapsed_seconds = elapsed_seconds;
    if (current_page) extra.current_page = current_page;

    const session = await scraperService.updateSessionStatus(
      req.params.session_id,
      status,
      extra,
    );
    if (!session)
      return res.status(404).json({ status: "error", message: "Not found" });
    res.json({ status: "ok", session });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── GET /api/scraper/db-stats - Database statistics ──
router.get("/db-stats", async (req, res) => {
  try {
    const stats = await scraperService.getDbStats();
    res.json({ status: "ok", ...stats });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Sanitize string for safe interpolation into generated JS (prevent script injection)
function sanitizeForScript(s) {
  if (s == null || typeof s !== "string") return "";
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r|\n/g, " ").trim();
}

// ── GET /api/scraper/script - Generate browser scraper script ──
router.get("/script", async (req, res) => {
  const baseUrl = sanitizeForScript(req.query.api_url || `${req.protocol}://${req.get("host")}`).slice(0, 500);
  const totalPages = Math.min(100000, Math.max(1, parseInt(req.query.pages, 10) || 5330));
  const dateStart = sanitizeForScript(req.query.date_start || "27-12-2025").slice(0, 20);
  const dateEnd = sanitizeForScript(req.query.date_end || "25-02-2026").slice(0, 20);
  const delay = Math.min(10000, Math.max(100, parseInt(req.query.delay, 10) || 250));
  const batchSize = Math.min(500, Math.max(1, parseInt(req.query.batch, 10) || 100));

  const script = generateBrowserScript({
    baseUrl,
    totalPages,
    dateStart,
    dateEnd,
    delay,
    batchSize,
  });

  res.type("application/javascript").send(script);
});

function generateBrowserScript(cfg) {
  return `// ═══════════════════════════════════════════════════════════
// SkyGuard Auto Scraper - CEISA IMEI Detail Bridge
// Jalankan di console browser CEISA (cdIMEI.html)
// Data langsung masuk ke database SkyGuard tanpa download CSV
// ═══════════════════════════════════════════════════════════
(async function(){
  var API = '${cfg.baseUrl}/api/scraper';
  var TOTAL_PAGES = ${cfg.totalPages};
  var DELAY = ${cfg.delay};
  var BATCH_SIZE = ${cfg.batchSize};
  var DATE_START = '${cfg.dateStart}';
  var DATE_END = '${cfg.dateEnd}';

  // ── Helpers ──
  function s(t){return (t||'').replace(/&nbsp;/g,' ').replace(/;/g,',').replace(/\\n/g,' ').replace(/\\s+/g,' ').trim();}

  function jsVar(html, name){
    var re=new RegExp("var\\\\s+"+name+"\\\\s*=\\\\s*'([^']*)'");
    var m=html.match(re);
    return m?m[1]:'';
  }

  function getLabel($d, label){
    var val='';
    $d.find('td strong').each(function(){
      if($(this).text().trim()===label){
        val=$(this).closest('td').next('td').text().trim();
        return false;
      }
    });
    return s(val);
  }

  function getIds(html){
    var ids=[];
    $('<div>').html(html).find('tr.list_daftarCdImei').each(function(){
      var id=$(this).find('td.id').text().trim();
      if(id) ids.push(id);
    });
    return ids;
  }

  // ── Parse Detail (script 1 format - 39 columns) ──
  function parseDetail(html, id){
    var $d=$('<div>').html(html);
    var lines=[];

    var cara='';
    $d.find('h4').each(function(){
      var t=$(this).text().trim();
      if(t.indexOf('Cara Pembayaran')>-1){
        cara=s(t.split(':')[1]||'');
        return false;
      }
    });

    var dokRaw=getLabel($d,'No / Tgl Dokumen');
    var noDok='',tglDok='';
    var dokParts=dokRaw.split(/\\s+\\/\\s+/);
    if(dokParts.length>=2){noDok=s(dokParts[0]);tglDok=s(dokParts[1]);}
    else{noDok=s(dokRaw);}

    var nama=getLabel($d,'Nama Lengkap');
    var noId=getLabel($d,'Nomor Identitas');
    var wn=getLabel($d,'Kewarganegaraan');
    var npwp=getLabel($d,'NPWP / NIK');
    var flight=getLabel($d,'Nomor Flight Voyage');
    var wkDatang=getLabel($d,'Waktu Kedatangan');
    var wkRekam=getLabel($d,'Waktu Rekam Petugas');

    var bilRaw=getLabel($d,'Kode Billing / Tgl Billing');
    var kdBil='',tglBil='';
    var bilParts=bilRaw.split(/\\s+\\/\\s+/);
    if(bilParts.length>=2){kdBil=s(bilParts[0]);tglBil=s(bilParts[1]);}

    var ndpbm=jsVar(html,'jmlNdpbm');
    var cifUsdTotal=jsVar(html,'jmlCifUsd');
    var npUsd=jsVar(html,'jmlNPUsd');
    var npRupiah=jsVar(html,'jmlNPRupiah');
    var jmlBm=jsVar(html,'jmlBm');
    var jmlPpn=jsVar(html,'jmlPpn');
    var jmlPph=jsVar(html,'jmlPph');
    var jmlTotalP=jsVar(html,'jmlTotalP');

    var pembebasan='';
    var pmatch=html.match(/DivDetPembebasan'\\)\\.html\\(formatHarga\\('([^']*)'\\)/);
    if(pmatch) pembebasan=pmatch[1];

    var tarifBm='',tarifPpn='',tarifPph='';
    var tbm=html.match(/divBm'\\)\\.html\\('(\\d+)\\s*%/);if(tbm) tarifBm=tbm[1]+'%';
    var tpn=html.match(/divPpn'\\)\\.html\\('(\\d+)\\s*%/);if(tpn) tarifPpn=tpn[1]+'%';
    var tph=html.match(/divPph'\\)\\.html\\('(\\d+)\\s*%/);if(tph) tarifPph=tph[1]+'%';

    var $rows=$d.find('tr.list_previewdetailimei');
    if($rows.length===0){
      lines.push({
        'ID':id,'No Dokumen':noDok,'Tgl Dokumen':tglDok,'Nama':nama,'No Identitas':noId,
        'Kebangsaan':wn,'NPWP/NIK':npwp,'Flight Voyage':flight,'Waktu Kedatangan':wkDatang,
        'Waktu Rekam Petugas':wkRekam,'Cara Pembayaran':cara,'Kode Billing':kdBil,
        'Tgl Billing':tglBil,'NDPBM':ndpbm,'Pembebasan USD':pembebasan,
        'No':'','Merk':'','Tipe':'','Storage':'','RAM':'','Warna':'',
        'IMEI1':'','IMEI2':'','Harga FOB':'','Mata Uang':'','Harga FOB USD':'',
        'HS Code':'','Bekas':'','CIF USD':'',
        'Total CIF USD':cifUsdTotal,'Total CIF Pembebasan USD':npUsd,
        'Nilai Pabean Rp':npRupiah,'Tarif BM':tarifBm,'Pungutan BM':jmlBm,
        'Tarif PPN':tarifPpn,'Pungutan PPN':jmlPpn,'Tarif PPh':tarifPph,
        'Pungutan PPh':jmlPph,'Total Pungutan':jmlTotalP
      });
    } else {
      $rows.each(function(){
        lines.push({
          'ID':id,'No Dokumen':noDok,'Tgl Dokumen':tglDok,'Nama':nama,'No Identitas':noId,
          'Kebangsaan':wn,'NPWP/NIK':npwp,'Flight Voyage':flight,'Waktu Kedatangan':wkDatang,
          'Waktu Rekam Petugas':wkRekam,'Cara Pembayaran':cara,'Kode Billing':kdBil,
          'Tgl Billing':tglBil,'NDPBM':ndpbm,'Pembebasan USD':pembebasan,
          'No':s($(this).find('.urut').text()),
          'Merk':s($(this).find('.kdMerkHp').text()),
          'Tipe':s($(this).find('.kdTipeHp').text()),
          'Storage':s($(this).find('.kdKapasitasHp').text()),
          'RAM':s($(this).find('.ram').text()),
          'Warna':s($(this).find('.warna').text()),
          'IMEI1':s($(this).find('.imei1').text()),
          'IMEI2':s($(this).find('.imei2').text()),
          'Harga FOB':s($(this).find('.hargaBrg').text()),
          'Mata Uang':s($(this).find('.kdKurs').text()),
          'Harga FOB USD':s($(this).find('.hargaBrgUsd').text()),
          'HS Code':s($(this).find('.hsCode').text()),
          'Bekas':s($(this).find('.flBekas').text()),
          'CIF USD':s($(this).find('.hargaPenetapan').text()),
          'Total CIF USD':cifUsdTotal,'Total CIF Pembebasan USD':npUsd,
          'Nilai Pabean Rp':npRupiah,'Tarif BM':tarifBm,'Pungutan BM':jmlBm,
          'Tarif PPN':tarifPpn,'Pungutan PPN':jmlPpn,'Tarif PPh':tarifPph,
          'Pungutan PPh':jmlPph,'Total Pungutan':jmlTotalP
        });
      });
    }
    return lines;
  }

  // ── CEISA API Calls ──
  function fetchBrowse(p){
    return new Promise(function(ok,fail){
      $.post('cdIMEI.html',{
        content:'listNew',txtPage:p,txtPar:'WK_REKAM_PETUGAS',txtOrder:'DESC',
        txtNama:'',txtJenisIdentitas:'',txtNoIdentitas:'',txtKebangsaan:'',
        txtNPWP:'',txtFlightVoyageNum:'',
        txtTglDatangAwal:DATE_START,txtTglDatangAkhir:DATE_END,
        txtNipPetugas:'',txtNoCd:'',txtQrCode:'',
        txtTglCdAwal:'',txtTglCdAkhir:'',txtStatusPembayaran:'',txtKdKantorPetugas:''
      }).done(ok).fail(fail);
    });
  }

  function fetchDetail(id){
    return new Promise(function(ok,fail){
      $.get('cdIMEI.html',{content:'detailNew',txtIdPelaporImei:id}).done(ok).fail(fail);
    });
  }

  // ── SkyGuard API Calls ──
  async function apiPost(path, data){
    var r=await fetch(API+path,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });
    return r.json();
  }

  async function apiPut(path, data){
    var r=await fetch(API+path,{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });
    return r.json();
  }

  // ── Status Bar ──
  var statusDiv=document.createElement('div');
  statusDiv.id='skyguard-scraper-status';
  statusDiv.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#1a1a2e;color:#0f0;font-family:monospace;font-size:12px;padding:8px 16px;display:flex;gap:20px;align-items:center;border-bottom:2px solid #0f0;';
  statusDiv.innerHTML='<span>🛡️ SkyGuard Scraper</span><span id="sg-status">Initializing...</span><span id="sg-progress"></span><span id="sg-stats"></span><button id="sg-cancel" style="margin-left:auto;background:#ff4444;color:#fff;border:none;padding:4px 12px;cursor:pointer;border-radius:4px;">⏹ Stop</button>';
  document.body.appendChild(statusDiv);

  var cancelled=false;
  document.getElementById('sg-cancel').onclick=function(){cancelled=true;this.textContent='Stopping...';};

  function setStatus(msg){document.getElementById('sg-status').textContent=msg;}
  function setProgress(msg){document.getElementById('sg-progress').textContent=msg;}
  function setStats(msg){document.getElementById('sg-stats').textContent=msg;}

  // ── Test ──
  setStatus('Testing connection...');
  console.log('[SkyGuard] Testing browse page 1...');
  var bHtml=await fetchBrowse(1);
  var testIds=getIds(bHtml);
  console.log('[SkyGuard] IDs:',testIds.length,'First:',testIds[0]);

  if(!testIds.length){
    setStatus('ERROR: No data found! Check date range.');
    console.log('[SkyGuard] GAGAL! Tidak ada data');
    return;
  }

  console.log('[SkyGuard] Testing detail '+testIds[0]+'...');
  var dHtml=await fetchDetail(testIds[0]);
  var testRows=parseDetail(dHtml,testIds[0]);
  console.log('[SkyGuard] Parsed rows:',testRows.length);
  console.log('[SkyGuard] Sample:',JSON.stringify(testRows[0]).substring(0,200));

  var filled=Object.values(testRows[0]).filter(function(x){return x;}).length;
  console.log('[SkyGuard] Filled fields:',filled);
  if(filled<10){
    setStatus('ERROR: Parse failed! Only '+filled+' fields');
    return;
  }

  // ── Create Session ──
  setStatus('Creating scrape session...');
  var sessResp=await apiPost('/session',{
    type:'imei_detail',
    total_pages:TOTAL_PAGES,
    date_start:DATE_START,
    date_end:DATE_END,
    user_agent:navigator.userAgent,
    notes:'Auto scrape from browser console'
  });

  if(sessResp.status!=='ok'){
    setStatus('ERROR: '+sessResp.message);
    console.log('[SkyGuard] Session create failed:', sessResp);
    return;
  }

  var SESSION=sessResp.session_id;
  console.log('[SkyGuard] Session:',SESSION);
  setStatus('Session: '+SESSION);

  // ── Full Scrape ──
  var buffer=[], count=0, newTotal=0, dupTotal=0, errTotal=0;
  var startTime=Date.now();

  for(var p=1;p<=TOTAL_PAGES;p++){
    if(cancelled){
      await apiPut('/session/'+SESSION,{status:'cancelled',elapsed_seconds:Math.round((Date.now()-startTime)/1000)});
      setStatus('CANCELLED at page '+p);
      console.log('[SkyGuard] Cancelled by user');
      break;
    }

    try{
      var bh=await fetchBrowse(p);
      var ids=getIds(bh);

      if(ids.length===0){
        // No more data - we've reached the end
        console.log('[SkyGuard] Page '+p+' empty - scraping complete');
        break;
      }

      for(var i=0;i<ids.length;i++){
        if(cancelled) break;
        try{
          var dh=await fetchDetail(ids[i]);
          var rows=parseDetail(dh,ids[i]);
          for(var r=0;r<rows.length;r++) buffer.push(rows[r]);
          count+=rows.length;

          // Flush buffer when reaching batch size
          if(buffer.length>=BATCH_SIZE){
            var elapsed=Math.round((Date.now()-startTime)/1000);
            var resp=await apiPost('/ingest',{
              session_id:SESSION,
              records:buffer,
              meta:{current_page:p,elapsed_seconds:elapsed}
            });
            if(resp.status==='ok'){
              newTotal+=resp['new'];
              dupTotal+=resp.duplicates;
              errTotal+=resp.errors;
              setStats('New:'+newTotal+' Dup:'+dupTotal+' Err:'+errTotal+' DB:'+resp.db_total);
            } else {
              console.log('[SkyGuard] Ingest error:',resp.message);
            }
            buffer=[];
          }
        }catch(e2){
          console.log('[SkyGuard] Skip '+ids[i]+':',e2.message||e2);
          errTotal++;
        }
        await new Promise(function(r){setTimeout(r,DELAY);});
      }

      var elapsed=Math.round((Date.now()-startTime)/1000);
      var pct=Math.round(p/TOTAL_PAGES*100);
      var rate=count/Math.max(elapsed,1);
      var eta=Math.round((TOTAL_PAGES-p)/Math.max(p/elapsed,0.01));
      setProgress('Page '+p+'/'+TOTAL_PAGES+' ('+pct+'%) | '+count+' records | '+rate.toFixed(1)+'/s | ETA: '+Math.round(eta/60)+'m');

      if(p%50===0) console.log('[SkyGuard] Page '+p+'/'+TOTAL_PAGES+' | Records:'+count+' | New:'+newTotal+' | Rate:'+rate.toFixed(1)+'/s');
    }catch(e){
      console.log('[SkyGuard] Retry page '+p+':',e.message||e);
      await new Promise(function(r){setTimeout(r,2000);});
      p--; continue;
    }
    await new Promise(function(r){setTimeout(r,50);});
  }

  // Flush remaining buffer
  if(buffer.length>0){
    var elapsed=Math.round((Date.now()-startTime)/1000);
    var resp=await apiPost('/ingest',{
      session_id:SESSION,
      records:buffer,
      meta:{current_page:TOTAL_PAGES,elapsed_seconds:elapsed}
    });
    if(resp.status==='ok'){
      newTotal+=resp['new'];
      dupTotal+=resp.duplicates;
    }
  }

  // Complete session
  var finalElapsed=Math.round((Date.now()-startTime)/1000);
  if(!cancelled){
    await apiPut('/session/'+SESSION,{
      status:'completed',
      elapsed_seconds:finalElapsed,
      current_page:TOTAL_PAGES
    });
  }

  var mins=Math.round(finalElapsed/60);
  setStatus(cancelled?'CANCELLED':'SELESAI!');
  setProgress('Total: '+count+' records | New: '+newTotal+' | Dup: '+dupTotal+' | Waktu: '+mins+' menit');
  statusDiv.style.background='#0a3d0a';
  statusDiv.style.borderColor='#0f0';

  console.log('[SkyGuard] ════════════════════════════════════');
  console.log('[SkyGuard] SCRAPING '+(cancelled?'CANCELLED':'COMPLETE'));
  console.log('[SkyGuard] Total records: '+count);
  console.log('[SkyGuard] New imports:   '+newTotal);
  console.log('[SkyGuard] Duplicates:    '+dupTotal);
  console.log('[SkyGuard] Errors:        '+errTotal);
  console.log('[SkyGuard] Duration:      '+mins+' minutes');
  console.log('[SkyGuard] Session:       '+SESSION);
  console.log('[SkyGuard] ════════════════════════════════════');
})();`;
}

module.exports = router;
