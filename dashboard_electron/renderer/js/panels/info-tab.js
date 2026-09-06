'use strict';

/**
 * Info Tab Interactive Controller
 * Manages smooth scrolling, section jump links, scroll-spy active state,
 * and quick-filter search across the engineering reference manual.
 */
var infoTab = (function () {
  var activeSectionId = null;
  var scrollContainer = null;
  var navLinks = [];
  var sections = [];
  var isScrollingFromClick = false;

  function init() {
    scrollContainer = document.getElementById('info-scroll-container');
    if (!scrollContainer) return;

    navLinks = Array.prototype.slice.call(document.querySelectorAll('.info-nav-link'));
    sections = Array.prototype.slice.call(document.querySelectorAll('.info-section-anchor'));

    // Jump link clicks
    navLinks.forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var targetId = this.getAttribute('data-target');
        var targetEl = document.getElementById(targetId);
        if (!targetEl || !scrollContainer) return;

        isScrollingFromClick = true;
        setActiveLink(targetId);

        var targetTop = targetEl.offsetTop - scrollContainer.offsetTop - 8;
        scrollContainer.scrollTo({
          top: targetTop,
          behavior: 'smooth'
        });

        setTimeout(function () {
          isScrollingFromClick = false;
        }, 600);
      });
    });

    // Scroll spy
    scrollContainer.addEventListener('scroll', onScroll, { passive: true });

    // Quick filter search
    var searchInput = document.getElementById('info-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var query = this.value.trim().toLowerCase();
        filterContent(query);
      });
    }
  }

  function onScroll() {
    if (isScrollingFromClick || !scrollContainer || sections.length === 0) return;

    var scrollTop = scrollContainer.scrollTop;
    var containerTop = scrollContainer.offsetTop;
    var currentId = sections[0].id;

    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      var secTop = sec.offsetTop - containerTop - 40;
      if (scrollTop >= secTop) {
        currentId = sec.id;
      } else {
        break;
      }
    }

    if (currentId !== activeSectionId) {
      setActiveLink(currentId);
    }
  }

  function setActiveLink(targetId) {
    activeSectionId = targetId;
    navLinks.forEach(function (link) {
      if (link.getAttribute('data-target') === targetId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  function filterContent(query) {
    var panels = document.querySelectorAll('.info-section-panel');
    if (!query) {
      panels.forEach(function (p) { p.style.display = 'block'; });
      navLinks.forEach(function (l) { l.style.display = 'flex'; });
      return;
    }

    panels.forEach(function (p) {
      var text = p.textContent.toLowerCase();
      var id = p.querySelector('.info-section-anchor') ? p.querySelector('.info-section-anchor').id : '';
      var matched = text.indexOf(query) !== -1;
      p.style.display = matched ? 'block' : 'none';

      var link = document.querySelector('.info-nav-link[data-target="' + id + '"]');
      if (link) {
        link.style.display = matched ? 'flex' : 'none';
      }
    });
  }

  return {
    init: init
  };
})();
