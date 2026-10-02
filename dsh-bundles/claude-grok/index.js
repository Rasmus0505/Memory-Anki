const name = "claude-grok";
const inject = ["tools", "llm"];

const DEFAULTS = {
	provider: "mze-claude",
	model: "claude-opus-5-5",
	reasoningEffort: "high",
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

function resolveTarget(config) {
	const source = config && typeof config === "object" ? config : {};
	const provider = typeof source.provider === "string" && source.provider.trim() ? source.provider.trim() : DEFAULTS.provider;
	const model = typeof source.model === "string" && source.model.trim() ? source.model.trim() : DEFAULTS.model;
	const reasoningEffort = typeof source.reasoningEffort === "string" && source.reasoningEffort.trim()
		? source.reasoningEffort.trim()
		: DEFAULTS.reasoningEffort;
	return {
		provider,
		model,
		reasoningEffort,
		maxTokens: positiveInt(source.maxTokens, DEFAULTS.maxTokens, 8192),
		maxBriefChars: positiveInt(source.maxBriefChars, DEFAULTS.maxBriefChars, 20000),
		maxEvidenceChars: positiveInt(source.maxEvidenceChars, DEFAULTS.maxEvidenceChars, 48000),
		maxChangesChars: positiveInt(source.maxChangesChars, DEFAULTS.maxChangesChars, 48000),
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

function apply(ctx, config) {
	const target = resolveTarget(config);
	ctx.tools.register({
		name: "consult_claude",
		description: "Ask Claude for a design or a review. Claude is expensive and has no file tools. Read the code yourself first, then pass only the needed excerpts. Use role=design before a non-trivial change. Use role=review after you edit, with the diff in changes. Never use this tool to read or edit files.",
		timeoutMs: 180000,
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				role: {
					type: "string",
					enum: ["design", "review"],
					description: "design before a non-trivial change; review after you have edited.",
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
			required: ["role", "brief", "evidence"],
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
			if (role !== "design" && role !== "review") throw new Error("role must be design or review");
			const brief = boundedText(args.brief, "brief", target.maxBriefChars);
			const evidence = boundedText(args.evidence, "evidence", target.maxEvidenceChars);
			const changes = role === "review"
				? boundedText(args.changes, "changes", target.maxChangesChars)
				: undefined;
			if (role === "design" && typeof args.changes === "string" && args.changes.trim().length > 0) {
				throw new Error("omit changes for design; pass the diff only when role is review");
			}
			const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : undefined;
			const signal = exec ? exec.signal : undefined;
			const result = await callClaude(ctx, { ...target, role }, userPrompt(role, brief, evidence, changes), signal, sessionId);
			const failure = finishFailure(result.finish);
			if (failure !== undefined) throw new Error(failure);
			if (result.text.length === 0) throw new Error("Claude returned no advice");
			const truncated = result.finish !== undefined && result.finish.kind === "max-tokens";
			return {
				role,
				provider: target.provider,
				model: target.model,
				advice: truncated ? `${result.text}\n\n[truncated by max tokens; ask a narrower question if this is incomplete]` : result.text,
				truncated,
				...result.usage === undefined ? {} : {
					inputTokens: result.usage.inputTokens,
					outputTokens: result.usage.outputTokens,
				},
			};
		},
	});
}

export { apply, inject, name };
