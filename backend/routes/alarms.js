'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const ALARMS_FILE = path.join(__dirname, '..', '..', 'r4-dashboard', 'fixtures', 'alarms.json');

// GET /api/alarms - Returns synchronized alarms
router.get('/', (req, res) => {
  try {
    if (fs.existsSync(ALARMS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ALARMS_FILE, 'utf8'));
      res.json(data);
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to read alarms', details: err.message });
  }
});

module.exports = router;
