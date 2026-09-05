'use strict';

var smsContacts = (function () {
  var containerId = null;

  var contacts = [
    { name: 'MINE FOREMAN', phone: '+91-98XXXXX321' },
    { name: 'SAFETY OFFICER', phone: '+91-97XXXXX842' }
  ];

  function init(targetId) {
    containerId = targetId;
    render();
  }

  function render() {
    var container = document.getElementById(containerId);
    if (!container) return;

    var html =
      '<table class="data-table">' +
        '<thead><tr>' +
          '<th>ROLE</th>' +
          '<th>PHONE</th>' +
        '</tr></thead>' +
        '<tbody>';

    for (var i = 0; i < contacts.length; i++) {
      html +=
        '<tr>' +
          '<td>' + contacts[i].name + '</td>' +
          '<td>' + contacts[i].phone + '</td>' +
        '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  return { init: init };
})();
