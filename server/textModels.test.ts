import assert from 'node:assert/strict';
import test from 'node:test';
import { getTextModelOptions, resolveTextModel } from './textModels.ts';

test.afterEach(() => {
  delete process.env.CLAUDE_TEXT_MODELS;
});

test('text model options include the curated Claude aliases after Gemini and Codex', async () => {
  const options = await getTextModelOptions();

  const claudeOptions = options.filter((option) => option.provider === 'claude');
  assert.deepEqual(claudeOptions.map((option) => option.id), ['claude:fable', 'claude:opus', 'claude:sonnet', 'claude:haiku']);
  assert.deepEqual(claudeOptions.map((option) => option.label), ['Claude Fable', 'Claude Opus', 'Claude Sonnet', 'Claude Haiku']);
  assert.ok(claudeOptions.every((option) => option.source === 'configured'));

  assert.equal(options[0].provider, 'gemini');
  const firstClaudeIndex = options.findIndex((option) => option.provider === 'claude');
  const lastCodexIndex = options.map((option) => option.provider).lastIndexOf('codex');
  assert.ok(lastCodexIndex < firstClaudeIndex, 'Claude options should follow Codex options');
});

test('CLAUDE_TEXT_MODELS overrides the curated Claude list', async () => {
  process.env.CLAUDE_TEXT_MODELS = 'sonnet, claude-opus-4-6';

  const options = await getTextModelOptions();

  const claudeOptions = options.filter((option) => option.provider === 'claude');
  assert.deepEqual(claudeOptions.map((option) => option.id), ['claude:sonnet', 'claude:claude-opus-4-6']);
  assert.deepEqual(claudeOptions.map((option) => option.label), ['Claude Sonnet', 'Claude (claude-opus-4-6)']);
});

test('a configured Claude id resolves to its configured option', async () => {
  const resolved = await resolveTextModel('claude:sonnet');

  assert.equal(resolved.provider, 'claude');
  assert.equal(resolved.model, 'sonnet');
  assert.equal(resolved.label, 'Claude Sonnet');
  assert.equal(resolved.source, 'configured');
});

test('an unlisted Claude id resolves leniently as a fallback option', async () => {
  const resolved = await resolveTextModel('claude:claude-sonnet-4-6');

  assert.equal(resolved.provider, 'claude');
  assert.equal(resolved.model, 'claude-sonnet-4-6');
  assert.equal(resolved.source, 'fallback');
});

test('an empty Claude id is rejected', async () => {
  await assert.rejects(resolveTextModel('claude:'), /Unsupported text model/);
});

test('gemini remains the default model resolution', async () => {
  const resolved = await resolveTextModel(undefined);
  assert.equal(resolved.provider, 'gemini');
});
