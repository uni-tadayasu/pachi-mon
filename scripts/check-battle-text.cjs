#!/usr/bin/env node
'use strict';
/* Battle text is never cut off: names, the enemy label and one-line commands
 * shrink to fit (then wrap as a last resort), the status chip sits beside the
 * HP numbers, and the battle lists grow with their content. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pachi-ui.css'), 'utf8');

// ── The fitting routine, run against a fake element whose text width scales with its font size.
const start = html.indexOf('  // Battle names, labels and commands are never cut off');
const end = html.indexOf('  function updateBattle() {', start);
assert(start > 0 && end > start, 'fitBattleLine block exists before updateBattle');
let writes = 0;
function fakeLine({ chars, base, width, kind = 'name' }) {
  const classes = new Set(kind === 'name' ? [] : kind === 'label' ? ['hp-label'] : ['btn', 'fit-line']);
  const el = {
    isConnected: true, dataset: {}, chars, textContent: 'x'.repeat(chars),
    style: { _size: '', get fontSize() { return this._size; }, set fontSize(v) { writes += 1; this._size = v; } },
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    get clientWidth() { return width.value; },
    get scrollWidth() { const size = parseFloat(this.style.fontSize) || base; return classes.has('fit-wrap') ? width.value : Math.max(width.value, Math.round(chars * size * 100) / 100); },
    matches: sel => (sel === '.hp-label' ? classes.has('hp-label') : sel === '.btn' ? classes.has('btn') : false),
    closest: () => null, parentElement: { get clientWidth() { return width.value; }, textContent: 'row' },
    size() { return parseFloat(this.style.fontSize) || base; }, wraps: () => classes.has('fit-wrap'),
  };
  return el;
}
const lines = [];
const c = vm.createContext({ document: { querySelectorAll: () => lines }, getComputedStyle: el => ({ fontSize: `${el.base ?? 13}px` }) });
vm.runInContext(html.slice(start, end), c);
const fit = (el, min) => { el.base = el.base ?? 13; c.fitBattleLine(el, min); };

{ // Fits at full size: untouched.
  const el = fakeLine({ chars: 8, base: 13, width: { value: 120 } }); el.base = 13; fit(el, 8);
  assert.equal(el.style.fontSize, ''); assert.equal(el.wraps(), false);
}
{ // Too wide at 13px but fits smaller: the largest fitting size (to 0.25px) on one line.
  const el = fakeLine({ chars: 11, base: 13, width: { value: 120 } }); el.base = 13; fit(el, 8);
  const size = el.size(); assert(size < 13 && size >= 8, `shrunk to ${size}`);
  assert(11 * size <= 120, 'shrunk line fits'); assert(11 * (size + 0.5) > 120, 'not shrunk more than needed');
  assert.equal(el.wraps(), false, 'a line that fits once shrunk never wraps');
}
{ // Even the minimum is too wide: wrap instead of hiding anything.
  const el = fakeLine({ chars: 20, base: 13, width: { value: 120 } }); el.base = 13; fit(el, 8);
  assert.equal(el.wraps(), true); assert.equal(el.size(), 8);
}
{ // Unchanged text and width: no new work; a resize refits.
  const width = { value: 120 }, el = fakeLine({ chars: 11, base: 13, width }); el.base = 13; fit(el, 8);
  const before = writes; fit(el, 8); assert.equal(writes, before, 'cached fit is reused');
  width.value = 200; fit(el, 8); assert.equal(el.style.fontSize, '', 'wider card restores the full size');
}
{ // Hidden lines (zero width) are left for the next update.
  const el = fakeLine({ chars: 11, base: 13, width: { value: 0 } }); el.base = 13; fit(el, 8);
  assert.equal(el.dataset.fit, undefined); assert.equal(el.style.fontSize, '');
}
{ // refitBattleText uses 8px for names, 9px for the enemy label and 10px for commands.
  const name = fakeLine({ chars: 30, base: 13, width: { value: 120 } }), label = fakeLine({ chars: 30, base: 11, width: { value: 120 }, kind: 'label' }), command = fakeLine({ chars: 30, base: 15, width: { value: 120 }, kind: 'command' });
  name.base = 13; label.base = 11; command.base = 15; lines.push(name, label, command); c.refitBattleText(true);
  assert.deepEqual([name.size(), label.size(), command.size()], [8, 9, 10]); assert(name.wraps() && label.wraps() && command.wraps());
  lines.length = 0;
}

// ── Wiring: every HUD update and every command menu refits; a resize refits during battles.
const updateBattle = html.slice(html.indexOf('  function updateBattle() {'), html.indexOf('  function battleActions('));
assert(/hp-label'\)\.textContent = [\s\S]*?\n\s*refitBattleText\(\);\n\s*if \(!busy\) battleActions\(\);/.test(updateBattle), 'HUD refits after names, levels and the label are written');
const actions = html.slice(html.indexOf('  function battleActions('), html.indexOf('  function captureBattleView()'));
assert(/classList\.add\('fit-line'\);\s*refitBattleText\(\);/.test(actions), 'one-line commands are fitted after each menu render');
assert(/if\(engine\?\.battle\)refitBattleText\(\);/.test(html), 'resize refits battle text');

// ── HUD markup: the name row holds only the name and level; the chip sits with the HP numbers.
for (const side of ['enemy', 'ally']) {
  const top = new RegExp(`<div class="combatant-top"><strong id="${side}-name">[^<]*</strong><span id="${side}-level">`);
  assert(top.test(html), `${side}: name row holds the name and level only`);
  assert(new RegExp(`<div class="hp-row"><span id="${side}-status" class="status-chip" hidden></span><span id="${side}-hp-text" class="hp-text">`).test(html), `${side}: status chip beside the HP numbers`);
}
assert(/<span class="btn-line">\$\{ico\('resonate'\)\}/.test(html), 'capture button keeps its icon and label on one line');
assert(/<span class="nb">威力 \$\{m\.power\}<\/span> · <span class="nb">命中 /.test(html), 'move details break only between items');

// ── Styles: nothing in battle is ellipsized, lists grow, buttons with a note stack.
const rule = sel => { const all = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')}\\{([^}]*)\\}`, 'gm'))]; return all.map(m => m[1]).join(';'); };
const last = (sel, prop) => { const values = [...rule(sel).matchAll(new RegExp(`(?:^|;)${prop}:([^;]+)`, 'g'))].map(m => m[1]); return values.at(-1); };
assert.equal(last('.combatant-top strong', 'text-overflow'), 'clip');
assert.equal(last('.move-meta', 'text-overflow'), 'clip'); assert.equal(last('.move-meta', 'white-space'), 'normal');
assert.equal(last('.link-combatant>b', 'text-overflow'), 'clip'); assert.equal(last('.link-combatant>b', 'white-space'), 'normal');
assert.equal(last('.battle-actions', 'grid-auto-rows'), 'minmax(min-content,auto)');
assert.match(rule('.battle-actions>.btn:has(>small)'), /flex-direction:column/);
assert.match(rule('.combatant-top strong.fit-wrap'), /white-space:normal/);
assert.match(rule('.combatant-type>.hp-label.fit-wrap'), /grid-column:1\/-1/);
console.log(JSON.stringify({ ok: true, checks: ['shrink-to-fit', 'wrap fallback', 'cache/resize', 'hidden lines', 'per-kind minimums', 'wiring', 'HUD markup', 'no ellipsis styles'] }));
