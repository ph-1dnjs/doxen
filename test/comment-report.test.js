import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
for (const scenario of ['created', 'duplicate', 'empty', 'missing-document', 'grouped']) {
  test(`daily comment report: ${scenario}`, async () => {
    const { stdout } = await run(process.execPath, ['--import', './test/fixtures/comment-report-fetch.js', './src/comment-report.js'], {
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_D1_DATABASE_ID: 'database', CLOUDFLARE_API_TOKEN: 'test', GITHUB_TOKEN: 'test', GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: 'a'.repeat(40), DOXEN_SITE_URL: 'https://docs.example.com/manuals/', DOXEN_CONFIG: 'examples/docs.config.ts', REPORT_DATE: '2026-11-11', SCENARIO: scenario },
    });
    assert.match(stdout, /2026-11-11/);
  });
}
