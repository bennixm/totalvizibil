import { checkStaticQuality } from './quality-gate';

const baseFiles = new Map([
  ['package.json', '{}'],
  ['index.html', '<html></html>'],
  ['src/main.ts', 'mount()'],
  ['src/App.vue', '<template><App/></template>'],
]);

describe('checkStaticQuality', () => {
  it('passes a legitimate, non-empty change', () => {
    const after = new Map(baseFiles).set('src/App.vue', '<template><NewApp/></template>');
    const result = checkStaticQuality({
      changedPaths: ['src/App.vue'],
      filesBefore: baseFiles,
      filesAfter: after,
      reply: 'Updated App.vue.',
      mutatingToolCallCount: 1,
    });
    expect(result.passed).toBe(true);
  });

  it('fails when tool calls ran but nothing actually changed', () => {
    const result = checkStaticQuality({
      changedPaths: [],
      filesBefore: baseFiles,
      filesAfter: baseFiles,
      reply: 'Done.',
      mutatingToolCallCount: 2,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/no files ended up different/i);
  });

  it('fails when a claimed-changed file is byte-identical to before', () => {
    const result = checkStaticQuality({
      changedPaths: ['src/App.vue'],
      filesBefore: baseFiles,
      filesAfter: baseFiles,
      reply: 'Updated it.',
      mutatingToolCallCount: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/identical/i);
  });

  it('fails when a changed .vue file lost its <template> block', () => {
    const after = new Map(baseFiles).set('src/App.vue', '<script setup>broken</script>');
    const result = checkStaticQuality({
      changedPaths: ['src/App.vue'],
      filesBefore: baseFiles,
      filesAfter: after,
      reply: 'Updated it.',
      mutatingToolCallCount: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/<template>/);
  });

  it('fails when a core scaffold file was deleted', () => {
    const after = new Map(baseFiles);
    after.delete('src/main.ts');
    const result = checkStaticQuality({
      changedPaths: ['src/main.ts'], // a real delete_file call reports its own path as changed
      filesBefore: baseFiles,
      filesAfter: after,
      reply: 'Cleaned up.',
      mutatingToolCallCount: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/main\.ts/);
  });

  it('fails on an empty final reply', () => {
    const result = checkStaticQuality({
      changedPaths: [],
      filesBefore: baseFiles,
      filesAfter: baseFiles,
      reply: '   ',
      mutatingToolCallCount: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/empty/i);
  });

  it('fails when the model declined the task', () => {
    const result = checkStaticQuality({
      changedPaths: [],
      filesBefore: baseFiles,
      filesAfter: baseFiles,
      reply: 'I cannot make that change safely.',
      mutatingToolCallCount: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/declined/i);
  });

  it('passes a no-op read-only turn (e.g. answering a question) with no mutations', () => {
    const result = checkStaticQuality({
      changedPaths: [],
      filesBefore: baseFiles,
      filesAfter: baseFiles,
      reply: 'The hero already uses your brand color.',
      mutatingToolCallCount: 0,
    });
    expect(result.passed).toBe(true);
  });

  describe('SEO basics — only checked when index.html was itself touched this turn', () => {
    const seoOkIndex =
      '<html><head><title>Acme Plumbing — Cluj</title>' +
      '<meta name="description" content="Licensed plumbers serving Cluj-Napoca."></head><body></body></html>';
    const seoOkApp =
      '<template><h1>Acme Plumbing</h1><img src="/hero.jpg" alt="Our team at work" /></template>';

    it('passes a full page build with title, description, an h1, and alt text', () => {
      const after = new Map(baseFiles).set('index.html', seoOkIndex).set('src/App.vue', seoOkApp);
      const result = checkStaticQuality({
        changedPaths: ['index.html', 'src/App.vue'],
        filesBefore: baseFiles,
        filesAfter: after,
        reply: 'Built the site.',
        mutatingToolCallCount: 2,
      });
      expect(result.passed).toBe(true);
    });

    it('fails when index.html has no <title>', () => {
      const badIndex = seoOkIndex.replace(/<title>[^<]*<\/title>/, '');
      const after = new Map(baseFiles).set('index.html', badIndex).set('src/App.vue', seoOkApp);
      const result = checkStaticQuality({
        changedPaths: ['index.html', 'src/App.vue'],
        filesBefore: baseFiles,
        filesAfter: after,
        reply: 'Built the site.',
        mutatingToolCallCount: 2,
      });
      expect(result.passed).toBe(false);
      expect(result.reason).toMatch(/<title>/);
    });

    it('fails when index.html has no meta description', () => {
      const badIndex = seoOkIndex.replace(/<meta name="description"[^>]*>/, '');
      const after = new Map(baseFiles).set('index.html', badIndex).set('src/App.vue', seoOkApp);
      const result = checkStaticQuality({
        changedPaths: ['index.html', 'src/App.vue'],
        filesBefore: baseFiles,
        filesAfter: after,
        reply: 'Built the site.',
        mutatingToolCallCount: 2,
      });
      expect(result.passed).toBe(false);
      expect(result.reason).toMatch(/meta name="description"/);
    });

    it('fails when the page has no <h1> anywhere', () => {
      const after = new Map(baseFiles)
        .set('index.html', seoOkIndex)
        .set('src/App.vue', '<template><h2>Acme Plumbing</h2></template>');
      const result = checkStaticQuality({
        changedPaths: ['index.html', 'src/App.vue'],
        filesBefore: baseFiles,
        filesAfter: after,
        reply: 'Built the site.',
        mutatingToolCallCount: 2,
      });
      expect(result.passed).toBe(false);
      expect(result.reason).toMatch(/<h1>/);
    });

    it('fails when an <img> is missing an alt attribute', () => {
      const after = new Map(baseFiles)
        .set('index.html', seoOkIndex)
        .set('src/App.vue', '<template><h1>Acme</h1><img src="/hero.jpg" /></template>');
      const result = checkStaticQuality({
        changedPaths: ['index.html', 'src/App.vue'],
        filesBefore: baseFiles,
        filesAfter: after,
        reply: 'Built the site.',
        mutatingToolCallCount: 2,
      });
      expect(result.passed).toBe(false);
      expect(result.reason).toMatch(/alt attribute/);
    });

    it('does NOT check SEO basics on an incremental edit that never touches index.html', () => {
      // src/App.vue here has no h1/alt at all, but index.html wasn't part of
      // this turn's changes — a small unrelated edit shouldn't be penalized
      // for pre-existing SEO gaps it never touched.
      const after = new Map(baseFiles).set(
        'src/components/Button.vue',
        '<template><button>Click</button></template>',
      );
      const result = checkStaticQuality({
        changedPaths: ['src/components/Button.vue'],
        filesBefore: baseFiles,
        filesAfter: after,
        reply: 'Updated the button.',
        mutatingToolCallCount: 1,
      });
      expect(result.passed).toBe(true);
    });
  });
});
