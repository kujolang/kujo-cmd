import type {ModApi} from '@commandcode/harness';
import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {mkdir, readFile, readdir, rename, unlink, writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const watchdogUrl = process.env.KUJO_CMD_WATCHDOG_URL || 'http://127.0.0.1:7700';
const runLedgerEnabled = process.env.KUJO_CMD_RUNLEDGER === '1';
const jidokaEnabled = process.env.KUJO_CMD_JIDOKA !== '0';
const spoolRoot = resolve('.kujo', 'watchdog-spool');

function hash(value: string, length: number): string {
	return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function endpoint(): URL {
	const url = new URL('/telemetry/v2/batches', watchdogUrl);
	const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Kujo bridge Watchdog endpoint must use HTTPS or loopback HTTP');
	if (url.username || url.password || url.search || url.hash) throw new Error('Kujo bridge Watchdog endpoint cannot contain credentials, query, or fragment');
	return url;
}

async function spool(batch: object): Promise<void> {
	await mkdir(spoolRoot, {recursive: true, mode: 0o700});
	const finalPath = join(spoolRoot, `${Date.now()}-${randomUUID()}.json`);
	const temporary = `${finalPath}.tmp`;
	await writeFile(temporary, JSON.stringify(batch), {mode: 0o600, flag: 'wx'});
	await rename(temporary, finalPath);
	const files = (await readdir(spoolRoot)).filter(name => name.endsWith('.json')).sort();
	for (const name of files.slice(0, Math.max(0, files.length - 100))) await unlink(join(spoolRoot, name));
}

async function deliver(url: URL, batch: object): Promise<{ok: boolean; retryable: boolean}> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 2000);
	try {
		const token = process.env.WDG_API_AUTH_TOKEN;
		const response = await fetch(url, {method: 'POST', redirect: 'error', signal: controller.signal, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: JSON.stringify(batch)});
		return {ok: response.ok, retryable: [401, 403, 408, 429].includes(response.status) || response.status >= 500};
	} catch {
		return {ok: false, retryable: true};
	} finally {
		clearTimeout(timer);
	}
}

async function submit(batch: object): Promise<void> {
	let url: URL;
	try { url = endpoint(); } catch { return; }
	await mkdir(spoolRoot, {recursive: true, mode: 0o700});
	for (const name of (await readdir(spoolRoot)).filter(value => value.endsWith('.json')).sort()) {
		const path = join(spoolRoot, name);
		let pending: object;
		try { pending = JSON.parse(await readFile(path, 'utf8')); } catch { await unlink(path); continue; }
		const replay = await deliver(url, pending);
		if (replay.ok || !replay.retryable) await unlink(path);
		else break;
	}
	const result = await deliver(url, batch);
	if (!result.ok && result.retryable) await spool(batch).catch(() => undefined);
}

type RunState = {
	sessionId: string;
	traceId: string;
	startedAt: string;
	kujoFailures: number;
	jidokaNudged: boolean;
	model: string;
	runLedgerId: string;
};

function installationPath(): string {
	const dataRoot = process.env.KUJO_CMD_HOME || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'kujo', 'cmd');
	return join(dataRoot, 'installation.json');
}

async function runLedgerCommand(args: string[]): Promise<string> {
	const installation = JSON.parse(await readFile(installationPath(), 'utf8'));
	const binary = installation.kujo_bin;
	const source = installation.sources?.runledger?.path;
	if (typeof binary !== 'string' || typeof source !== 'string') throw new Error('trusted Kujo CMD RunLedger installation is unavailable');
	const result = await execute(binary, ['run', join(source, 'runledger.kujo'), '--interpreter', '--', ...args], {cwd: process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024});
	return result.stdout;
}

export default function (cmd: ModApi): void {
	let current: RunState | null = null;
	let queue = Promise.resolve();

	const enqueue = (work: () => Promise<void>) => { queue = queue.then(work, work); };
	const record = (name: string, status: 'ok' | 'error' | 'cancelled' = 'ok', references: Array<{type: 'session' | 'run' | 'agent' | 'tool_call'; id: string}> = [], attributes: Record<string, string | number | boolean> = {}) => {
		if (!current) return;
		const now = new Date().toISOString();
		const recordId = randomUUID();
		const outcome = status === 'ok' ? 'success' : status;
		const refs = [{type: 'session' as const, id: current.sessionId}, ...(current.runLedgerId ? [{type: 'run' as const, id: current.runLedgerId, namespace: 'runledger'}] : []), ...references];
		const batch = {
			schema_version: 'watchdog.telemetry.v2', batch_id: `command-code:${recordId}`, sent_at: now,
			producer: {name: 'kujo-cmd-command-code', version: '1.0.0', adapter_id: 'kujo.cmd.command-code.mod', adapter_version: '1.0.0', original_schema: 'command-code.agent-event'},
			records: [{record_id: recordId, record_type: 'event', trace_id: current.traceId, observed_at: now, kind: name.includes('tool') ? 'tool' : name.includes('agent') ? 'agent' : 'workflow', name, status, source: {'watchdog.semantic_profile': 'watchdog.observability.v1', 'application.name': 'kujo-cmd', 'harness.name': 'command-code', 'instrumentation.name': 'kujo.cmd.command-code.mod', 'instrumentation.version': '1.0.0'}, references: refs, attributes: {...attributes, 'watchdog.outcome.code': outcome, 'watchdog.outcome.terminal': true}, content: [], privacy: {content_mode: 'off', policy_version: 'watchdog.privacy.v1', transformations: ['metadata_only']}}],
		};
		enqueue(() => submit(batch));
	};

	const startLedger = async () => {
		if (!current || current.runLedgerId || !runLedgerEnabled) return;
		const output = await runLedgerCommand(['start', '--provider', 'command-code', '--model', current.model || 'unknown', '--task', `Command Code session ${current.sessionId}`, '--repo', process.cwd()]);
		const match = output.match(/Started run:\s*([^\s]+)/);
		if (match) current.runLedgerId = match[1];
	};

	cmd.on('run_start', event => {
		if (event.type !== 'run_start') return;
		const sessionId = String(event.sessionId || randomUUID());
		current = {sessionId, traceId: hash(sessionId, 32), startedAt: new Date().toISOString(), kujoFailures: 0, jidokaNudged: false, model: 'unknown', runLedgerId: ''};
		record('command_code.run.start');
	});

	cmd.on('model_request_start', event => {
		if (!current || event.type !== 'model_request_start') return;
		current.model = String(event.model || 'unknown').slice(0, 200);
		enqueue(async () => { try { await startLedger(); } catch {} });
	});

	cmd.on('subagent_start', event => {
		if (event.type === 'subagent_start') record('command_code.subagent.start', 'ok', [{type: 'agent', id: String(event.toolCallId)}], {subagent_type: String(event.subagentType).slice(0, 128)});
	});
	cmd.on('subagent_stop', event => {
		if (event.type === 'subagent_stop') record('command_code.subagent.stop', 'ok', [{type: 'agent', id: String(event.toolCallId)}], {subagent_type: String(event.subagentType).slice(0, 128), tokens_used: Number(event.tokensUsed) || 0});
	});

	cmd.hooks({
		afterToolCall: async ({toolCallId, toolName, isError}) => {
			const kujo = toolName.startsWith('mcp__kujo__');
			if (kujo && isError && current) current.kujoFailures += 1;
			if (kujo) record('command_code.kujo_tool.complete', isError ? 'error' : 'ok', [{type: 'tool_call', id: toolCallId}], {tool_name: toolName.slice(0, 200)});
			return undefined;
		},
		onStop: async () => {
			if (!jidokaEnabled || !current || current.kujoFailures === 0 || current.jidokaNudged) return undefined;
			current.jidokaNudged = true;
			record('command_code.jidoka.stop_gate', 'error', [], {kujo_failures: current.kujoFailures});
			return {continue: true, reason: 'A Kujo MCP call failed. Inspect the Kujo Ability receipt, correct or safely retry the failed operation, and only then finish the task.'};
		},
		onRunEnd: async () => {
			if (!current) return;
			record('command_code.run.end', current.kujoFailures ? 'error' : 'ok', [], {kujo_failures: current.kujoFailures});
			await queue;
			if (current.runLedgerId && runLedgerEnabled) {
				const status = current.kujoFailures ? 'partial' : 'pass';
				const verdict = current.kujoFailures ? 'Command Code run ended with failed Kujo MCP calls.' : 'Command Code run completed without failed Kujo MCP calls.';
				try { await runLedgerCommand(['finish', current.runLedgerId, '--status', status, '--verdict', verdict, '--repo', process.cwd()]); } catch {}
			}
		},
	});
}
