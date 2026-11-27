import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/desktop-release.yml', 'utf8');
const verifyStep = workflow.split('      - id: release\n')[1]?.split('        run: |\n')[1]?.split('\n  build:')[0];
if (!verifyStep) throw new Error('Desktop release verification step is missing');
const verifyScript = verifyStep.split('\n').map((line) => line.replace(/^          /, '')).join('\n');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function verify(tagRefs: string, remoteFailure = false) {
  const dir = mkdtempSync(join(tmpdir(), 'rift-release-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), '{"version":"0.1.0"}');
  writeFileSync(join(dir, 'output'), '');
  const commands: Record<string, string> = {
    git: '#!/bin/sh\nif [ "$1" = rev-parse ]; then echo "$EXPECTED_SHA"; elif [ "$REMOTE_FAILURE" = 1 ]; then exit 1; else printf "%s\\n" "$TAG_REFS"; fi\n',
    curl: '#!/bin/sh\ncase "$*" in *build.txt*) echo "$EXPECTED_SHA";; *) printf \'{"build":"%s"}\\n\' "$EXPECTED_SHA";; esac\n',
    gh: '#!/bin/sh\ncase "$*" in *"/jobs"*) echo success; exit 0;; *) echo \'{"message":"No commit found","status":"422"}\'; exit 1;; esac\n',
  };
  for (const [name, content] of Object.entries(commands)) writeFileSync(join(dir, name), content, { mode: 0o755 });
  const sha = '1234567890123456789012345678901234567890';
  const env = {
    ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: join(dir, 'output'), EVENT_NAME: 'workflow_run',
    CI_RUN_ID: '123', RELEASE_NUMBER: '4', EXPECTED_SHA: sha, TAG_REFS: tagRefs.replaceAll('EXPECTED', sha),
    REMOTE_FAILURE: remoteFailure ? '1' : '0', GH_REPO: 'owner/repo', GH_TOKEN: 'test',
  };
  const result = spawnSync('bash', ['-e'], { input: verifyScript, cwd: dir, env, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, output: readFileSync(join(dir, 'output'), 'utf8') };
}

describe('desktop release verification', () => {
  it('allows the first release when the tag does not exist', () => {
    const result = verify('');
    expect(result.status).toBe(0);
    expect(result.output).toContain('version=0.1.4\n');
    expect(result.output).toContain('publish=true\n');
  });

  it('allows a retry using an annotated tag pointing at the deployed commit', () => {
    const result = verify('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v0.1.4\nEXPECTED\trefs/tags/v0.1.4^{}');
    expect(result.status).toBe(0);
    expect(result.output).toContain('publish=true\n');
  });

  it('rejects a tag for a different commit and a failed remote lookup', () => {
    expect(verify('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v0.1.4').status).not.toBe(0);
    expect(verify('', true).status).not.toBe(0);
  });
});
