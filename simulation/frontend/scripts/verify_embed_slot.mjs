/**
 * Embed slot-identity gates (src/embed.ts).
 *
 * Run with:  npx vite-node scripts/verify_embed_slot.mjs
 *
 * The dashboard renders the same 3D app in two tabs (SIM + FORGE) and tags
 * each iframe with ?slot=sim|forge. The FORGE slot is a sandbox view, so the
 * App suppresses engine packet-sync toasts there (SIM only). These lock down
 * the parsing half of that contract; the App.tsx gating itself is pinned by
 * dashboard_electron/test/verify_forge_close.js (static wiring check).
 */

import { parseEmbedParams } from '../src/embed.ts';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };

console.log('\n=== EMBED SLOT PARAM ===');
{
  const p = parseEmbedParams('embed=1&slot=forge');
  ok(p.isEmbed === true && p.slot === 'forge', 'slot=forge parses (forge iframe stays silent on packets)');
}
{
  const p = parseEmbedParams('embed=1&slot=sim');
  ok(p.isEmbed === true && p.slot === 'sim', 'slot=sim parses (sim iframe keeps packet toasts)');
}
{
  const p = parseEmbedParams('embed=1');
  ok(p.isEmbed === true && p.slot === null, 'missing slot parses as null (toasts default ON)');
}
{
  const p = parseEmbedParams('slot=forge');
  ok(p.isEmbed === false && p.slot === null, 'slot without embed=1 is ignored (standalone keeps toasts)');
}
{
  const p = parseEmbedParams('');
  ok(p.isEmbed === false && p.slot === null, 'empty query parses as standalone (toasts on)');
}
{
  // Slot rides alongside the existing params without disturbing them.
  const p = parseEmbedParams('embed=1&slot=forge&xmin=1&xmax=2&ymin=3&ymax=4&nodes=1,2&day=9&exag=3&label=probe');
  ok(p.slot === 'forge' && p.day === 9 && p.exag === 3 && p.label === 'probe' &&
     p.clip !== null && p.nodeIds !== null && p.nodeIds.length === 2,
     'slot coexists with clip/nodes/day/exag/label params');
}

console.log(fail === 0 ? '\nALL CHECKS PASSED\n' : `\n${fail} CHECK(S) FAILED\n`);
process.exit(fail ? 1 : 0);
