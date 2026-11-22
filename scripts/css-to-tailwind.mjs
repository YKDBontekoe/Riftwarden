// Codemod for the Tailwind migration (architecture v2 section 11): moves rules of apps/client/src/ui/style.css into
// Tailwind utilities on the elements that use them, then deletes the rules. Only rules that are safe to move:
//   - the selector is exactly one class (`.name`), outside any at-rule;
//   - no other selector in the stylesheet mentions that class (no states, descendants, compounds, media queries);
//   - no other rule could match the same element (by its tag or its other classes) and set a property of the same
//     family (utilities always win over the components layer, so such a rule would lose its override);
//   - the class appears in the sources only as a literal class token in className="..." / className={...} strings
//     or `.className = '...'` assignments (never built dynamically, never in classList calls or other strings).
// Class names that tests or code query (scripts/, tests/, querySelector) stay on the element as plain markers.
// Declarations become readable utilities where the mapping is exact, `[property:value]` otherwise.
//   node scripts/css-to-tailwind.mjs [--dry] [--only a,b,c] [--skip a,b] [--limit N] [--cascade <ui-shots dir>/cascade.json]
// With --cascade, classes seen on screen use the browser's exact matching (scripts/ui-shots.cjs) instead of the
// conservative static check.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';

const CSS = 'apps/client/src/ui/style.css';
const SRC_DIRS = ['apps/client/src', 'packages/game/src'];
const MARKER_DIRS = ['scripts', 'tests'];
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const skip = new Set(args.includes('--skip') ? args[args.indexOf('--skip') + 1].split(',') : []);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const cascade = args.includes('--cascade') ? JSON.parse(readFileSync(args[args.indexOf('--cascade') + 1], 'utf8')) : {};

const files = (dir, re, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, re, out);
    else if (re.test(e.name)) out.push(p);
  }
  return out;
};

// ---------------------------------------------------------------- declarations -> utilities

const TOKENS = { 'var(--cyan)': 'cyan', 'var(--cyan-2)': 'cyan-2', 'var(--cyan-dim)': 'cyan-dim', 'var(--orange)': 'orange', 'var(--amber)': 'amber', 'var(--red)': 'red', 'var(--violet)': 'violet', 'var(--white)': 'ink', 'var(--muted)': 'muted', 'var(--faint)': 'faint', 'var(--glass)': 'glass', 'var(--line)': 'line' };
const FONTS = { 'var(--font)': 'font-sans', 'var(--display)': 'font-display', 'var(--mono)': 'font-mono' };
const arb = (v) => v.trim().replace(/\s*,\s*/g, ',').replace(/_|\s+/g, (part) => part === '_' ? '\\_' : '_');
const KEYWORD = {
  display: { block: 'block', 'inline-block': 'inline-block', inline: 'inline', flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid', none: 'hidden', contents: 'contents' },
  position: { absolute: 'absolute', relative: 'relative', fixed: 'fixed', sticky: 'sticky', static: 'static' },
  'text-transform': { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
  'text-align': { left: 'text-left', center: 'text-center', right: 'text-right' },
  'white-space': { nowrap: 'whitespace-nowrap', normal: 'whitespace-normal', pre: 'whitespace-pre', 'pre-wrap': 'whitespace-pre-wrap' },
  'align-items': { center: 'items-center', start: 'items-start', 'flex-start': 'items-start', end: 'items-end', 'flex-end': 'items-end', baseline: 'items-baseline', stretch: 'items-stretch' },
  'justify-content': { center: 'justify-center', 'space-between': 'justify-between', 'flex-start': 'justify-start', start: 'justify-start', 'flex-end': 'justify-end', end: 'justify-end', 'space-around': 'justify-around' },
  'flex-direction': { column: 'flex-col', row: 'flex-row' },
  'flex-wrap': { wrap: 'flex-wrap', nowrap: 'flex-nowrap' },
  'pointer-events': { none: 'pointer-events-none', auto: 'pointer-events-auto' },
  'font-style': { italic: 'italic', normal: 'not-italic' },
  'user-select': { none: 'select-none', all: 'select-all', text: 'select-text' },
  overflow: { hidden: 'overflow-hidden', auto: 'overflow-auto', visible: 'overflow-visible' },
  'text-overflow': { ellipsis: 'text-ellipsis' },
  cursor: { pointer: 'cursor-pointer', default: 'cursor-default' },
};
const PREFIX = {
  gap: 'gap', 'row-gap': 'gap-y', 'column-gap': 'gap-x', padding: 'p', 'padding-top': 'pt', 'padding-bottom': 'pb', 'padding-left': 'pl', 'padding-right': 'pr',
  margin: 'm', 'margin-top': 'mt', 'margin-bottom': 'mb', 'margin-left': 'ml', 'margin-right': 'mr', width: 'w', height: 'h', 'min-width': 'min-w', 'max-width': 'max-w',
  'min-height': 'min-h', 'max-height': 'max-h', 'letter-spacing': 'tracking', 'line-height': 'leading', opacity: 'opacity', 'z-index': 'z', top: 'top', left: 'left',
  right: 'right', bottom: 'bottom', inset: 'inset', 'grid-template-columns': 'grid-cols', flex: 'flex',
};

function utility(prop, value, important) {
  const bang = important ? '!' : '';
  const v = value.trim();
  if (KEYWORD[prop]?.[v]) return KEYWORD[prop][v] + bang;
  if (prop === 'font-weight' && /^\d+$/.test(v)) return `font-[${v}]${bang}`;
  if (prop === 'font-size' && /^[\d.]+(px|rem|em)$/.test(v)) return `text-[${v}]${bang}`;
  if (prop === 'font-family' && FONTS[v]) return FONTS[v] + bang;
  if (prop === 'color' && TOKENS[v]) return `text-${TOKENS[v]}${bang}`;
  if (prop === 'background' && TOKENS[v]) return `bg-${TOKENS[v]}${bang}`;
  if (PREFIX[prop] && !/^var\(/.test(v)) return `${PREFIX[prop]}-[${arb(v)}]${bang}`;
  if (prop.startsWith('--')) return `[${prop}:${arb(v)}]${bang}`;
  return `[${prop}:${arb(v)}]${bang}`;
}

// ---------------------------------------------------------------- stylesheet analysis

const css = readFileSync(CSS, 'utf8');
const root = postcss.parse(css);
const mentions = new Map(); // class -> number of rules whose selector mentions it
const simple = new Map(); // class -> the rule `.class {}` (top level)
root.walkRules((rule) => {
  const inAtRule = rule.parent?.type === 'atrule';
  if (inAtRule && /keyframes/.test(rule.parent.name)) return;
  const classes = new Set([...rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  for (const c of classes) mentions.set(c, (mentions.get(c) ?? 0) + 1);
  const m = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(rule.selector.trim());
  if (m && !inAtRule) simple.set(m[1], simple.has(m[1]) ? null : rule);
});

// Every rule's selectors reduced to the compound that matches the styled element, with the property families it sets.
const family = (prop) => (prop.startsWith('--') ? prop : prop.replace(/^(-\w+-)/, '').split('-')[0]);
const SHORT = { inset: ['top', 'left', 'right', 'bottom'], top: ['inset'], left: ['inset'], right: ['inset'], bottom: ['inset'], flex: ['flex'], place: ['align', 'justify'], align: ['place'], justify: ['place'] };
const families = (props) => {
  const f = new Set(props.map(family));
  for (const x of [...f]) for (const y of SHORT[x] ?? []) f.add(y);
  return f;
};
const targets = [];
root.walkRules((rule) => {
  if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
  const props = families(rule.nodes.filter((n) => n.type === 'decl').map((d) => d.prop));
  for (const sel of rule.selector.split(',')) {
    const last = sel.trim().split(/\s*[ >+~]\s*/).pop() ?? '';
    if (/::?(before|after|placeholder|selection|marker|-webkit)/.test(last)) continue;
    const bare = last.replace(/:[\w-]+(\([^)]*\))?/g, '');
    const tag = /^[a-z][\w-]*/i.exec(bare)?.[0] ?? null;
    const classes = [...bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    targets.push({ rule, tag, classes, props, universal: !tag && !classes.length });
  }
});
/** Could another rule style the same element (tag + every class token found in its className) with these families? */
function conflicts(c, rule, tag, tokens) {
  const mine = families(rule.nodes.map((d) => d.prop));
  for (const t of targets) {
    if (t.rule === rule) continue;
    if (t.universal && t.tag === null && !t.classes.length) continue; // *, attribute-only: base resets
    if (t.tag && tag && t.tag.toLowerCase() !== tag.toLowerCase()) continue;
    if (t.tag && /^(html|body)$/i.test(t.tag)) continue;
    if (!t.classes.every((k) => tokens.has(k))) continue;
    if (!t.tag && !t.classes.length) continue;
    if ([...t.props].some((f) => mine.has(f))) return t.rule.selector;
  }
  return null;
}

// ---------------------------------------------------------------- sources

const sources = SRC_DIRS.flatMap((d) => files(d, /\.(tsx?|ts)$/)).map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));
const markerText = MARKER_DIRS.flatMap((d) => files(d, /\.(c?js|mjs|ts|tsx)$/)).map((p) => readFileSync(p, 'utf8')).join('\n') + sources.map((s) => s.text).join('\n');

/** Spans of class-list contexts: className="...", className={...} (balanced), `.className = ...;`. */
function classSpans(text) {
  const spans = [];
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{)/g)) {
    if (m[1] !== undefined) {
      spans.push([m.index + 11, m.index + 11 + m[1].length]);
      continue;
    }
    let depth = 1, i = m.index + m[0].length;
    while (i < text.length && depth) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++; }
    spans.push([m.index + m[0].length, i - 1]);
  }
  for (const m of text.matchAll(/\.className\s*=\s*([^;\n]+)/g)) spans.push([m.index + m[0].length - m[1].length, m.index + m[0].length]);
  return spans;
}
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenRe = (c) => new RegExp(`(?<![\\w-])${escapeRegex(c)}(?![\\w-])`, 'g');

function plan(c) {
  if (only && !only.has(c)) return null;
  if (skip.has(c)) return null;
  // Rules that only set custom properties feed other rules' var() lookups: moving them changes the cascade.
  if (simple.get(c)?.nodes.every((n) => n.type === 'decl' && n.prop.startsWith('--'))) return null;
  const rule = simple.get(c);
  if (!rule || mentions.get(c) !== 1) return null;
  if (rule.nodes.some((n) => n.type !== 'decl')) return null;
  // CSS escapes need to survive both the Tailwind arbitrary-value parser and the source string literal.
  if (rule.nodes.some((d) => d.value.includes('\\'))) return null;
  const re = tokenRe(c);
  let inClass = 0;
  for (const s of sources) {
    const spans = classSpans(s.text);
    for (const m of s.text.matchAll(re)) {
      const inside = spans.some(([a, b]) => m.index >= a && m.index < b);
      // A token outside class contexts (a string, classList, a variable) means dynamic use: leave the rule alone.
      if (!inside) {
        const line = s.text.slice(s.text.lastIndexOf('\n', m.index) + 1, s.text.indexOf('\n', m.index));
        if (/['"`]/.test(line) || /classList|querySelector/.test(line)) return null;
        continue; // an identifier or comment with the same spelling
      }
      inClass++;
      const span = spans.find(([a, b]) => m.index >= a && m.index < b);
      const tokens = new Set([...s.text.slice(span[0], span[1]).matchAll(/[\w-]+/g)].map((x) => x[0]));
      const open = s.text.lastIndexOf('<', span[0]);
      const tagName = /^<([\w.]+)/.exec(s.text.slice(open))?.[1] ?? null;
      const tag = tagName && /^[a-z]/.test(tagName) ? tagName : null; // a component renders an unknown tag
      const why = c in cascade ? cascade[c][0] ?? null : conflicts(c, rule, tag, tokens);
      if (why) {
        if (process.env.WHY) console.log(`skip .${c}: ${why}`);
        return null;
      }
    }
  }
  if (!inClass) return null;
  const marker = new RegExp(`['"\`.\\s]${escapeRegex(c)}(?![\\w-])`).test(
    markerText.replace(/className=(?:"[^"]*"|\{[^}]*\})/g, ''),
  );
  const utils = rule.nodes.map((d) => utility(d.prop, d.value, d.important));
  return { c, rule, utils, keep: marker };
}

const plans = [];
for (const c of simple.keys()) {
  const p = plan(c);
  if (p) plans.push(p);
  if (plans.length >= limit) break;
}

if (dry) {
  for (const p of plans) console.log(`.${p.c}${p.keep ? ' (marker kept)' : ''} -> ${p.utils.join(' ')}`);
  console.log(`\n${plans.length} rules can move (of ${simple.size} single-class rules)`);
  process.exit(0);
}

for (const s of sources) {
  let text = s.text;
  for (const p of plans) {
    const re = tokenRe(p.c);
    const spans = classSpans(text);
    let out = '', last = 0;
    for (const m of text.matchAll(re)) {
      if (!spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
      out += text.slice(last, m.index) + (p.keep ? `${p.c} ` : '') + p.utils.join(' ');
      last = m.index + m[0].length;
    }
    text = out + text.slice(last);
  }
  if (text !== s.text) writeFileSync(s.path, text);
}
for (const p of plans) p.rule.remove();
writeFileSync(CSS, root.toString());
console.log(`moved ${plans.length} rules into utilities`);
