// ============== KONFIGURASI ==============
  // Email akun admin di Supabase Auth (bukan rahasia; yang rahasia hanya password-nya). Ganti sesuai akun Anda.
  const ADMIN_EMAIL = "dprkpngawi@gmail.com";
  const SUPABASE_URL = "https://mildlnlsefpoibwiccfy.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pbGRsbmxzZWZwb2lid2ljY2Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4MTgyMDksImV4cCI6MjEwNjM5NDIwOX0.xz1OLXOp2MpdLAuUsn_Dv3y7nqO10NZZfUUnBt0FOzw";

// Komponen PSU yang ditinjau. Ubah/tambah di sini kalau perlu.
const PSU_ITEMS = [
  'Jalan lingkungan',
  'Drainase / saluran air',
  'Sanitasi / pembuangan limbah',
  'Air bersih',
  'Penerangan jalan umum',
  'Taman / ruang terbuka hijau',
  'Tempat pembuangan sampah',
  'Fasilitas sosial dan umum'
];
const PSU_KONDISI = ['Baik', 'Rusak ringan', 'Rusak berat', 'Belum ada'];

// Kesimpulan -> kelas warna badge/kartu
const KESIMPULAN_CLASS = {
  'Ditindaklanjuti Pemerintah Daerah': 'setuju',
  'Perlu Koordinasi Lanjutan': 'syarat',
  'Dikelola Swadaya Warga': 'info'
};
// ==========================================

let sb = null;
try{
  if(typeof window.supabase === 'undefined' || !window.supabase.createClient){
    throw new Error('Library Supabase gagal dimuat dari CDN.');
  }
  if(SUPABASE_ANON_KEY === 'GANTI_DENGAN_ANON_KEY_KAMU' || SUPABASE_URL.includes('GANTI-PROJECT-ID')){
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY belum diisi di dalam file HTML.');
  }
  let store;
  try{ store = window.sessionStorage; }catch(_){ store = undefined; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: !!store, storage: store, autoRefreshToken: true, detectSessionInUrl: false }
  });
} catch(err){
  console.error(err);
  const banner = document.getElementById('globalError');
  banner.textContent = 'Koneksi ke database belum siap: ' + err.message + ' Coba refresh halaman, atau hubungi admin.';
  banner.style.display = 'block';
}

/* ---------- Sinkron realtime lintas perangkat ---------- */
function debounce(fn, wait){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
if(sb){
  const syncPetugas = debounce(() => loadPetugas(), 250);
  const syncPerumahan = debounce(() => { if(adminOk) loadPerumahanList(); loadConfig(); }, 250);

  sb.channel('korumtap-petugas-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'korumtap_petugas' }, syncPetugas)
    .subscribe();

  sb.channel('korumtap-perumahan-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'korumtap_perumahan' }, syncPerumahan)
    .subscribe();
}

/* ---------- Tabs ---------- */
function switchTab(tab){
  document.getElementById('viewForm').style.display = tab === 'form' ? 'block' : 'none';
  document.getElementById('viewAdmin').style.display = tab === 'admin' ? 'block' : 'none';
  document.getElementById('tabFormBtn').classList.toggle('active', tab === 'form');
  document.getElementById('tabAdminBtn').classList.toggle('active', tab === 'admin');
  if(tab === 'form' && typeof canvasNeedsSetup !== 'undefined' && canvasNeedsSetup){
    requestAnimationFrame(() => { if(canvasNeedsSetup){ canvasNeedsSetup = false; setupCanvas(); } });
  }
}

/* ---------- Kotak isian: putih saat kosong, hijau begitu terisi ---------- */
function updateFieldColor(el){
  if(!el) return;
  const val = (el.value || '').trim();
  el.classList.toggle('has-value', val.length > 0);
}
function refreshFieldColors(scope){
  const root = scope || document;
  root.querySelectorAll('input[type=text], input[type=date], textarea, select').forEach(updateFieldColor);
}
document.addEventListener('input', (e) => {
  if(e.target.matches('input[type=text], input[type=date], textarea')) updateFieldColor(e.target);
});
document.addEventListener('change', (e) => {
  if(e.target.matches('select, input[type=date]')) updateFieldColor(e.target);
});

/* ---------- Baris kondisi PSU ---------- */
function buildPsuRows(){
  const wrap = document.getElementById('psuRows');
  wrap.innerHTML = PSU_ITEMS.map((item, i) => `
    <div class="psu-item">
      <div class="psu-name">${escapeHtml(item)}</div>
      <div class="psu-grid">
        <select id="psu_kondisi_${i}">
          <option value="">-- Kondisi --</option>
          ${PSU_KONDISI.map(k => `<option value="${k}">${k}</option>`).join('')}
        </select>
        <input type="text" id="psu_ket_${i}" placeholder="Keterangan (opsional)" maxlength="300">
      </div>
    </div>
  `).join('');
}
function collectPsu(){
  const out = [];
  PSU_ITEMS.forEach((item, i) => {
    const kondisi = document.getElementById('psu_kondisi_' + i).value;
    const keterangan = document.getElementById('psu_ket_' + i).value.trim();
    if(kondisi || keterangan) out.push({ item, kondisi, keterangan });
  });
  return out;
}

function todayISO(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

/* ---------- Data Tim Koordinasi (sinkron dari database) ---------- */
let PETUGAS_LIST = [];

async function loadPetugas(){
  if(!sb){
    PETUGAS_LIST = [];
    populateTimSelect();
    renderPetugasAdminList();
    return;
  }
  const { data, error } = await sb.from('korumtap_petugas').select('*').order('nama', { ascending: true });
  if(error){
    console.error(error);
    PETUGAS_LIST = [];
  } else {
    PETUGAS_LIST = data || [];
  }
  populateTimSelect();
  renderPetugasAdminList();
}

function populateTimSelect(){
  const sel = document.getElementById('timSelect');
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">-- Pilih dari Tim Koordinasi --</option>';
  PETUGAS_LIST.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.jabatan ? `${t.nama} — ${t.jabatan}` : t.nama;
    sel.appendChild(opt);
  });
  const other = document.createElement('option');
  other.value = 'lain';
  other.textContent = '-- Lainnya (isi manual) --';
  sel.appendChild(other);
  if(currentVal && [...sel.options].some(o => o.value === currentVal)) sel.value = currentVal;
}

function applyTimSelection(){
  const sel = document.getElementById('timSelect');
  if(sel.value === '' || sel.value === 'lain'){
    if(sel.value === 'lain'){
      document.getElementById('f_nama').value = '';
      document.getElementById('f_jabatan').value = '';
      document.getElementById('f_nip').value = '';
      document.getElementById('f_unit_kerja').value = '';
      document.getElementById('f_nama').focus();
    }
    refreshFieldColors(document.getElementById('koordForm'));
    return;
  }
  const t = PETUGAS_LIST.find(p => String(p.id) === sel.value);
  if(!t) return;
  document.getElementById('f_nama').value = t.nama;
  document.getElementById('f_jabatan').value = t.jabatan || '';
  document.getElementById('f_nip').value = t.nip || '';
  document.getElementById('f_unit_kerja').value = t.unit_kerja || '';
  refreshFieldColors(document.getElementById('koordForm'));
}

/* ---------- Kelola Petugas (tab Admin) ---------- */
let editingPetugasId = null;

async function savePetugas(){
  const msg = document.getElementById('ptMsg');
  const btn = document.getElementById('ptSaveBtn');
  msg.className = 'msg'; msg.style.display = 'none';

  const nama = document.getElementById('pt_nama').value.trim();
  if(!nama){
    msg.textContent = 'Nama wajib diisi.';
    msg.className = 'msg err'; msg.style.display = 'block';
    return;
  }
  if(!sb){
    msg.textContent = 'Koneksi database belum siap. Refresh halaman lalu coba lagi.';
    msg.className = 'msg err'; msg.style.display = 'block';
    return;
  }

  if(!/^[0-9 ]{0,30}$/.test(document.getElementById('pt_nip').value.trim())){
    msg.textContent = 'NIP hanya boleh berisi angka.';
    msg.className = 'msg err'; msg.style.display = 'block';
    return;
  }

  const payload = {
    nama,
    jabatan: document.getElementById('pt_jabatan').value.trim(),
    nip: document.getElementById('pt_nip').value.trim(),
    unit_kerja: document.getElementById('pt_unit_kerja').value.trim()
  };

  const isEdit = !!editingPetugasId;
  btn.disabled = true; btn.textContent = isEdit ? 'Menyimpan perubahan...' : 'Menyimpan...';

  const { error } = isEdit
    ? await sb.from('korumtap_petugas').update(payload).eq('id', editingPetugasId)
    : await sb.from('korumtap_petugas').insert(payload);

  btn.disabled = false;

  if(error){
    console.error(error);
    msg.textContent = 'Gagal menyimpan: ' + error.message;
    msg.className = 'msg err'; msg.style.display = 'block';
    btn.textContent = isEdit ? 'Simpan Perubahan' : '+ Tambah Petugas';
  } else {
    msg.textContent = isEdit
      ? 'Perubahan tersimpan dan langsung sinkron ke dropdown form.'
      : 'Petugas ditambahkan dan langsung tersedia di dropdown form.';
    msg.className = 'msg ok'; msg.style.display = 'block';
    cancelEditPetugas();
    loadPetugas();
  }
}

function editPetugas(id){
  const t = PETUGAS_LIST.find(p => String(p.id) === String(id));
  if(!t) return;
  editingPetugasId = t.id;
  document.getElementById('pt_nama').value = t.nama || '';
  document.getElementById('pt_jabatan').value = t.jabatan || '';
  document.getElementById('pt_nip').value = t.nip || '';
  document.getElementById('pt_unit_kerja').value = t.unit_kerja || '';
  document.getElementById('ptSaveBtn').textContent = 'Simpan Perubahan';
  document.getElementById('ptCancelBtn').style.display = 'inline-block';
  document.getElementById('ptMsg').style.display = 'none';
  document.getElementById('pt_nama').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('pt_nama').focus();
  refreshFieldColors();
  renderPetugasAdminList();
}

function cancelEditPetugas(){
  editingPetugasId = null;
  document.getElementById('pt_nama').value = '';
  document.getElementById('pt_jabatan').value = '';
  document.getElementById('pt_nip').value = '';
  document.getElementById('pt_unit_kerja').value = '';
  document.getElementById('ptSaveBtn').textContent = '+ Tambah Petugas';
  document.getElementById('ptCancelBtn').style.display = 'none';
  refreshFieldColors();
  renderPetugasAdminList();
}

async function deletePetugas(id, nama){
  if(!sb) return;
  const ok = confirm(`Hapus petugas "${nama}" dari daftar?`);
  if(!ok) return;
  const { error } = await sb.from('korumtap_petugas').delete().eq('id', id);
  if(error){
    console.error(error);
    alert('Gagal menghapus: ' + error.message);
    return;
  }
  if(String(editingPetugasId) === String(id)) cancelEditPetugas();
  loadPetugas();
}

function renderPetugasAdminList(){
  const wrap = document.getElementById('petugasAdminList');
  if(!wrap) return;
  if(!PETUGAS_LIST.length){
    wrap.innerHTML = '<div class="empty">Belum ada petugas.</div>';
    return;
  }
  wrap.innerHTML = PETUGAS_LIST.map(t => `
    <div class="rekap-item"${String(t.id) === String(editingPetugasId) ? ' style="border-color:var(--gold);"' : ''}>
      <div class="top">
        <div>
          <strong>${escapeHtml(t.nama)}</strong><br>
          <small>${escapeHtml(t.jabatan || '-')}${t.unit_kerja ? ' — ' + escapeHtml(t.unit_kerja) : ''}${t.nip ? ' — NIP ' + escapeHtml(t.nip) : ''}</small>
        </div>
        <div style="display:flex;gap:6px;flex:none;">
          <button type="button" data-act="edit-petugas" data-id="${escapeHtml(t.id)}">Edit</button>
          <button type="button" class="rm-btn" data-act="del-petugas" data-id="${escapeHtml(t.id)}">&times;</button>
        </div>
      </div>
    </div>
  `).join('');
}

/* ---------- Data Umum (dipilih dari daftar yang diaktifkan admin) ---------- */
let PERUMAHAN_AKTIF_LIST = [];

function clearDataUmum(){
  ['f_nama_perumahan','f_alamat','f_status_pengembang','f_perwakilan','f_kontak','f_luas_lahan','f_jumlah_unit']
    .forEach(id => { document.getElementById(id).value = ''; });
}

async function loadConfig(){
  const hint = document.getElementById('dataUmumHint');
  const sel = document.getElementById('f_perumahan_select');
  if(!sb) return;
  const { data, error } = await sb.from('korumtap_perumahan').select('*').eq('is_active', true).order('nama_perumahan', { ascending: true });
  if(error){
    console.error(error);
    if(hint) hint.textContent = 'Gagal memuat Data Perumahan dari admin: ' + error.message;
    return;
  }
  PERUMAHAN_AKTIF_LIST = data || [];

  const currentVal = sel.value;
  sel.innerHTML = '<option value="">-- Pilih Perumahan --</option>';
  PERUMAHAN_AKTIF_LIST.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.nama_perumahan;
    sel.appendChild(opt);
  });
  if(currentVal && [...sel.options].some(o => o.value === currentVal)){
    sel.value = currentVal;
  } else if(PERUMAHAN_AKTIF_LIST.length === 1){
    sel.value = PERUMAHAN_AKTIF_LIST[0].id;
  } else {
    sel.value = '';
    clearDataUmum();
  }
  applyPerumahanSelection();

  if(hint){
    hint.textContent = PERUMAHAN_AKTIF_LIST.length
      ? 'Pilih perumahan di atas, data lokasi dan perwakilan warga otomatis terisi.'
      : 'Admin belum menandai perumahan yang sedang dikoordinasikan.';
  }
}

function applyPerumahanSelection(){
  const sel = document.getElementById('f_perumahan_select');
  const p = PERUMAHAN_AKTIF_LIST.find(x => String(x.id) === sel.value);
  document.getElementById('f_nama_perumahan').value = p?.nama_perumahan || '';
  document.getElementById('f_alamat').value = p?.alamat || '';
  document.getElementById('f_status_pengembang').value = p?.status_pengembang || '';
  document.getElementById('f_perwakilan').value = p?.perwakilan_warga || '';
  document.getElementById('f_kontak').value = p?.kontak_perwakilan || '';
  document.getElementById('f_luas_lahan').value = p?.luas_lahan || '';
  document.getElementById('f_jumlah_unit').value = p?.jumlah_unit || '';
  refreshFieldColors(document.getElementById('koordForm'));
}

/* ---------- Data Perumahan (tab Admin) ---------- */
let PERUMAHAN_LIST = [];
let editingPerumahanId = null;

async function loadPerumahanList(){
  if(!sb) return;
  const { data, error } = await sb.from('korumtap_perumahan').select('*').order('created_at', { ascending: false });
  if(error){ console.error(error); return; }
  PERUMAHAN_LIST = data || [];
  renderPerumahanAdminList();
}

async function savePerumahan(){
  const msg = document.getElementById('phMsg');
  const btn = document.getElementById('phSaveBtn');
  msg.className = 'msg'; msg.style.display = 'none';

  const nama_perumahan = document.getElementById('ph_nama_perumahan').value.trim();
  if(!nama_perumahan){
    msg.textContent = 'Nama Perumahan wajib diisi.';
    msg.className = 'msg err'; msg.style.display = 'block';
    return;
  }
  if(!sb){
    msg.textContent = 'Koneksi database belum siap. Refresh halaman lalu coba lagi.';
    msg.className = 'msg err'; msg.style.display = 'block';
    return;
  }

  const payload = {
    nama_perumahan,
    alamat: document.getElementById('ph_alamat').value.trim(),
    status_pengembang: document.getElementById('ph_status_pengembang').value,
    perwakilan_warga: document.getElementById('ph_perwakilan').value.trim(),
    kontak_perwakilan: document.getElementById('ph_kontak').value.trim(),
    luas_lahan: document.getElementById('ph_luas_lahan').value.trim(),
    jumlah_unit: document.getElementById('ph_jumlah_unit').value.trim(),
    is_active: document.getElementById('ph_aktif').checked
  };

  const isEdit = !!editingPerumahanId;
  btn.disabled = true; btn.textContent = isEdit ? 'Menyimpan perubahan...' : 'Menyimpan...';

  const { error } = isEdit
    ? await sb.from('korumtap_perumahan').update(payload).eq('id', editingPerumahanId)
    : await sb.from('korumtap_perumahan').insert(payload);

  btn.disabled = false;

  if(error){
    console.error(error);
    msg.textContent = 'Gagal menyimpan: ' + error.message;
    msg.className = 'msg err'; msg.style.display = 'block';
    btn.textContent = isEdit ? 'Simpan Perubahan' : '+ Tambah Perumahan';
  } else {
    msg.textContent = isEdit ? 'Perubahan tersimpan dan langsung sinkron ke form.' : 'Perumahan ditambahkan.';
    msg.className = 'msg ok'; msg.style.display = 'block';
    cancelEditPerumahan();
    loadPerumahanList();
    loadConfig();
  }
}

function editPerumahan(id){
  const p = PERUMAHAN_LIST.find(x => String(x.id) === String(id));
  if(!p) return;
  editingPerumahanId = p.id;
  document.getElementById('ph_nama_perumahan').value = p.nama_perumahan || '';
  document.getElementById('ph_alamat').value = p.alamat || '';
  document.getElementById('ph_status_pengembang').value = p.status_pengembang || '';
  document.getElementById('ph_perwakilan').value = p.perwakilan_warga || '';
  document.getElementById('ph_kontak').value = p.kontak_perwakilan || '';
  document.getElementById('ph_luas_lahan').value = p.luas_lahan || '';
  document.getElementById('ph_jumlah_unit').value = p.jumlah_unit || '';
  document.getElementById('ph_aktif').checked = !!p.is_active;
  document.getElementById('phSaveBtn').textContent = 'Simpan Perubahan';
  document.getElementById('phCancelBtn').style.display = 'inline-block';
  document.getElementById('phMsg').style.display = 'none';
  document.getElementById('ph_nama_perumahan').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('ph_nama_perumahan').focus();
  refreshFieldColors();
  renderPerumahanAdminList();
}

function cancelEditPerumahan(){
  editingPerumahanId = null;
  ['ph_nama_perumahan','ph_alamat','ph_status_pengembang','ph_perwakilan','ph_kontak','ph_luas_lahan','ph_jumlah_unit']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ph_aktif').checked = false;
  document.getElementById('phSaveBtn').textContent = '+ Tambah Perumahan';
  document.getElementById('phCancelBtn').style.display = 'none';
  refreshFieldColors();
  renderPerumahanAdminList();
}

async function toggleActivePerumahan(id, checked){
  if(!sb) return;
  const { error } = await sb.from('korumtap_perumahan').update({ is_active: checked }).eq('id', id);
  if(error){
    console.error(error);
    alert('Gagal mengubah status: ' + error.message);
    return;
  }
  loadPerumahanList();
  loadConfig();
}

async function deletePerumahan(id, nama){
  if(!sb) return;
  const ok = confirm(`Hapus perumahan "${nama}" dari daftar?`);
  if(!ok) return;
  const { error } = await sb.from('korumtap_perumahan').delete().eq('id', id);
  if(error){
    console.error(error);
    alert('Gagal menghapus: ' + error.message);
    return;
  }
  if(String(editingPerumahanId) === String(id)) cancelEditPerumahan();
  loadPerumahanList();
  loadConfig();
}

function renderPerumahanAdminList(){
  const wrap = document.getElementById('perumahanAdminList');
  if(!wrap) return;
  if(!PERUMAHAN_LIST.length){
    wrap.innerHTML = '<div class="empty">Belum ada perumahan.</div>';
    return;
  }
  wrap.innerHTML = PERUMAHAN_LIST.map(p => `
    <div class="rekap-item"${String(p.id) === String(editingPerumahanId) ? ' style="border-color:var(--gold);"' : ''}>
      <div class="top">
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;flex:1;">
          <input type="checkbox" style="margin-top:3px;width:16px;height:16px;flex:none;" ${p.is_active ? 'checked' : ''} data-act="toggle-perumahan" data-id="${escapeHtml(p.id)}">
          <span>
            <strong>${escapeHtml(p.nama_perumahan)}</strong>${p.is_active ? ' <span class="badge setuju">Sedang Dikoordinasikan</span>' : ''}<br>
            <small>${p.alamat ? escapeHtml(p.alamat) : '-'}</small><br>
            <small>${p.status_pengembang ? escapeHtml(p.status_pengembang) : ''}</small><br>
            <small>${p.perwakilan_warga ? 'Perwakilan: ' + escapeHtml(p.perwakilan_warga) + (p.kontak_perwakilan ? ' (' + escapeHtml(p.kontak_perwakilan) + ')' : '') : ''}</small><br>
            <small>${[p.luas_lahan ? 'Luas: ' + escapeHtml(p.luas_lahan) : '', p.jumlah_unit ? 'Unit: ' + escapeHtml(p.jumlah_unit) : ''].filter(Boolean).join(' \u2022 ')}</small>
          </span>
        </label>
        <div style="display:flex;gap:6px;flex:none;">
          <button type="button" data-act="edit-perumahan" data-id="${escapeHtml(p.id)}">Edit</button>
          <button type="button" class="rm-btn" data-act="del-perumahan" data-id="${escapeHtml(p.id)}">&times;</button>
        </div>
      </div>
    </div>
  `).join('');
}

/* ---------- Pilihan rekomendasi ---------- */
document.querySelectorAll('.kesimpulan-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.kesimpulan-opt').forEach(o => o.classList.remove('checked'));
    opt.classList.add('checked');
    opt.querySelector('input').checked = true;
  });
});

/* ---------- Signature pad (pointer events: mouse, touch, pen) ---------- */
const canvas = document.getElementById('sigPad');
const ctx = canvas.getContext('2d');
let drawing = false, hasSig = false;
let savedImage = null;
let sigLen = 0, lastPt = null;
let canvasNeedsSetup = false;
let lastCanvasW = 0;

function setupCanvas(){
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(rect.width, 1);
  const h = Math.max(rect.height, 1);

  lastCanvasW = w;
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111111';

  if(savedImage){
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, w, h);
    img.src = savedImage;
  }
}

window.addEventListener('load', setupCanvas);
window.addEventListener('load', () => refreshFieldColors());
if(document.readyState === 'complete'){ setupCanvas(); }
window.addEventListener('resize', () => {
  const w = canvas.getBoundingClientRect().width;
  if(w < 2){ // tab form sedang tersembunyi: tunda sampai tampil lagi
    if(hasSig) savedImage = canvas.toDataURL('image/png');
    canvasNeedsSetup = true;
    return;
  }
  if(Math.abs(w - lastCanvasW) < 2) return; // scroll mobile memicu resize tinggi saja; abaikan
  savedImage = hasSig ? canvas.toDataURL('image/png') : null;
  setupCanvas();
});

function getPos(e){
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function startDraw(e){
  drawing = true; hasSig = true;
  canvas.classList.add('has-sig');
  const pos = getPos(e);
  lastPt = pos;
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(pos.x + 0.1, pos.y + 0.1);
  ctx.stroke();
  try{ canvas.setPointerCapture(e.pointerId); }catch(err){}
  e.preventDefault();
}
function moveDraw(e){
  if(!drawing) return;
  const pos = getPos(e);
  if(lastPt) sigLen += Math.hypot(pos.x - lastPt.x, pos.y - lastPt.y);
  lastPt = pos;
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  e.preventDefault();
}
function endDraw(e){
  if(!drawing) return;
  drawing = false;
  try{ canvas.releasePointerCapture(e.pointerId); }catch(err){}
}

canvas.addEventListener('pointerdown', startDraw);
canvas.addEventListener('pointermove', moveDraw);
canvas.addEventListener('pointerup', endDraw);
canvas.addEventListener('pointercancel', endDraw);
canvas.addEventListener('pointerleave', endDraw);

function clearSig(){
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  hasSig = false;
  savedImage = null;
  sigLen = 0; lastPt = null;
  canvas.classList.remove('has-sig');
}

// Ekspor tanda tangan ke ukuran tetap (lebar 600px) supaya ukuran data kecil & konsisten di semua perangkat
function exportSignature(){
  const rect = canvas.getBoundingClientRect();
  const W = 600;
  const H = Math.max(1, Math.round(W * rect.height / Math.max(rect.width, 1)));
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const c = off.getContext('2d');
  c.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, W, H);
  return off.toDataURL('image/png');
}

/* ---------- Submit ---------- */
document.getElementById('koordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('formMsg');
  const btn = document.getElementById('submitBtn');
  msg.className = 'msg'; msg.style.display = 'none';

  const nama = document.getElementById('f_nama').value.trim();
  const namaPerumahan = document.getElementById('f_nama_perumahan').value.trim();
  const kesimpulanEl = document.querySelector('input[name=kesimpulan]:checked');

  const showErr = (t) => { msg.textContent = t; msg.className = 'msg err'; msg.style.display = 'block'; };

  if(!nama || !namaPerumahan) return showErr('Nama petugas dan Nama Perumahan wajib diisi.');
  if(!kesimpulanEl) return showErr('Pilih salah satu rekomendasi tindak lanjut.');
  if(!hasSig || sigLen < 40) return showErr('Tanda tangan belum diisi atau terlalu pendek.');
  if(!sb) return showErr('Koneksi database belum siap. Refresh halaman lalu coba lagi.');
  if(document.getElementById('kt_hp_9x').value){ // honeypot: bot
    msg.textContent = 'Laporan koordinasi berhasil dikirim. Terima kasih.'; msg.className = 'msg ok'; msg.style.display = 'block';
    return;
  }
  if(!/^[0-9 ]{0,30}$/.test(document.getElementById('f_nip').value.trim())) return showErr('NIP hanya boleh berisi angka.');
  let lastSend = 0;
  try{ lastSend = Number(sessionStorage.getItem('korumtap_last_submit') || 0); }catch(_){}
  if(Date.now() - lastSend < 30000) return showErr('Tunggu beberapa detik sebelum mengirim lagi.');

  const payload = {
    nama,
    jabatan: document.getElementById('f_jabatan').value.trim(),
    nip: document.getElementById('f_nip').value.trim(),
    unit_kerja: document.getElementById('f_unit_kerja').value.trim(),
    nama_perumahan: namaPerumahan,
    alamat: document.getElementById('f_alamat').value.trim(),
    status_pengembang: document.getElementById('f_status_pengembang').value.trim(),
    perwakilan_warga: document.getElementById('f_perwakilan').value.trim(),
    kontak_perwakilan: document.getElementById('f_kontak').value.trim(),
    luas_lahan: document.getElementById('f_luas_lahan').value.trim(),
    jumlah_unit: document.getElementById('f_jumlah_unit').value.trim(),
    tanggal_koordinasi: document.getElementById('f_tanggal').value || null,
    pihak_hadir: document.getElementById('f_pihak_hadir').value.trim(),
    kondisi_psu: collectPsu(),
    permasalahan: document.getElementById('f_permasalahan').value.trim(),
    hasil_koordinasi: document.getElementById('f_hasil').value.trim(),
    kesimpulan: kesimpulanEl.value,
    tindak_lanjut: document.getElementById('f_tindak_lanjut').value.trim(),
    signature_data: exportSignature()
  };

  btn.disabled = true; btn.textContent = 'Mengirim...';
  const { error } = await sb.from('korumtap_laporan').insert(payload);
  btn.disabled = false; btn.textContent = 'Kirim Laporan Koordinasi';

  if(error){
    console.error(error);
    // Pesan dari validasi server (trigger) diawali "KORUMTAP:"; selain itu tampilkan pesan umum.
    const m = /^KORUMTAP:\s*(.+)$/.exec(error.message || '');
    showErr(m ? m[1] : 'Gagal mengirim laporan. Periksa isian lalu coba lagi.');
  } else {
    try{ sessionStorage.setItem('korumtap_last_submit', String(Date.now())); }catch(_){}
    msg.textContent = 'Laporan koordinasi berhasil dikirim. Terima kasih.';
    msg.className = 'msg ok'; msg.style.display = 'block';
    document.getElementById('koordForm').reset();
    document.getElementById('timSelect').value = '';
    document.querySelectorAll('.kesimpulan-opt').forEach(o => o.classList.remove('checked'));
    document.getElementById('f_tanggal').value = todayISO();
    clearSig();
    refreshFieldColors(document.getElementById('koordForm'));
    loadConfig();
  }
});

/* ---------- Admin ---------- */
let adminOk = false;
let lastRekapData = [];
let rekapTotal = 0;
const REKAP_PAGE = 20;
let loginFails = 0, loginLockUntil = 0;
const IDLE_MS = 15 * 60 * 1000;
let idleTimer = null;
function resetIdle(){
  if(!adminOk) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    await logoutAdmin();
    const a = document.getElementById('adminMsg');
    a.textContent = 'Sesi admin berakhir karena tidak ada aktivitas. Silakan masuk lagi.';
    a.className = 'msg err'; a.style.display = 'block';
  }, IDLE_MS);
}
['pointerdown','keydown','touchstart'].forEach(ev => document.addEventListener(ev, resetIdle, { passive: true }));

function showAdminContent(){
  adminOk = true;
  resetIdle();
  document.getElementById('adminGate').style.display = 'none';
  document.getElementById('adminContent').style.display = 'block';
  loadPerumahanList();
  loadPetugas();
  loadRekap();
}

async function isAdminUser(){
  if(!sb) return false;
  const { data: { session } } = await sb.auth.getSession();
  if(!session) return false;
  const { data, error } = await sb.rpc('korumtap_is_admin');
  return !error && data === true;
}

async function checkAdmin(){
  const amsg = document.getElementById('adminMsg');
  const btn = document.querySelector('#adminGate button');
  const fail = (t) => { amsg.textContent = t; amsg.className = 'msg err'; amsg.style.display = 'block'; };
  const pass = document.getElementById('adminPass').value;
  if(!sb) return fail('Koneksi database belum siap. Refresh halaman lalu coba lagi.');
  if(!ADMIN_EMAIL || ADMIN_EMAIL === 'admin@contoh.go.id') return fail('ADMIN_EMAIL di dalam file HTML belum diganti dengan email akun admin Supabase.');
  if(!pass) return fail('Password wajib diisi.');
  const wait = Math.ceil((loginLockUntil - Date.now()) / 1000);
  if(wait > 0) return fail(`Terlalu banyak percobaan gagal. Tunggu ${wait} detik.`);
  btn.disabled = true;
  try{
    const { error } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: pass });
    document.getElementById('adminPass').value = '';
    if(error){
      console.error('Login error:', error);
      if(++loginFails >= 5){ loginLockUntil = Date.now() + 60000; loginFails = 0; }
      const code = error.code || '';
      if(code === 'invalid_credentials' || /invalid login/i.test(error.message)) return fail('Password salah, atau email di ADMIN_EMAIL tidak cocok dengan akun di Supabase.');
      if(code === 'email_not_confirmed' || /not confirmed/i.test(error.message)) return fail('Akun belum dikonfirmasi. Di Supabase: Authentication > Users > klik akun > Confirm user.');
      if(error.status === 429) return fail('Terlalu banyak percobaan. Tunggu beberapa menit.');
      return fail('Login gagal: ' + error.message);
    }
    const { data: { session } } = await sb.auth.getSession();
    if(!session) return fail('Sesi login tidak terbentuk. Coba lagi.');
    const { data, error: rpcErr } = await sb.rpc('korumtap_is_admin');
    if(rpcErr){
      console.error('RPC error:', rpcErr);
      await sb.auth.signOut();
      return fail('Fungsi korumtap_is_admin belum ada. Jalankan security.sql di Supabase SQL Editor.');
    }
    if(data !== true){
      await sb.auth.signOut();
      return fail('Login berhasil, tetapi akun ini belum didaftarkan sebagai admin. Jalankan perintah INSERT ke korumtap_admins (lihat petunjuk).');
    }
    loginFails = 0;
    amsg.style.display = 'none';
    showAdminContent();
  } finally {
    btn.disabled = false;
  }
}

async function logoutAdmin(){
  adminOk = false;
  clearTimeout(idleTimer);
  PERUMAHAN_LIST = [];
  lastRekapData = [];
  if(sb) await sb.auth.signOut();
  document.getElementById('rekapList').innerHTML = '';
  document.getElementById('adminPass').value = '';
  document.getElementById('adminMsg').style.display = 'none';
  document.getElementById('adminContent').style.display = 'none';
  document.getElementById('adminGate').style.display = 'block';
}

(async function restoreAdminSession(){
  if(await isAdminUser()) showAdminContent();
})();
if(sb) sb.auth.onAuthStateChange((ev) => { if(ev === 'SIGNED_OUT' && adminOk) logoutAdmin(); });

function safeSig(s){
  return (typeof s === 'string' && s.length < 400000 && /^data:image\/png;base64,[A-Za-z0-9+\/]+=*$/.test(s)) ? s : '';
}

function escapeHtml(str){
  if(!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function tanggalKoordinasiText(row){
  const d = row.tanggal_koordinasi ? new Date(row.tanggal_koordinasi + 'T00:00:00') : new Date(row.created_at);
  return d.toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
}

async function loadRekap(append){
  const list = document.getElementById('rekapList');
  const count = document.getElementById('rekapCount');
  if(append !== true){
    lastRekapData = [];
    rekapTotal = 0;
    list.innerHTML = '<div class="empty">Memuat...</div>';
  }

  if(!sb){
    list.innerHTML = '<div class="empty">Koneksi database belum siap. Refresh halaman lalu coba lagi.</div>';
    return;
  }

  const from = lastRekapData.length;
  const { data, error, count: total } = await sb.from('korumtap_laporan')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + REKAP_PAGE - 1);

  if(error){
    if(append === true){ alert('Gagal memuat data: ' + error.message); return; }
    list.innerHTML = `<div class="empty">Gagal memuat data: ${escapeHtml(error.message)}</div>`;
    return;
  }

  const seen = new Set(lastRekapData.map(r => String(r.id)));
  lastRekapData = lastRekapData.concat((data || []).filter(r => !seen.has(String(r.id))));
  rekapTotal = typeof total === 'number' ? total : lastRekapData.length;
  renderRekap();
}

function renderRekap(){
  const list = document.getElementById('rekapList');
  const count = document.getElementById('rekapCount');
  count.textContent = `${lastRekapData.length} dari ${rekapTotal} laporan ditampilkan`;

  if(lastRekapData.length === 0){
    list.innerHTML = '<div class="empty">Belum ada data masuk.</div>';
    return;
  }

  const items = lastRekapData.map((row, idx) => {
    const cls = KESIMPULAN_CLASS[row.kesimpulan] || 'syarat';
    const psu = Array.isArray(row.kondisi_psu) ? row.kondisi_psu : [];
    return `
      <div class="rekap-item status-${cls}">
        <div class="top">
          <div>
            <strong>${escapeHtml(row.nama_perumahan)}</strong><br>
            <small>Koordinasi: ${escapeHtml(tanggalKoordinasiText(row))}</small>
          </div>
          <span class="badge ${cls}">${escapeHtml(row.kesimpulan)}</span>
        </div>
        <div class="rekap-meta"><b>${escapeHtml(row.nama)}</b>${row.jabatan ? ' — ' + escapeHtml(row.jabatan) : ''}${row.nip ? ' — NIP ' + escapeHtml(row.nip) : ''}</div>
        ${row.unit_kerja ? `<div class="rekap-meta">${escapeHtml(row.unit_kerja)}</div>` : ''}
        ${row.alamat ? `<div class="rekap-meta">Alamat: ${escapeHtml(row.alamat)}</div>` : ''}
        ${row.status_pengembang ? `<div class="rekap-meta">Status pengembang: ${escapeHtml(row.status_pengembang)}</div>` : ''}
        ${row.perwakilan_warga ? `<div class="rekap-meta">Perwakilan warga: ${escapeHtml(row.perwakilan_warga)}${row.kontak_perwakilan ? ' (' + escapeHtml(row.kontak_perwakilan) + ')' : ''}</div>` : ''}
        ${row.pihak_hadir ? `<div class="rekap-meta">Hadir: ${escapeHtml(row.pihak_hadir)}</div>` : ''}
        ${psu.length ? `<div class="rekap-psu">${psu.map(p => `<div><b>${escapeHtml(p.item)}</b>: ${escapeHtml(p.kondisi || '-')}${p.keterangan ? ' (' + escapeHtml(p.keterangan) + ')' : ''}</div>`).join('')}</div>` : ''}
        ${row.permasalahan ? `<p class="rekap-uraian"><b>Permasalahan:</b> ${escapeHtml(row.permasalahan)}</p>` : ''}
        ${row.hasil_koordinasi ? `<p class="rekap-uraian"><b>Hasil koordinasi:</b> ${escapeHtml(row.hasil_koordinasi)}</p>` : ''}
        ${row.tindak_lanjut ? `<div class="rekap-meta">Tindak lanjut: ${escapeHtml(row.tindak_lanjut)}</div>` : ''}
        ${safeSig(row.signature_data) ? `<img src="${safeSig(row.signature_data)}" alt="tanda tangan">` : ''}
        <div class="rekap-actions">
          <button class="word-btn" data-act="export-word" data-idx="${idx}">Export Word</button>
          <button class="del-btn" data-act="del-row" data-idx="${idx}">Hapus</button>
        </div>
      </div>
    `;
  }).join('');
  const more = lastRekapData.length < rekapTotal
    ? '<div style="text-align:center;margin:14px 0;"><button type="button" data-act="more-rekap">Muat lebih banyak</button></div>'
    : '';
  list.innerHTML = items + more;
}

async function deleteRow(idx, btn){
  const row = lastRekapData[idx];
  if(!row) return;

  const ok = confirm(`Hapus laporan koordinasi "${row.nama_perumahan}" dari ${row.nama}? Tindakan ini tidak bisa dibatalkan.`);
  if(!ok) return;

  if(!sb){
    alert('Koneksi database belum siap. Refresh halaman lalu coba lagi.');
    return;
  }

  if(btn){ btn.disabled = true; btn.textContent = 'Menghapus...'; }

  const { data: gone, error } = await sb.from('korumtap_laporan').delete().eq('id', row.id).select('id');

  if(error || !gone || gone.length === 0){
    console.error(error);
    alert('Gagal menghapus: ' + (error ? error.message : 'tidak ada baris yang terhapus (cek hak akses admin).'));
    if(btn){ btn.disabled = false; btn.textContent = 'Hapus'; }
    return;
  }
  loadRekap();
}

function pngSize(bytes){
  // IHDR PNG: lebar di byte 16-19, tinggi di byte 20-23
  if(bytes.length < 24) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = dv.getUint32(16), h = dv.getUint32(20);
  return (w > 0 && h > 0) ? { w, h } : null;
}

// ---- Library docx dimuat hanya saat dibutuhkan (hemat ~0,7 MB di tiap kunjungan form) ----
const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js';
const DOCX_SRI = ''; // isi dengan 'sha384-...' (lihat README.md, bagian SRI)
let docxPromise = null;
function loadDocx(){
  if(window.docx) return Promise.resolve(window.docx);
  if(docxPromise) return docxPromise;
  docxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = DOCX_URL;
    s.crossOrigin = 'anonymous';
    if(DOCX_SRI) s.integrity = DOCX_SRI;
    s.onload = () => window.docx ? resolve(window.docx) : reject(new Error('Library Word tidak valid.'));
    s.onerror = () => { docxPromise = null; reject(new Error('Library pembuat Word gagal dimuat. Cek koneksi internet lalu coba lagi.')); };
    document.head.appendChild(s);
  });
  return docxPromise;
}

function dataUrlToUint8Array(dataUrl){
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ---------- Export Word: Berita Acara Koordinasi ---------- */
async function exportWordRow(idx, btn){
  const row = lastRekapData[idx];
  if(!row) return;

  const originalLabel = btn ? btn.textContent : null;
  if(btn){ btn.disabled = true; btn.textContent = 'Membuat...'; }

  try{
    await loadDocx();
    const {
      Document, Packer, Paragraph, TextRun, AlignmentType, UnderlineType,
      ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle
    } = window.docx;

    const FONT = 'Times New Roman';
    const SIZE = 24;       // 12pt
    const TITLE_SIZE = 26; // 13pt
    const TEXT_W = 8788;   // lebar area teks A4 dengan margin di bawah

    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };
    const thin = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
    const cellBorders = { top: thin, bottom: thin, left: thin, right: thin };

    const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: SIZE, ...opts });

    function fieldTable(rows){
      return new Table({
        width: { size: TEXT_W, type: WidthType.DXA },
        columnWidths: [2400, TEXT_W - 2400],
        borders: noBorders,
        rows: rows.map(([lbl, val]) => new TableRow({
          children: [
            new TableCell({
              width: { size: 2400, type: WidthType.DXA },
              margins: { top: 40, bottom: 40, left: 0, right: 0 },
              children: [ new Paragraph({ children: [ run(lbl, { bold: true }) ] }) ]
            }),
            new TableCell({
              width: { size: TEXT_W - 2400, type: WidthType.DXA },
              margins: { top: 40, bottom: 40, left: 0, right: 0 },
              children: [ new Paragraph({ children: [ run(': '), run(val || '-') ] }) ]
            })
          ]
        }))
      });
    }

    function psuTable(items){
      const widths = [560, 2700, 1700, TEXT_W - 560 - 2700 - 1700];
      const cell = (text, w, bold, center) => new TableCell({
        width: { size: w, type: WidthType.DXA },
        borders: cellBorders,
        margins: { top: 50, bottom: 50, left: 90, right: 90 },
        children: [ new Paragraph({
          alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [ run(text || '-', { bold: !!bold, size: 22 }) ]
        }) ]
      });
      const head = new TableRow({
        tableHeader: true,
        children: [
          cell('No', widths[0], true, true),
          cell('Komponen PSU', widths[1], true),
          cell('Kondisi', widths[2], true),
          cell('Keterangan', widths[3], true)
        ]
      });
      const body = items.map((p, i) => new TableRow({
        children: [
          cell(String(i + 1), widths[0], false, true),
          cell(p.item, widths[1]),
          cell(p.kondisi, widths[2]),
          cell(p.keterangan, widths[3])
        ]
      }));
      return new Table({ width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: widths, rows: [head, ...body] });
    }

    const sectionHeading = (text) => new Paragraph({
      spacing: { before: 260, after: 160 },
      children: [ run(text, { bold: true, underline: { type: UnderlineType.SINGLE } }) ]
    });
    const bodyPara = (text) => new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 120 },
      children: [ run(text || '-') ]
    });

    // ---- helper tanggal Indonesia ----
    function terbilangID(num){
      const satuan = ['', 'Satu','Dua','Tiga','Empat','Lima','Enam','Tujuh','Delapan','Sembilan','Sepuluh','Sebelas'];
      function convert(n){
        if(n < 12) return satuan[n];
        if(n < 20) return convert(n - 10) + ' Belas';
        if(n < 100) return satuan[Math.floor(n/10)] + ' Puluh' + (n % 10 ? ' ' + convert(n % 10) : '');
        if(n < 200) return 'Seratus' + (n % 100 ? ' ' + convert(n % 100) : '');
        if(n < 1000) return satuan[Math.floor(n/100)] + ' Ratus' + (n % 100 ? ' ' + convert(n % 100) : '');
        if(n < 2000) return 'Seribu' + (n % 1000 ? ' ' + convert(n % 1000) : '');
        if(n < 1000000) return convert(Math.floor(n/1000)) + ' Ribu' + (n % 1000 ? ' ' + convert(n % 1000) : '');
        return String(n);
      }
      return convert(num);
    }
    const HARI_ID = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const pad2 = (n) => String(n).padStart(2, '0');
    function kalimatTanggalID(date){
      const tgl = date.getDate(), b = date.getMonth(), th = date.getFullYear();
      return `Pada hari ini ${HARI_ID[date.getDay()]} Tanggal ${terbilangID(tgl)} Bulan ${BULAN_ID[b]} Tahun ${terbilangID(th)} (${pad2(tgl)}-${pad2(b+1)}-${th}) telah dilaksanakan koordinasi penanganan perumahan yang tidak memiliki pengembang dengan hasil sebagai berikut :`;
    }
    const tanggalPanjangID = (d) => `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;

    const tanggalDoc = row.tanggal_koordinasi
      ? new Date(row.tanggal_koordinasi + 'T00:00:00')
      : (row.created_at ? new Date(row.created_at) : new Date());

    const children = [];

    // ---- judul ----
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 20 },
      children: [ run('BERITA ACARA KOORDINASI', { bold: true, size: TITLE_SIZE }) ]
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 240 },
      children: [ run('PENANGANAN PERUMAHAN TANPA PENGEMBANG', { bold: true, size: TITLE_SIZE }) ]
    }));

    children.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED, spacing: { after: 220 },
      children: [ run(kalimatTanggalID(tanggalDoc)) ]
    }));

    // ---- data umum ----
    children.push(sectionHeading('DATA UMUM'));
    children.push(fieldTable([
      ['Nama Perumahan', row.nama_perumahan],
      ['Lokasi', row.alamat],
      ['Status Pengembang', row.status_pengembang],
      ['Perwakilan Warga', row.perwakilan_warga ? row.perwakilan_warga + (row.kontak_perwakilan ? ' (' + row.kontak_perwakilan + ')' : '') : ''],
      ['Luas Lahan', row.luas_lahan],
      ['Jumlah Unit/Kavling', row.jumlah_unit],
      ['Pihak yang Hadir', row.pihak_hadir]
    ]));

    // ---- kondisi PSU ----
    const psu = Array.isArray(row.kondisi_psu) ? row.kondisi_psu : [];
    children.push(sectionHeading('KONDISI PRASARANA, SARANA, DAN UTILITAS (PSU)'));
    if(psu.length){
      children.push(psuTable(psu));
    } else {
      children.push(bodyPara('-'));
    }

    // ---- permasalahan & hasil ----
    children.push(sectionHeading('PERMASALAHAN'));
    children.push(bodyPara(row.permasalahan));
    children.push(sectionHeading('HASIL KOORDINASI'));
    children.push(bodyPara(row.hasil_koordinasi));

    // ---- rekomendasi ----
    children.push(new Paragraph({
      spacing: { before: 160, after: 100 },
      children: [ run('REKOMENDASI TINDAK LANJUT :') ]
    }));
    const opsi = [
      ['Ditindaklanjuti Pemerintah Daerah', 'Dapat ditindaklanjuti oleh Pemerintah Daerah'],
      ['Perlu Koordinasi Lanjutan', 'Perlu koordinasi lanjutan dengan pihak terkait'],
      ['Dikelola Swadaya Warga', 'Dikelola swadaya oleh warga, dengan pembinaan']
    ];
    opsi.forEach(([val, label], i) => {
      const dipilih = row.kesimpulan === val;
      children.push(new Paragraph({
        indent: { left: 360, hanging: 260 },
        spacing: { after: 100 },
        tabStops: [{ type: 'left', position: 360 }],
        children: [
          run(`${i+1}.\t`),
          run((dipilih ? '\u2611 ' : '\u2610 ') + label, { bold: dipilih })
        ]
      }));
    });
    if(row.tindak_lanjut){
      children.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        indent: { left: 360 },
        spacing: { before: 60, after: 100 },
        children: [ run('Rincian: ' + row.tindak_lanjut) ]
      }));
    }

    // ---- kesimpulan otomatis ----
    children.push(sectionHeading('KESIMPULAN'));
    const frasa = {
      'Ditindaklanjuti Pemerintah Daerah': 'direkomendasikan untuk ditindaklanjuti oleh Pemerintah Daerah sesuai kewenangannya',
      'Perlu Koordinasi Lanjutan': 'memerlukan koordinasi lanjutan dengan pihak terkait',
      'Dikelola Swadaya Warga': 'dikelola secara swadaya oleh warga dengan pembinaan dari Pemerintah Daerah'
    }[row.kesimpulan] || 'masih dalam proses koordinasi';
    children.push(bodyPara(`Berdasarkan hasil koordinasi, penanganan Perumahan ${row.nama_perumahan || '-'} yang tidak memiliki pengembang ${frasa}.`));

    // ---- tanda tangan ----
    children.push(new Paragraph({ spacing: { before: 420 }, children: [] }));
    children.push(new Paragraph({ indent: { left: 5040 }, children: [ run(`Ngawi, ${tanggalPanjangID(tanggalDoc)}`) ] }));
    children.push(new Paragraph({ indent: { left: 5040 }, spacing: { after: 120 }, children: [ run('Yang Membuat,') ] }));

    if(safeSig(row.signature_data)){
      try{
        const sigBytes = dataUrlToUint8Array(row.signature_data);
        const dim = pngSize(sigBytes);
        const sigW = 170, sigH = dim ? Math.min(110, Math.max(30, Math.round(sigW * dim.h / dim.w))) : 80;
        children.push(new Paragraph({
          indent: { left: 5040 }, spacing: { after: 60 },
          children: [ new ImageRun({ data: sigBytes, type: 'png', transformation: { width: sigW, height: sigH } }) ]
        }));
      }catch(imgErr){
        console.error('Gagal menyisipkan gambar tanda tangan:', imgErr);
        children.push(new Paragraph({ indent: { left: 5040 }, spacing: { before: 400, after: 60 }, children: [] }));
      }
    } else {
      children.push(new Paragraph({ indent: { left: 5040 }, spacing: { before: 400, after: 60 }, children: [] }));
    }

    children.push(new Paragraph({
      indent: { left: 5040 },
      children: [ run(`(${row.nama || 'NAMA'})`, { bold: true, underline: { type: UnderlineType.SINGLE } }) ]
    }));
    if(row.jabatan) children.push(new Paragraph({ indent: { left: 5040 }, children: [ run(row.jabatan) ] }));
    if(row.nip) children.push(new Paragraph({ indent: { left: 5040 }, children: [ run(`NIP. ${row.nip}`) ] }));

    const doc = new Document({
      styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1417, bottom: 1417, left: 1701, right: 1417 }
          }
        },
        children
      }]
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safePerumahan = (row.nama_perumahan || 'koordinasi').replace(/[^a-z0-9]+/gi, '_');
    const safeNama = (row.nama || 'petugas').replace(/[^a-z0-9]+/gi, '_');
    a.download = `BA_Koordinasi_${safePerumahan}_${safeNama}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(err){
    console.error(err);
    alert('Gagal membuat file Word: ' + err.message);
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = originalLabel; }
  }
}

/* ---------- Export CSV ---------- */
function csvEscape(val){
  if(val === null || val === undefined) return '';
  let t = String(val);
  if(/^[=+\-@\t\r]/.test(t)) t = "'" + t; // cegah CSV/formula injection
  return `"${t.replace(/"/g, '""')}"`;
}

const CSV_COLS = 'id,tanggal_koordinasi,nama_perumahan,alamat,status_pengembang,perwakilan_warga,kontak_perwakilan,luas_lahan,jumlah_unit,pihak_hadir,nama,jabatan,nip,unit_kerja,kondisi_psu,permasalahan,hasil_koordinasi,kesimpulan,tindak_lanjut,created_at';

async function exportCsv(btn){
  if(!sb) return;
  const label = btn ? btn.textContent : null;
  if(btn){ btn.disabled = true; btn.textContent = 'Menyiapkan...'; }
  let all = [];
  try{
    const STEP = 500;
    for(let from = 0; ; from += STEP){
      const { data, error } = await sb.from('korumtap_laporan').select(CSV_COLS)
        .order('created_at', { ascending: false }).range(from, from + STEP - 1);
      if(error) throw error;
      all = all.concat(data || []);
      if(!data || data.length < STEP) break;
    }
  }catch(err){
    console.error(err);
    alert('Gagal mengambil data untuk CSV: ' + (err.message || err));
    return;
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = label; }
  }
  if(all.length === 0){
    alert('Belum ada data untuk di-export.');
    return;
  }
  const headers = ['Tanggal Koordinasi','Nama Perumahan','Alamat','Status Pengembang','Perwakilan Warga','Kontak Perwakilan','Luas Lahan','Jumlah Unit','Pihak Hadir','Nama Petugas','Jabatan','NIP','Unit Kerja','Kondisi PSU','Permasalahan','Hasil Koordinasi','Rekomendasi','Rincian Tindak Lanjut','Dikirim Pada'];
  const rows = all.map(row => [
    row.tanggal_koordinasi || '',
    row.nama_perumahan,
    row.alamat,
    row.status_pengembang,
    row.perwakilan_warga,
    row.kontak_perwakilan,
    row.luas_lahan,
    row.jumlah_unit,
    row.pihak_hadir,
    row.nama,
    row.jabatan,
    row.nip,
    row.unit_kerja,
    (Array.isArray(row.kondisi_psu) ? row.kondisi_psu : []).map(p => `${p.item}: ${p.kondisi || '-'}${p.keterangan ? ' (' + p.keterangan + ')' : ''}`).join(' | '),
    row.permasalahan,
    row.hasil_koordinasi,
    row.kesimpulan,
    row.tindak_lanjut,
    new Date(row.created_at).toLocaleString('id-ID')
  ]);
  const csv = [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rekap-korumtap-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- Delegasi event (pengganti onclick inline berisi data) ---------- */
const ACTIONS = {
  'tab-form': () => switchTab('form'),
  'tab-admin': () => switchTab('admin'),
  'clear-sig': () => clearSig(),
  'admin-login': () => checkAdmin(),
  'admin-logout': () => logoutAdmin(),
  'save-petugas': () => savePetugas(),
  'cancel-petugas': () => cancelEditPetugas(),
  'save-perumahan': () => savePerumahan(),
  'cancel-perumahan': () => cancelEditPerumahan(),
  'export-csv': (b) => exportCsv(b),
  'refresh-rekap': () => loadRekap(),
  'more-rekap': () => loadRekap(true),
  'export-word': (b) => exportWordRow(Number(b.dataset.idx), b),
  'del-row': (b) => deleteRow(Number(b.dataset.idx), b)
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if(!b) return;
  if(ACTIONS[b.dataset.act]){ ACTIONS[b.dataset.act](b); return; }
  const id = b.dataset.id;
  if(b.dataset.act === 'edit-petugas') editPetugas(id);
  else if(b.dataset.act === 'del-petugas'){ const t = PETUGAS_LIST.find(x => String(x.id) === id); deletePetugas(id, t ? t.nama : ''); }
  else if(b.dataset.act === 'edit-perumahan') editPerumahan(id);
  else if(b.dataset.act === 'del-perumahan'){ const p = PERUMAHAN_LIST.find(x => String(x.id) === id); deletePerumahan(id, p ? p.nama_perumahan : ''); }
});
document.addEventListener('change', (e) => {
  const c = e.target.closest('[data-act="toggle-perumahan"]');
  if(c) toggleActivePerumahan(c.dataset.id, c.checked);
});
document.getElementById('timSelect').addEventListener('change', applyTimSelection);
document.getElementById('f_perumahan_select').addEventListener('change', applyPerumahanSelection);
document.getElementById('adminPass').addEventListener('keydown', (e) => { if(e.key === 'Enter') checkAdmin(); });

/* ---------- Batas panjang input ---------- */
const MAXLEN = { f_nama:150, f_jabatan:150, f_nip:30, f_unit_kerja:150, f_pihak_hadir:500, f_permasalahan:3000, f_hasil:3000, f_tindak_lanjut:2000,
  pt_nama:150, pt_jabatan:150, pt_nip:30, pt_unit_kerja:150, ph_nama_perumahan:200, ph_alamat:500, ph_perwakilan:150, ph_kontak:30, ph_luas_lahan:50, ph_jumlah_unit:50 };
Object.entries(MAXLEN).forEach(([id, n]) => { const el = document.getElementById(id); if(el) el.maxLength = n; });

/* ---------- Inisialisasi ---------- */
buildPsuRows();
document.getElementById('f_tanggal').value = todayISO();
document.getElementById('f_tanggal').max = todayISO();
loadPetugas();
loadConfig();
