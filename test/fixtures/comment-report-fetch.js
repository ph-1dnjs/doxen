import assert from 'node:assert/strict';
let call = 0;
globalThis.fetch = async (url, options = {}) => {
  call++;
  if (url.startsWith('https://api.cloudflare.com/')) {
    const query = JSON.parse(options.body);
    assert.deepEqual(query.params, ['2026-11-10T15:00:00.000Z', '2026-11-11T15:00:00.000Z']);
    const first = { id: 'comment-1', document: process.env.SCENARIO === 'missing-document' ? 'guide/removed' : 'guide/01-introduction', quote: '선택', body: '@all <script>', author: 'member@example.com', created_at: '2026-11-11T01:00:00.000Z' };
    const results = process.env.SCENARIO === 'empty' ? [] : [first];
    if (process.env.SCENARIO === 'grouped') results.push(
      { ...first, id: 'comment-2', document: 'guide/02-writing', quote: '', body: '다른 문서', created_at: '2026-11-11T02:00:00.000Z' },
      { ...first, id: 'comment-3', quote: '', body: '같은 문서의 두 번째 댓글', created_at: '2026-11-11T03:00:00.000Z' },
    );
    return Response.json({ success: true, result: [{ success: true, results }] });
  }
  if (!options.method) return Response.json(process.env.SCENARIO === 'duplicate' ? [{ body: '<!-- doxen-comment-report:2026-11-11 -->' }] : []);
  assert.equal(options.method, 'POST');
  const issue = JSON.parse(options.body);
  assert.match(issue.title, /2026-11-11/);
  assert.match(issue.body, /&#64;all &lt;script&gt;/);
  assert.match(issue.body, /<!-- doxen-comment-report:2026-11-11 -->/);
  if (process.env.SCENARIO === 'missing-document') {
    assert.match(issue.body, /현재 문서 경로를 찾을 수 없습니다/);
    assert.doesNotMatch(issue.body, /github\.com\/owner\/repo\/blob/);
  } else {
    assert.match(issue.body, /https:\/\/github\.com\/owner\/repo\/blob\/a{40}\/examples\/guide\/01-introduction\.md/);
    assert.match(issue.body, /https:\/\/docs\.example\.com\/manuals\/#\/guide%2F01-introduction\/comment\/comment-1/);
  }
  if (process.env.SCENARIO === 'grouped') {
    assert.equal((issue.body.match(/### guide\/01-introduction · 댓글 2개/g) || []).length, 1);
    assert.equal((issue.body.match(/examples\/guide\/01-introduction\.md/g) || []).length, 2); // 링크 텍스트와 URL
    assert.match(issue.body, /\/comment\/comment-1/);
    assert.match(issue.body, /\/comment\/comment-3/);
    assert.ok(issue.body.indexOf('같은 문서의 두 번째 댓글') < issue.body.indexOf('### guide/02-writing'));
    assert.ok(issue.body.indexOf('#### 댓글 1') < issue.body.indexOf('#### 댓글 2'));
  }
  return Response.json({ number: 1 }, { status: 201 });
};
process.on('exit', (code) => {
  if (code === 0) assert.equal(call, process.env.SCENARIO === 'empty' ? 1 : process.env.SCENARIO === 'duplicate' ? 2 : 3);
});
