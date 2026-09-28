'use strict';

var smsContacts = (function () {
  var containerId = null;
  var contacts = [];
  var selectedIds = new Set();
  var lastError = '';

  // Derive API base the same way live-provider.js does
  function getApiBase() {
    if (typeof liveProvider !== 'undefined' && typeof liveProvider.getApiBase === 'function') {
      return liveProvider.getApiBase();
    }
    var port = '8080';
    if (typeof window !== 'undefined') {
      if (window.__TEST_BACKEND_PORT__) port = window.__TEST_BACKEND_PORT__;
      else if (window.__BACKEND_PORT__) port = window.__BACKEND_PORT__;
      else if (window.location && window.location.search) {
        var match = window.location.search.match(/[?&]backend_port=(\d+)/);
        if (match) port = match[1];
      }
    }
    var host = (typeof window !== 'undefined' && window.location && window.location.hostname) || 'localhost';
    return 'http://' + host + ':' + port;
  }

  function notifyTierConfig() {
    if (typeof tierConfig !== 'undefined' && typeof tierConfig.refresh === 'function') {
      tierConfig.refresh();
    }
  }

  function init(targetId) {
    containerId = targetId;
    fetchContacts();
  }

  // ── CRUD helpers ─────────────────────────────────────────────────────

  function fetchContacts() {
    return fetch(getApiBase() + '/api/sms-contacts')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (Array.isArray(data)) {
          contacts = data;
        }
        render();
      })
      .catch(function (err) {
        console.warn('[sms-contacts] Fetch failed:', err.message || err);
        lastError = 'Fetch failed: ' + (err.message || err);
        render();
      });
  }

  function addContact(name, phone) {
    lastError = '';
    return fetch(getApiBase() + '/api/sms-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, phone: phone })
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || 'Failed'); });
        return r.json();
      })
      .then(function () {
        return fetchContacts();
      })
      .then(function () {
        notifyTierConfig();
      });
  }

  function deleteContact(id) {
    lastError = '';
    return fetch(getApiBase() + '/api/sms-contacts/' + id, { method: 'DELETE' })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || 'Failed'); });
        return r.json();
      })
      .then(function () {
        selectedIds.delete(id);
        return fetchContacts();
      })
      .then(function () {
        notifyTierConfig();
      })
      .catch(function (err) {
        lastError = 'Delete failed: ' + (err.message || err);
        render();
      });
  }

  function toggleAutoAlert(id, currentValue) {
    lastError = '';
    return fetch(getApiBase() + '/api/sms-contacts/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_alert: !currentValue })
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || 'Failed'); });
        return r.json();
      })
      .then(function () {
        return fetchContacts();
      })
      .then(function () {
        notifyTierConfig();
      })
      .catch(function (err) {
        lastError = 'Toggle failed: ' + (err.message || err);
        render();
      });
  }

  function sendManual(ids, message) {
    return fetch(getApiBase() + '/api/sms-contacts/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: ids, message: message })
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
          return data;
        });
      });
  }

  // ── Render ───────────────────────────────────────────────────────────

  function render() {
    var container = document.getElementById(containerId);
    if (!container) return;

    // Preserve any user-typed input before re-rendering
    var prevNameEl = container.querySelector('#sms-add-name');
    var prevPhoneEl = container.querySelector('#sms-add-phone');
    var prevMsgEl = container.querySelector('#sms-manual-msg');
    var prevName = prevNameEl ? prevNameEl.value : '';
    var prevPhone = prevPhoneEl ? prevPhoneEl.value : '';
    var prevMsg = prevMsgEl ? prevMsgEl.value : '';

    var html = '';

    // Error banner if any operation failed
    if (lastError) {
      html +=
        '<div id="sms-error-banner" style="font-size:11px; color:var(--status-critical); margin-bottom:6px; background:rgba(255,34,34,0.1); padding:4px 8px; border:1px solid var(--status-critical);">' +
          '⚠ ' + escHtml(lastError) +
        '</div>';
    }

    // Add-contact form
    html +=
      '<div class="sms-add-form" style="display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap;">' +
        '<input type="text" id="sms-add-name" placeholder="Name" ' +
          'style="flex:1; min-width:90px; padding:4px 8px; background:var(--bg-inset); border:1px solid var(--border-rule); color:var(--text-primary); font-family:inherit; font-size:11px;">' +
        '<input type="text" id="sms-add-phone" placeholder="+919812345678" ' +
          'style="flex:1; min-width:120px; padding:4px 8px; background:var(--bg-inset); border:1px solid var(--border-rule); color:var(--text-primary); font-family:\'Courier New\', Courier, monospace; font-size:11px;">' +
        '<button id="sms-add-btn" class="btn" ' +
          'style="padding:4px 12px; background:var(--status-active); color:#000; border:none; cursor:pointer; font-size:11px; font-weight:700;">+ ADD</button>' +
      '</div>';

    // Contact table or empty state
    if (contacts.length === 0) {
      html += '<div class="empty-state" style="height:auto; padding:12px;">NO SMS CONTACTS CONFIGURED</div>';
    } else {
      html +=
        '<table class="data-table">' +
          '<thead><tr>' +
            '<th style="width:28px;"></th>' +
            '<th>NAME</th>' +
            '<th>PHONE</th>' +
            '<th style="width:72px;">AUTO</th>' +
            '<th style="width:50px;"></th>' +
          '</tr></thead>' +
          '<tbody>';

      for (var i = 0; i < contacts.length; i++) {
        var c = contacts[i];
        var checked = selectedIds.has(c.contact_id) ? ' checked' : '';
        var autoClass = c.auto_alert ? 'connected' : 'disconnected';
        var autoText = c.auto_alert ? 'ON' : 'OFF';
        html +=
          '<tr>' +
            '<td><input type="checkbox" class="sms-select-cb" data-id="' + c.contact_id + '"' + checked + '></td>' +
            '<td>' + escHtml(c.name) + '</td>' +
            '<td class="mono">' + escHtml(c.phone) + '</td>' +
            '<td>' +
              '<span class="tier-status ' + autoClass + ' sms-auto-toggle" data-id="' + c.contact_id + '" data-val="' + c.auto_alert + '" style="cursor:pointer;" title="Click to toggle">' +
                autoText +
              '</span>' +
            '</td>' +
            '<td>' +
              '<span class="sms-delete-btn" data-id="' + c.contact_id + '" style="cursor:pointer; color:var(--alarm-level3); font-weight:700;" title="Delete contact">✕</span>' +
            '</td>' +
          '</tr>';
      }

      html += '</tbody></table>';
    }

    // Manual send area (rendered whenever panel is mounted)
    html +=
      '<div class="sms-manual-send" style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">' +
        '<input type="text" id="sms-manual-msg" placeholder="Manual message…" ' +
          'style="flex:1; min-width:120px; padding:4px 8px; background:var(--bg-inset); border:1px solid var(--border-rule); color:var(--text-primary); font-family:inherit; font-size:11px;">' +
        '<button id="sms-send-btn" class="btn" ' +
          'style="padding:4px 12px; background:var(--alarm-level1); color:#000; border:none; cursor:pointer; font-size:11px; font-weight:700;">SEND SMS</button>' +
      '</div>' +
      '<div id="sms-send-status" style="font-size:10px; color:var(--text-secondary); margin-top:4px;"></div>';

    container.innerHTML = html;

    // Restore preserved inputs
    var newNameEl = container.querySelector('#sms-add-name');
    var newPhoneEl = container.querySelector('#sms-add-phone');
    var newMsgEl = container.querySelector('#sms-manual-msg');
    if (newNameEl && prevName) newNameEl.value = prevName;
    if (newPhoneEl && prevPhone) newPhoneEl.value = prevPhone;
    if (newMsgEl && prevMsg) newMsgEl.value = prevMsg;

    bindEvents(container);
  }

  // ── Event binding ────────────────────────────────────────────────────

  function bindEvents(container) {
    // Add button
    var addBtn = container.querySelector('#sms-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var nameEl = container.querySelector('#sms-add-name');
        var phoneEl = container.querySelector('#sms-add-phone');
        var name = (nameEl.value || '').trim();
        var phone = (phoneEl.value || '').trim();
        if (!name || !phone) return;
        addBtn.disabled = true;
        addBtn.textContent = '…';
        addContact(name, phone)
          .then(function () {
            if (nameEl) nameEl.value = '';
            if (phoneEl) phoneEl.value = '';
          })
          .catch(function (err) {
            lastError = 'Failed to add contact: ' + (err.message || err);
            render();
          })
          .finally(function () {
            addBtn.disabled = false;
            addBtn.textContent = '+ ADD';
          });
      });
    }

    // Checkboxes
    var cbs = container.querySelectorAll('.sms-select-cb');
    for (var i = 0; i < cbs.length; i++) {
      cbs[i].addEventListener('change', function () {
        var id = parseInt(this.getAttribute('data-id'), 10);
        if (this.checked) selectedIds.add(id);
        else selectedIds.delete(id);
      });
    }

    // Auto-alert toggles
    var toggles = container.querySelectorAll('.sms-auto-toggle');
    for (var j = 0; j < toggles.length; j++) {
      toggles[j].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-id'), 10);
        var current = this.getAttribute('data-val') === 'true';
        toggleAutoAlert(id, current);
      });
    }

    // Delete buttons
    var delBtns = container.querySelectorAll('.sms-delete-btn');
    for (var k = 0; k < delBtns.length; k++) {
      delBtns[k].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-id'), 10);
        if (confirm('Delete this contact?')) {
          deleteContact(id);
        }
      });
    }

    // Send button
    var sendBtn = container.querySelector('#sms-send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        var msgEl = container.querySelector('#sms-manual-msg');
        var statusEl = container.querySelector('#sms-send-status');
        var msg = (msgEl ? msgEl.value : '').trim();
        var ids = Array.from(selectedIds);

        if (ids.length === 0) {
          if (statusEl) statusEl.textContent = '⚠ Select at least one contact';
          return;
        }
        if (!msg) {
          if (statusEl) statusEl.textContent = '⚠ Enter a message';
          return;
        }

        sendBtn.disabled = true;
        sendBtn.textContent = 'SENDING…';
        if (statusEl) statusEl.textContent = '';

        sendManual(ids, msg)
          .then(function (resp) {
            if (!resp || !resp.results) {
              if (statusEl) statusEl.textContent = '⚠ ' + (resp.error || 'Unknown error');
              return;
            }
            var summary = resp.results.map(function (r) {
              return (r.name || r.phone) + ': ' + r.outcome;
            }).join(' | ');
            if (statusEl) statusEl.textContent = summary;
            if (msgEl) msgEl.value = '';
            // NOTE: We do NOT re-emit 'dispatch-event' here.
            // The backend broadcasts 'sms_dispatch' via WebSocket,
            // which live-provider forwards to bus 'sms-dispatch'.
          })
          .catch(function (err) {
            if (statusEl) statusEl.textContent = '⚠ ' + (err.message || 'Send failed');
          })
          .finally(function () {
            sendBtn.disabled = false;
            sendBtn.textContent = 'SEND SMS';
          });
      });
    }
  }

  function escHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(s)));
    return div.innerHTML;
  }

  return { init: init, refresh: fetchContacts };
})();
