import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClaudeCliError,
  claudeCliInvocation,
  configureClaudeCliRunnerForTests,
  generateClaudeStructuredJson,
  type ClaudeCliInvocation,
  type ClaudeCliRunResult
} from './claudeText.ts';

function successEnvelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 2500,
    result: '{"ok":true}',
    session_id: 'session-1',
    total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 20 },
    modelUsage: { 'claude-haiku-4-5-20251001': { costUSD: 0.01 } },
    ...overrides
  });
}

function stubRunner(result: Partial<ClaudeCliRunResult>, capture?: { invocation?: ClaudeCliInvocation; prompt?: string; timeoutMs?: number }) {
  configureClaudeCliRunnerForTests(async (invocation, prompt, timeoutMs) => {
    if (capture) {
      capture.invocation = invocation;
      capture.prompt = prompt;
      capture.timeoutMs = timeoutMs;
    }
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false, ...result };
  });
}

test.afterEach(() => {
  configureClaudeCliRunnerForTests();
  delete process.env.CLAUDE_CLI_PATH;
  delete process.env.CLAUDE_WSL_DISTRO;
  delete process.env.CLAUDE_CLI_TIMEOUT_MS;
});

test('claude generation parses the envelope and captures the resolved model', async () => {
  const capture: { invocation?: ClaudeCliInvocation; prompt?: string } = {};
  stubRunner({ stdout: successEnvelope() }, capture);

  const generation = await generateClaudeStructuredJson('PROMPT BODY', 'haiku', 'Return only JSON.');

  assert.deepEqual(generation.parsed, { ok: true });
  assert.equal(generation.output, '{"ok":true}');
  const stats = generation.stats as Record<string, unknown>;
  assert.equal(stats.requestedModel, 'haiku');
  assert.equal(stats.resolvedModel, 'claude-haiku-4-5-20251001');
  assert.equal(stats.transport, 'claude-cli');
  assert.equal(stats.result, undefined);
  assert.equal(capture.prompt, 'PROMPT BODY');
});

test('the resolved model ignores auxiliary modelUsage entries and picks the serving model', async () => {
  stubRunner({
    stdout: successEnvelope({
      modelUsage: {
        'claude-haiku-4-5-20251001': { outputTokens: 12 },
        'claude-sonnet-5': { outputTokens: 812 }
      }
    })
  });

  const generation = await generateClaudeStructuredJson('prompt', 'sonnet');

  assert.equal((generation.stats as Record<string, unknown>).resolvedModel, 'claude-sonnet-5');
});

test('without a family match the resolved model is the largest producer of output', async () => {
  stubRunner({
    stdout: successEnvelope({
      modelUsage: {
        'claude-haiku-4-5-20251001': { outputTokens: 12 },
        'claude-opus-4-8': { outputTokens: 640 }
      }
    })
  });

  const generation = await generateClaudeStructuredJson('prompt', 'claude-3-9-experimental');

  assert.equal((generation.stats as Record<string, unknown>).resolvedModel, 'claude-opus-4-8');
});

test('a result that is not valid JSON keeps the audit payload on the error', async () => {
  stubRunner({ stdout: successEnvelope({ result: '{"conversations":[{"title":"Trunc' }) });

  await assert.rejects(
    generateClaudeStructuredJson('prompt', 'haiku'),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeCliError);
      assert.match(error.message, /not valid JSON/);
      assert.equal(error.partialOutput, '{"conversations":[{"title":"Trunc');
      const stats = error.stats as Record<string, unknown>;
      assert.equal(stats.resolvedModel, 'claude-haiku-4-5-20251001');
      return true;
    }
  );
});

test('claude generation strips markdown fences from the result text', async () => {
  stubRunner({ stdout: successEnvelope({ result: '```json\n{"ok":true}\n```' }) });

  const generation = await generateClaudeStructuredJson('prompt', 'sonnet');

  assert.deepEqual(generation.parsed, { ok: true });
});

test('a not-logged-in envelope surfaces the CLI login guidance', async () => {
  stubRunner({ stdout: successEnvelope({ is_error: true, result: 'Not logged in · Please run /login' }) });

  await assert.rejects(
    generateClaudeStructuredJson('prompt', 'haiku'),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeCliError);
      assert.match(error.message, /Not logged in/);
      return true;
    }
  );
});

test('a non-zero exit without an envelope reports stderr', async () => {
  stubRunner({ stdout: '', stderr: 'wsl: distribution not found', exitCode: 1 });

  await assert.rejects(
    generateClaudeStructuredJson('prompt', 'haiku'),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeCliError);
      assert.match(error.message, /exited with code 1/);
      assert.match(error.message, /distribution not found/);
      return true;
    }
  );
});

test('unparseable stdout is reported with the partial output retained', async () => {
  stubRunner({ stdout: 'garbage output that is not JSON' });

  await assert.rejects(
    generateClaudeStructuredJson('prompt', 'haiku'),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeCliError);
      assert.match(error.message, /unparseable/i);
      assert.equal(error.partialOutput, 'garbage output that is not JSON');
      return true;
    }
  );
});

test('an empty result field is treated as a failed generation', async () => {
  stubRunner({ stdout: successEnvelope({ result: '   ' }) });

  await assert.rejects(
    generateClaudeStructuredJson('prompt', 'haiku'),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeCliError);
      assert.match(error.message, /empty generation response/i);
      return true;
    }
  );
});

test('a timed-out call reports the timeout and keeps partial output', async () => {
  process.env.CLAUDE_CLI_TIMEOUT_MS = '1234';
  stubRunner({ stdout: 'partial stream', timedOut: true, exitCode: null });

  await assert.rejects(
    generateClaudeStructuredJson('prompt', 'haiku'),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeCliError);
      assert.match(error.message, /timed out after 1234ms/);
      assert.equal(error.partialOutput, 'partial stream');
      const stats = error.stats as Record<string, unknown>;
      assert.equal(stats.timedOut, true);
      return true;
    }
  );
});

test('a runner launch failure is wrapped with the command context', async () => {
  configureClaudeCliRunnerForTests(async () => {
    throw new Error('spawn wsl.exe ENOENT');
  });

  await assert.rejects(
    generateClaudeStructuredJson('prompt', 'haiku'),
    (error: unknown) => {
      assert.ok(error instanceof ClaudeCliError);
      assert.match(error.message, /Failed to launch the Claude CLI/);
      return true;
    }
  );
});

test('win32 invocation wraps the CLI in wsl.exe with a neutral working directory', () => {
  process.env.CLAUDE_CLI_PATH = '/home/abd/.local/bin/claude';
  process.env.CLAUDE_WSL_DISTRO = 'Ubuntu';

  const invocation = claudeCliInvocation('sonnet', 'Return only JSON.', 'win32');

  assert.equal(invocation.command, 'wsl.exe');
  // -e execs without a shell — `--` would run the joined argv through zsh,
  // word-splitting the system prompt and expanding $/backticks/globs.
  assert.deepEqual(invocation.args.slice(0, 5), ['-d', 'Ubuntu', '--cd', '/tmp', '-e']);
  assert.equal(invocation.args[5], '/home/abd/.local/bin/claude');
  assert.ok(invocation.args.includes('--no-session-persistence'));
  assert.ok(invocation.args.includes('--strict-mcp-config'));
  assert.ok(!invocation.args.includes('--bare'));
  const toolsIndex = invocation.args.indexOf('--tools');
  assert.equal(invocation.args[toolsIndex + 1], '');
  const modelIndex = invocation.args.indexOf('--model');
  assert.equal(invocation.args[modelIndex + 1], 'sonnet');
  const fallbackIndex = invocation.args.indexOf('--fallback-model');
  assert.equal(invocation.args[fallbackIndex + 1], 'haiku');
});

test('linux invocation runs the CLI directly from a neutral directory', () => {
  process.env.CLAUDE_CLI_PATH = '/home/abd/.local/bin/claude';

  const invocation = claudeCliInvocation('opus', 'Return only JSON.', 'linux');

  assert.equal(invocation.command, '/home/abd/.local/bin/claude');
  assert.equal(invocation.args[0], '-p');
  assert.ok(invocation.cwd && invocation.cwd.length > 0);
  const fallbackIndex = invocation.args.indexOf('--fallback-model');
  assert.equal(invocation.args[fallbackIndex + 1], 'sonnet');
  const systemPromptIndex = invocation.args.indexOf('--system-prompt');
  assert.equal(invocation.args[systemPromptIndex + 1], 'Return only JSON.');
});
