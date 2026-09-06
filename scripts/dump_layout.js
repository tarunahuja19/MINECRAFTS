#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const pyScript = path.join(__dirname, 'dump_layout.py');
const py314 = '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3';
const pythonBin = fs.existsSync(py314) ? py314 : 'python3';

const res = spawnSync(pythonBin, [pyScript], { stdio: 'inherit' });
if (res.status !== 0) {
  process.exit(res.status || 1);
}
