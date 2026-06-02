// ═══ CUSTOM POPUP SYSTEM ═══
// Thay thế browser alert() và confirm() bằng UI đẹp đồng nhất theme
(function() {
  function _cpEnsureOverlay() {
    const existing = document.getElementById('cpopupOverlay');
    if (existing) return existing;
    if (!document.body) return null;

    const ov = document.createElement('div');
    ov.id = 'cpopupOverlay';
    ov.className = 'cpopup-overlay';
    ov.innerHTML = `
      <div class="cpopup-card" id="cpopupCard">
        <div class="cpopup-icon" id="cpopupIcon"></div>
        <div class="cpopup-title" id="cpopupTitle"></div>
        <div class="cpopup-msg" id="cpopupMsg"></div>
        <div class="cpopup-btns" id="cpopupBtns"></div>
      </div>`;
    document.body.appendChild(ov);
    return ov;
  }

  // Tạo overlay container khi body đã sẵn sàng. Script này được load trong <head>.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _cpEnsureOverlay, { once: true });
  } else {
    _cpEnsureOverlay();
  }

  // Đóng popup — ẩn overlay
  function _cpClose() {
    const ov = document.getElementById('cpopupOverlay');
    if (ov) ov.classList.remove('active');
  }

  // ── customAlert(msg, options) ──
  // options: { title, icon, type: 'info'|'error'|'warn'|'success' }
  window.customAlert = function(msg, options = {}) {
    return new Promise(resolve => {
      const ov = _cpEnsureOverlay();
      if (!ov) {
        document.addEventListener('DOMContentLoaded', () => {
          window.customAlert(msg, options).then(resolve);
        }, { once: true });
        return;
      }
      const card = document.getElementById('cpopupCard');
      const iconEl = document.getElementById('cpopupIcon');
      const titleEl = document.getElementById('cpopupTitle');
      const msgEl = document.getElementById('cpopupMsg');
      const btnsEl = document.getElementById('cpopupBtns');

      // Reset class
      card.className = 'cpopup-card';
      const type = options.type || _guessType(msg);
      if (type === 'error') card.classList.add('cpopup-error');
      else if (type === 'warn') card.classList.add('cpopup-warn');

      // Icon mặc định tùy loại
      const icons = { info: '🔔', error: '❌', warn: '⚠️', success: '✅' };
      iconEl.textContent = options.icon || icons[type] || '🔔';

      // Tiêu đề
      const titles = { info: 'Thông Báo', error: 'Lỗi', warn: 'Cảnh Báo', success: 'Thành Công' };
      titleEl.textContent = options.title || titles[type] || 'Thông Báo';

      // Nội dung — tự strip emoji đầu nếu đã dùng làm icon
      msgEl.textContent = msg.replace(/^[❌✅⚠️🔔⛔🚫💡]\s*/, '');

      // Nút OK
      btnsEl.innerHTML = '<button class="cpopup-btn cpopup-btn-ok" id="cpopupOk">OK</button>';

      // Mở popup
      ov.classList.add('active');

      // Enter / Escape đều đóng
      let resolved = false;
      const doResolve = () => {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', handler, true);
        _cpClose();
        resolve();
      };
      const handler = (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          doResolve();
        }
      };
      document.addEventListener('keydown', handler, true);
      document.getElementById('cpopupOk').onclick = doResolve;
      document.getElementById('cpopupOk').focus();
    });
  };

  // ── customConfirm(msg, options) ──
  // options: { title, icon, type, okText, cancelText }
  window.customConfirm = function(msg, options = {}) {
    return new Promise(resolve => {
      const ov = _cpEnsureOverlay();
      if (!ov) {
        document.addEventListener('DOMContentLoaded', () => {
          window.customConfirm(msg, options).then(resolve);
        }, { once: true });
        return;
      }
      const card = document.getElementById('cpopupCard');
      const iconEl = document.getElementById('cpopupIcon');
      const titleEl = document.getElementById('cpopupTitle');
      const msgEl = document.getElementById('cpopupMsg');
      const btnsEl = document.getElementById('cpopupBtns');

      card.className = 'cpopup-card';
      const type = options.type || 'warn';
      if (type === 'error') card.classList.add('cpopup-error');
      else if (type === 'warn') card.classList.add('cpopup-warn');

      const icons = { info: '🔔', error: '❌', warn: '⚠️', success: '✅' };
      iconEl.textContent = options.icon || icons[type] || '⚠️';

      const titles = { info: 'Xác Nhận', error: 'Xác Nhận', warn: 'Xác Nhận', success: 'Xác Nhận' };
      titleEl.textContent = options.title || titles[type] || 'Xác Nhận';

      msgEl.textContent = msg.replace(/^[❌✅⚠️🔔⛔🚫💡]\s*/, '');

      btnsEl.innerHTML = `
        <button class="cpopup-btn cpopup-btn-ok" id="cpopupOk">${options.okText || 'OK'}</button>
        <button class="cpopup-btn cpopup-btn-cancel" id="cpopupCancel">${options.cancelText || 'Huỷ'}</button>`;

      let resolved = false;
      const doResolve = (val) => {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', handler, true);
        _cpClose();
        resolve(val);
      };

      document.getElementById('cpopupOk').onclick = () => doResolve(true);
      document.getElementById('cpopupCancel').onclick = () => doResolve(false);

      const handler = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); doResolve(true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); doResolve(false); }
      };
      document.addEventListener('keydown', handler, true);

      ov.classList.add('active');
      document.getElementById('cpopupOk').focus();
    });
  };

  // Đoán loại popup từ nội dung
  function _guessType(msg) {
    if (/❌|lỗi|error|thất bại|không thể|không được/i.test(msg)) return 'error';
    if (/⚠️|cảnh báo|warning/i.test(msg)) return 'warn';
    if (/✅|thành công|success|đã copy|đã lưu/i.test(msg)) return 'success';
    return 'info';
  }
})();
