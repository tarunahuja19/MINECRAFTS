'use strict';

/**
 * Tutorial step definitions for R4 Mine Subsidence Dashboard.
 * Game-style onboarding: plain English, 1-2 sentences per card.
 */
var TUTORIAL_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome',
    body: 'This dashboard watches for ground movement above the mine. Take a 30-second tour?',
    placement: 'center'
  },
  {
    id: 'tabs',
    target: '#tab-bar',
    tab: 'map',
    title: 'Switch views here',
    body: 'MAP is home. SIMULATION and FORGE let you try what-if scenarios. NODES, ALARMS, HISTORY and SYSTEM show health and records.',
    placement: 'bottom'
  },
  {
    id: 'sim-hud',
    target: '#sim-status-hud',
    tab: 'map',
    title: 'Is anything running?',
    body: 'Sensors only send data while the simulation is running. This badge shows the current state.',
    placement: 'bottom'
  },
  {
    id: 'map',
    target: '#map-container',
    tab: 'map',
    title: 'The map',
    body: 'Each dot is a sensor. Green is healthy, amber is drifting, red is trouble.',
    placement: 'bottom'
  },
  {
    id: 'inspect',
    target: '#right-panel',
    tab: 'map',
    title: 'Inspect a sensor',
    body: 'Click any dot on the map and its live readings and charts appear here.',
    placement: 'left'
  },
  {
    id: 'alarm-history',
    target: '#map-alarm-panel',
    tab: 'map',
    title: 'Alarms show up here',
    body: 'When a sensor crosses a danger threshold, a banner appears and the alarm is listed. Click one to zoom to it.',
    placement: 'right'
  },
  {
    id: 'system-tab',
    target: '.tab-btn[data-tab="system"]',
    title: 'Alerts & health',
    body: 'Check that sensors are online and that text-message alerts are set up.',
    placement: 'bottom'
  },
  {
    id: 'info-tab',
    target: '.tab-btn[data-tab="info"]',
    title: 'Stuck? Read INFO',
    body: 'Plain-English explanations of every sensor, zone, and alarm level.',
    placement: 'bottom'
  },
  {
    id: 'done',
    target: '#btn-tutorial-help',
    title: "You're set",
    body: 'Press ? any time to replay this tour.',
    placement: 'bottom'
  }
];

if (typeof window !== 'undefined') {
  window.TUTORIAL_STEPS = TUTORIAL_STEPS;
}
