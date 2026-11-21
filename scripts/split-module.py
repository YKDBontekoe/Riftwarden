#!/usr/bin/env python3
"""Split a TSX module into several files by top-level declaration (one-off refactoring helper).

usage: split-module.py SRC OUTDIR PLAN.json
PLAN maps new file names (without extension) to lists of top-level declaration names. Every new file gets the
source's import block (paths rewritten for the new directory) plus imports of the declarations it uses from its
siblings; unused imports are then removed by compiling with noUnusedLocals and pruning what tsc reports. SRC becomes a
barrel that re-exports the public names, so importers keep working.
"""
import json, os, re, subprocess, sys

src, outdir, plan_path = sys.argv[1:4]
plan = json.load(open(plan_path))
text = open(src).read()
lines = text.split('\n')

# Import block: everything up to the first top-level declaration.
decl_re = re.compile(r'^(export\s+)?(?:async\s+)?(function|const|let|type|interface|class|enum)\s+([A-Za-z_$][\w$]*)')
first = next(i for i, l in enumerate(lines) if decl_re.match(l) or l.startswith('/**') or l.startswith('// ---'))
imports = '\n'.join(lines[:first]).strip()

# Declarations with their leading comments.
decls = {}
order = []
i = first
pending = []
while i < len(lines):
    l = lines[i]
    m = decl_re.match(l)
    if m:
        name = m.group(3)
        start = i - len(pending)
        # until the next top-level declaration / comment block start
        j = i + 1
        while j < len(lines) and not (decl_re.match(lines[j]) or (lines[j].startswith('/**') or lines[j].startswith('// ') and j + 1 < len(lines))):
            j += 1
        # trailing blank lines belong to nobody
        body = lines[start:j]
        while body and body[-1].strip() == '':
            body.pop()
        decls[name] = {'text': '\n'.join(body), 'export': bool(m.group(1))}
        order.append(name)
        pending = []
        i = j
        continue
    if l.startswith('/**') or l.startswith('// '):
        # collect a comment block
        k = i
        block = []
        while k < len(lines) and not decl_re.match(lines[k]):
            block.append(lines[k])
            if lines[k].strip() == '' and not lines[k + 1 if k + 1 < len(lines) else k].startswith(('/**', ' *', '//')):
                pass
            k += 1
        # only keep the contiguous comment lines right before the declaration
        tail = []
        for b in reversed(block):
            if b.strip() == '':
                break
            tail.insert(0, b)
        pending = tail
        i = k
        continue
    i += 1

planned = {n for names in plan.values() for n in names}
missing = [n for n in order if n not in planned]
if missing:
    sys.exit(f'declarations not in the plan: {missing}')

os.makedirs(outdir, exist_ok=True)
src_dir = os.path.dirname(src)
owner = {n: f for f, names in plan.items() for n in names}

def rewrite_imports(block):
    def fix(m):
        p = m.group(2)
        if p.startswith('.'):
            abs_p = os.path.normpath(os.path.join(src_dir, p))
            rel = os.path.relpath(abs_p, outdir)
            if not rel.startswith('.'):
                rel = './' + rel
            p = rel
        return f"{m.group(1)}'{p}'"
    return re.sub(r"(from\s+)'([^']+)'", fix, block)

base_imports = rewrite_imports(imports)
files = {}
for f, names in plan.items():
    body = '\n\n'.join(decls[n]['text'] for n in names)
    # sibling imports: names used in this body owned by another file
    sib = {}
    for other, oname in [(n, owner[n]) for n in order if owner[n] != f]:
        if re.search(r'\b' + re.escape(other) + r'\b', body):
            sib.setdefault(oname, []).append(other)
            if not decls[other]['export']:
                decls[other]['export'] = True
    files[f] = (names, body, sib)

for f, (names, body, sib) in files.items():
    # make every declaration needed elsewhere exported
    parts = []
    for n in names:
        t = decls[n]['text']
        if decls[n]['export'] and not re.search(r'^export\s', t.split('\n')[[k for k, l in enumerate(t.split('\n')) if decl_re.match(l)][0]]):
            t = re.sub(r'^((?:async\s+)?(?:function|const|let|type|interface|class|enum)\s)', r'export \1', t, count=1, flags=re.M)
        parts.append(t)
    sib_imports = '\n'.join(f"import {{ {', '.join(sorted(v))} }} from './{k}';" for k, v in sorted(sib.items()))
    out = base_imports + ('\n' + sib_imports if sib_imports else '') + '\n\n' + '\n\n'.join(parts) + '\n'
    open(os.path.join(outdir, f + '.tsx'), 'w').write(out)

# The source becomes a barrel of the public names.
public = [n for n in order if re.search(r'^export\s', decls[n]['text'], re.M)]
rel_dir = os.path.relpath(outdir, src_dir)
barrel = '// Re-exports (the panels live in ./%s, one module per panel).\n' % rel_dir
by_file = {}
for n in public:
    by_file.setdefault(owner[n], []).append(n)
for f, names in sorted(by_file.items()):
    barrel += f"export {{ {', '.join(names)} }} from './{rel_dir}/{f}';\n"
open(src, 'w').write(barrel)

# Prune unused imports reported by tsc (several passes: removing one can expose none; types too).
for _ in range(6):
    r = subprocess.run(['npx', 'tsc', '--noEmit', '-p', '.'], capture_output=True, text=True)
    errs = re.findall(r'^(.+?)\((\d+),(\d+)\): error TS(6133|6192|6196|6198): (.*)$', r.stdout, re.M)
    errs = [e for e in errs if os.path.abspath(e[0]).startswith(os.path.abspath(outdir))]
    if not errs:
        break
    by = {}
    for path, line, col, code, msg in errs:
        by.setdefault(path, []).append((int(line), int(col), code, msg))
    for path, items in by.items():
        ls = open(path).read().split('\n')
        for line, col, code, msg in sorted(items, reverse=True):
            l = ls[line - 1]
            if code in ('6192', '6198'):  # all imports in a declaration unused
                # remove the whole (possibly multi-line) import statement
                k = line - 1
                while not ls[k].rstrip().endswith(';'):
                    k += 1
                del ls[line - 1:k + 1]
                continue
            nm = re.search(r"'([^']+)' is declared", msg)
            if not nm:
                continue
            name = nm.group(1)
            # find the import statement containing this line
            s0 = line - 1
            while not ls[s0].startswith('import'):
                s0 -= 1
            e0 = s0
            while not ls[e0].rstrip().endswith(';'):
                e0 += 1
            stmt = ' '.join(x.strip() for x in ls[s0:e0 + 1])
            m = re.match(r"import (type )?\{(.*)\} from (.*);", stmt)
            if m:
                specs = [x.strip() for x in m.group(2).split(',') if x.strip()]
                specs = [x for x in specs if re.sub(r'^type\s+', '', x).split(' as ')[-1].strip() != name]
                new = f"import {m.group(1) or ''}{{ {', '.join(specs)} }} from {m.group(3)};" if specs else ''
            else:
                m2 = re.match(r"import (?:type )?(\w+)(?:, \{(.*)\})? from (.*);", stmt)
                if m2 and m2.group(1) == name:
                    new = f"import {{{m2.group(2)}}} from {m2.group(3)};" if m2.group(2) else ''
                else:
                    continue
            ls[s0:e0 + 1] = [new] if new else []
        open(path, 'w').write('\n'.join(ls))
print('done:', ', '.join(f + '.tsx' for f in plan))
