import { randomUUID } from "node:crypto";

const name = "claude-grok";
const inject = ["tools", "llm"];

const DEFAULTS = {
	provider: "mze-claude",
	model: "claude-opus-5-5",
	reasoningEffort: "high",
	reviewProvider: "mze-claude",
	reviewModel: "claude-sonnet-5-5",
	reviewReasoningEffort: "medium",
	maxTokens: 4096,
	maxBriefChars: 6000,
	maxEvidenceChars: 24000,
	maxChangesChars: 24000,
};

const outputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		role: { type: "string" },
		provider: { type: "string" },
		model: { type: "string" },
		advice: { type: "string" },
		truncated: { type: "boolean" },
		inputTokens: { type: "integer" },
		outputTokens: { type: "integer" },
	},
	required: ["role", "provider", "model", "advice", "truncated"],
};

function positiveInt(value, fallback, cap) {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.min(Math.floor(parsed), cap);
}

function requiredText(value, label) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value.trim();
}

function boundedText(value, label, maxChars) {
	const text = requiredText(value, label);
	if (text.length > maxChars) {
		throw new Error(`${label} is ${text.length} characters and exceeds the ${maxChars} limit. Shorten it and call again; do not ask Claude to read the repository.`);
	}
	return text;
}

function textField(source, key, fallback) {
	const value = source[key];
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function resolveTarget(config) {
	const source = config && typeof config === "object" ? config : {};
	return {
		provider: textField(source, "provider", DEFAULTS.provider),
		model: textField(source, "model", DEFAULTS.model),
		reasoningEffort: textField(source, "reasoningEffort", DEFAULTS.reasoningEffort),
		reviewProvider: textField(source, "reviewProvider", DEFAULTS.reviewProvider),
		reviewModel: textField(source, "reviewModel", DEFAULTS.reviewModel),
		reviewReasoningEffort: textField(source, "reviewReasoningEffort", DEFAULTS.reviewReasoningEffort),
		maxTokens: positiveInt(source.maxTokens, DEFAULTS.maxTokens, 8192),
		maxBriefChars: positiveInt(source.maxBriefChars, DEFAULTS.maxBriefChars, 20000),
		maxEvidenceChars: positiveInt(source.maxEvidenceChars, DEFAULTS.maxEvidenceChars, 48000),
		maxChangesChars: positiveInt(source.maxChangesChars, DEFAULTS.maxChangesChars, 48000),
	};
}

function routeFor(target, role) {
	if (role === "review") {
		return {
			provider: target.reviewProvider,
			model: target.reviewModel,
			reasoningEffort: target.reviewReasoningEffort,
		};
	}
	return {
		provider: target.provider,
		model: target.model,
		reasoningEffort: target.reasoningEffort,
	};
}

function systemPrompt(role) {
	if (role === "review") {
		return [
			"You review code changes. You have no file access and must not ask for any.",
			"Use only the goal, evidence, and proposed changes in the user message.",
			"Report concrete defects: wrong behavior, missed edge cases, regressions, and tests still needed.",
			"Cite the file or snippet. Do not restyle, and do not request a rewrite unless the approach is wrong.",
			"If the change is acceptable, say so in one sentence and list residual risks.",
		].join(" ");
	}
	return [
		"You design a code change. You have no file access and must not ask for any.",
		"Use only the goal and evidence in the user message.",
		"Return a decision-complete design: approach, files to change, risks, and what not to do.",
		"Do not write full file contents unless a short snippet is necessary.",
		"If the evidence is insufficient, list the exact missing facts instead of guessing.",
	].join(" ");
}

function userPrompt(role, brief, evidence, changes) {
	const parts = [
		`Role: ${role}`,
		"",
		"Goal:",
		brief,
		"",
		"Evidence already read by the worker:",
		evidence,
	];
	if (changes !== undefined) {
		parts.push("", "Proposed changes:", changes);
	}
	return parts.join("\n");
}

async function collect(ctx, options) {
	let streamed = "";
	let ended = "";
	let usage;
	let finish;
	for await (const chunk of ctx.llm.stream(options)) {
		if (chunk.type === "text-delta") streamed += chunk.text;
		else if (chunk.type === "block-end" && chunk.block && chunk.block.type === "text") ended += chunk.block.text;
		else if (chunk.type === "usage") usage = chunk.usage;
		else if (chunk.type === "finish") finish = chunk.reason;
	}
	const text = streamed.trim().length > 0 ? streamed.trim() : ended.trim();
	return { text, usage, finish };
}

function integerToken(value) {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

function finishFailure(finish) {
	if (finish === undefined) return "Claude returned no finish reason";
	if (finish.kind === "error" || finish.kind === "aborted") {
		return finish.failure && finish.failure.message ? finish.failure.message : `Claude call ${finish.kind}`;
	}
	return undefined;
}

async function callClaude(ctx, target, prompt, signal, sessionId) {
	const base = {
		provider: target.provider,
		model: target.model,
		messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
		system: systemPrompt(target.role),
		maxTokens: target.maxTokens,
		...sessionId === undefined ? {} : { sessionId },
		...signal === undefined ? {} : { signal },
	};
	try {
		return await collect(ctx, { ...base, reasoningEffort: target.reasoningEffort });
	} catch (error) {
		if (signal && signal.aborted) throw error;
		const message = error instanceof Error ? error.message : String(error);
		if (!/effort|reasoning/i.test(message)) throw error;
		return await collect(ctx, base);
	}
}

function clip(text, max) {
	if (typeof text !== "string") return "";
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n...[truncated]`;
}

function changeText(name, args, value) {
	const path = value && typeof value.path === "string" ? value.path : args && args.file_path;
	if (name === "edit") {
		return [
			`FILE ${path}`,
			"OLD:",
			clip(args && args.old_string, 4000),
			"NEW:",
			clip(args && args.new_string, 4000),
		].join("\n");
	}
	return [
		`FILE ${path}`,
		`OPERATION ${value && value.operation ? value.operation : "write"}`,
		"CONTENT:",
		clip(args && args.content, 6000),
	].join("\n");
}

function reviewMessage(text) {
	return {
		id: randomUUID(),
		role: "user",
		content: [{ type: "text", text }],
		source: { kind: "claude-review" },
	};
}

function installAutoReview(ctx, target) {
	const pending = new Map();
	const reviewed = new Map();
	ctx.on("tools/result", (exec, result) => {
		if (!exec || !exec.agent || result && result.isError) return;
		if (exec.name !== "edit" && exec.name !== "write") return;
		const id = exec.agent.id;
		const batch = pending.get(id) ?? [];
		batch.push(changeText(exec.name, exec.arguments, result && result.value));
		if (batch.join("\n\n").length > target.maxChangesChars) batch.shift();
		pending.set(id, batch);
	});
	ctx.on("agent/turn-stopping", async ({ agent, turn, signal }) => {
		const batch = pending.get(agent.id);
		if (!batch || batch.length === 0) return;
		pending.delete(agent.id);
		const count = reviewed.get(agent.id);
		const used = count && count.turn === turn ? count.used : 0;
		if (used >= 2) return;
		reviewed.set(agent.id, { turn, used: used + 1 });
		const route = routeFor(target, "review");
		let advice;
		try {
			const result = await callClaude(ctx, {
				...target,
				...route,
				role: "review",
			}, userPrompt("review", "Review the file changes made in this turn. Reply in Chinese.", "The worker already applied these edits with the session model.", batch.join("\n\n---\n\n")), signal, agent.session && agent.session.id);
			const failure = finishFailure(result.finish);
			if (failure !== undefined) throw new Error(failure);
			advice = result.text || "Claude returned no advice";
		} catch (error) {
			advice = `检查调用失败：${error instanceof Error ? error.message : String(error)}`;
		}
		const last = used + 1 >= 2 ? "这是本轮最后一次自动检查。" : "同一轮最多自动检查两次。";
		agent.steer(reviewMessage([
			`[自动检查 / ${route.provider}/${route.model} / ${route.reasoningEffort}]`,
			last,
			"只修下面指出的具体问题。如果它认为可以接受，向用户汇报，不要再改文件。",
			"",
			advice,
		].join("\n")));
	});
	ctx.on("agent/disposed", ({ agent }) => {
		pending.delete(agent.id);
		reviewed.delete(agent.id);
	});
}

function apply(ctx, config) {
	const target = resolveTarget(config);
	installAutoReview(ctx, target);
	ctx.tools.register({
		name: "consult_claude",
		description: "Send a finished change to the fixed Claude Sonnet medium reviewer. Claude has no file tools. Read, design, and edit with the current session model first, then pass the diff in changes. role must be review. Never use this tool to read or edit files.",
		timeoutMs: 180000,
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				role: {
					type: "string",
					enum: ["review"],
					description: "Must be review. Design and edits stay with the current session model.",
				},
				brief: {
					type: "string",
					description: "The user goal, constraints, and the exact question for Claude.",
				},
				evidence: {
					type: "string",
					description: "Code excerpts and facts you already read, with file paths. Do not ask Claude to open the repository.",
				},
				changes: {
					type: "string",
					description: "Required for review: the diff or a precise change summary. Omit for design.",
				},
			},
			required: ["role", "brief", "evidence", "changes"],
		},
		output: {
			schema: outputSchema,
			render(_args, value) {
				const usage = value.inputTokens === undefined
					? ""
					: `\n\n[${value.provider}/${value.model}, in ${value.inputTokens}, out ${value.outputTokens ?? 0}${value.truncated ? ", truncated" : ""}]`;
				return [{ type: "text", text: value.advice + usage }];
			},
		},
		async execute(args, exec) {
			const role = args && args.role;
			if (role !== "review") throw new Error("role must be review. Design and edits stay with the current session model.");
			const brief = boundedText(args.brief, "brief", target.maxBriefChars);
			const evidence = boundedText(args.evidence, "evidence", target.maxEvidenceChars);
			const changes = boundedText(args.changes, "changes", target.maxChangesChars);
			const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : undefined;
			const signal = exec ? exec.signal : undefined;
			const route = routeFor(target, role);
			const result = await callClaude(ctx, { ...target, ...route, role }, userPrompt(role, brief, evidence, changes), signal, sessionId);
			const failure = finishFailure(result.finish);
			if (failure !== undefined) throw new Error(failure);
			if (result.text.length === 0) throw new Error("Claude returned no advice");
			const truncated = result.finish !== undefined && result.finish.kind === "max-tokens";
			const inputTokens = integerToken(result.usage && result.usage.inputTokens);
			const outputTokens = integerToken(result.usage && result.usage.outputTokens);
			return {
				role,
				provider: route.provider,
				model: route.model,
				advice: truncated ? `${result.text}\n\n[truncated by max tokens; ask a narrower question if this is incomplete]` : result.text,
				truncated,
				...inputTokens === undefined ? {} : { inputTokens },
				...outputTokens === undefined ? {} : { outputTokens },
			};
		},
	});
}

export { apply, inject, name };
