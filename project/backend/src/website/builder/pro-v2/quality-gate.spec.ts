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
});
