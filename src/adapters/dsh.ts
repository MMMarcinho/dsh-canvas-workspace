import type { Context } from "@deepseek-ai/cordis";
import type {
  SessionBinding,
  SessionEventLike,
  SessionEventWindow,
  SessionReference,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller/types";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
  AgentAdapter,
  AgentConversationTurn,
  AgentRun,
  AgentSessionSnapshot,
  UserMessageAttachment,
} from "../core/types";
import { composePrompt } from "../core/workspace";

declare module "@deepseek-ai/dsh-api-session-controller/client" {
  interface SessionReferenceSourceMap {
    canvas: unknown;
  }
}

/** Observation deadline only; elapsed time never establishes successful completion. */
export interface DshAdapterOptions {
  settlementTimeoutMs?: number;
}

type StepText = {
  attempt?: string;
  blocks: Map<number, string>;
  reasoningBlocks: Map<number, string>;
  final?: string;
  finalReasoning?: string;
  finalTime?: number;
  finalSeq?: number;
  interrupted?: boolean;
};
const emptyStep = (): StepText => ({
  blocks: new Map(),
  reasoningBlocks: new Map(),
});
const joinedBlocks = (blocks: Map<number, string>) =>
  [...blocks]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text)
    .join("");
const joinedSteps = (steps: StepText[], kind: "body" | "reasoning") =>
  steps
    .map((step) =>
      kind === "body"
        ? (step.final ?? joinedBlocks(step.blocks))
        : (step.finalReasoning ?? joinedBlocks(step.reasoningBlocks)),
    )
    .filter(Boolean)
    .join("\n\n");
const UNKNOWN_OUTCOME =
  "DSH 连接或事件观察已中断，执行结果未知。请打开原 DSH 会话核对，不要直接重复提交。";
const NEEDS_INTERACTION =
  "此任务需要权限确认、回答问题或审阅计划。画布 v0.1 不代替你批准；请打开原 DSH 会话查看并继续。";

/** One prompt's retained binding and exact RPC-to-turn ownership. */
class CanvasRun {
  private readonly admission = new AbortController();
  private reference?: SessionReference;
  private binding?: SessionBinding;
  private requestId?: SessionRequestId;
  private currentTurn?: number;
  private ownedTurn?: number;
  private ended = false;
  private completedTurn = false;
  private settled = false;
  private submitted = false;
  private observedRunning = false;
  private stopping?: Promise<void>;
  private stopReason?: Error;
  private readonly foreignTurns = new Set<number>();
  private generation?: number;
  private lastRevision = 0;
  private watermark = -1;
  // Settlement publication is not journal ordered. In particular, a durable
  // assistant message can arrive after the later-sequenced turn/end.
  private readonly seenEvents = new Set<string>();
  private readonly turnSteps = new Map<number, Set<number>>();
  private output = "";
  private publishedReasoning = "";
  private firstLiveTime?: number;
  private publishedTime?: number;
  private publishedDurable = false;
  private publishedTurn?: number;
  private readonly steps = new Map<number, StepText>();
  private readonly cleanup: (() => void)[] = [];
  private gapTimer?: ReturnType<typeof setTimeout>;
  private resolve!: () => void;
  private reject!: (error: Error) => void;
  private readonly completion = new Promise<void>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });

  constructor(
    private readonly ctx: Context,
    private readonly connection: ConnectionHandle,
    private readonly input: AgentRun,
    private readonly grace: number,
  ) {
    // A setup cancellation can precede execute() reaching its await.
    void this.completion.catch(() => {});
  }

  async execute(): Promise<void> {
    const { sessionId, signal } = this.input;
    const onAbort = () => {
      void this.stop(new Error("已停止画布任务"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    this.cleanup.push(() => signal.removeEventListener("abort", onAbort));
    try {
      signal.throwIfAborted();
      this.admission.signal.throwIfAborted();
      this.generation = this.connection.generation.getSnapshot()?.id;
      if (this.generation === undefined)
        throw new Error("DSH 尚未连接，请连接后重试");
      this.reference = this.ctx.sessions.retain(sessionId as SessionId, {
        source: "canvas",
        signal: this.admission.signal,
      });
      this.binding = await this.reference.ready;
      this.admission.signal.throwIfAborted();
      const { session, eventSource } = this.binding;
      const initial = session.getSnapshot();
      if (initial.openState !== "open")
        throw new Error(initial.openError?.message ?? "无法读取 DSH 会话");
      if (initial.running || initial.pendingSubmissions.length > 0) {
        throw new Error(
          "此 DSH 会话正在运行或等待提交，画布不会接管或停止其他任务",
        );
      }
      if (initial.subagent !== null)
        throw new Error("画布 v0.1 只支持独立 DSH 会话");
      if (
        this.ctx.uiSession.sessionStatus
          .getSnapshot()
          .get(sessionId as SessionId)?.pendingInteraction
      ) {
        throw new Error("此会话正在等待交互，请先在原 DSH 会话处理");
      }
      const initialWindow = eventSource.getSnapshot();
      this.lastRevision = initialWindow.revision;
      for (const entry of initialWindow.entries) {
        if (entry.type === "event")
          this.watermark = Math.max(this.watermark, entry.event.seq);
      }
      const oldError = initial.lastAgentError;
      const oldPromptError = initial.promptError;
      this.cleanup.push(eventSource.subscribe(() => this.observeEvents()));
      this.cleanup.push(
        session.subscribe(() => {
          if (this.settled || !this.submitted || this.stopReason !== undefined)
            return;
          const state = session.getSnapshot();
          if (state.removed || state.openState !== "open")
            return this.fail(new Error(UNKNOWN_OUTCOME));
          if (
            state.lastAgentError !== null &&
            state.lastAgentError !== oldError
          ) {
            return this.fail(new Error(state.lastAgentError));
          }
          if (
            state.promptError !== null &&
            state.promptError !== oldPromptError
          ) {
            return this.fail(
              new Error(
                `${state.promptError.error.code}: ${state.promptError.error.message}`,
              ),
            );
          }
          if (state.running) {
            this.observedRunning = true;
            if (!this.ended) this.clearGap();
          } else if (
            this.observedRunning &&
            !this.ended &&
            this.gapTimer === undefined
          ) {
            this.gapTimer = setTimeout(
              () => this.fail(new Error(UNKNOWN_OUTCOME)),
              this.grace,
            );
          }
        }),
      );
      this.cleanup.push(
        this.connection.generation.subscribe(() => {
          if (this.connection.generation.getSnapshot()?.id !== this.generation)
            this.fail(new Error(UNKNOWN_OUTCOME));
        }),
      );
      this.cleanup.push(
        this.ctx.uiSession.sessionStatus.subscribe(() => {
          if (!this.submitted || this.settled) return;
          if (
            this.ctx.uiSession.sessionStatus
              .getSnapshot()
              .get(sessionId as SessionId)?.pendingInteraction
          ) {
            void this.stop(new Error(NEEDS_INTERACTION));
          }
        }),
      );
      if (this.connection.generation.getSnapshot()?.id !== this.generation)
        throw new Error(UNKNOWN_OUTCOME);
      const prompt = composePrompt(this.input.prompt, this.input.context);
      const submission = session.beginSubmission({
        mode: "queue",
        text: prompt,
        attachments: [],
      });
      this.requestId = submission.requestId;
      if (this.admission.signal.aborted) {
        submission.abandon();
        this.admission.signal.throwIfAborted();
      }
      this.submitted = true;
      // All observers are attached before admission. Acceptance is not completion.
      void session
        .prompt(
          [{ type: "text", text: prompt }],
          "queue",
          this.admission.signal,
          submission.requestId,
        )
        .then(
          (result) => {
            if (!result.ok && this.stopReason === undefined)
              this.fail(
                new Error(`${result.error.code}: ${result.error.message}`),
              );
          },
          (error) => {
            if (this.stopReason === undefined) this.fail(asError(error));
          },
        );
      await this.completion;
    } finally {
      this.clearGap();
      for (const cleanup of this.cleanup.splice(0)) cleanup();
      this.reference?.release();
    }
  }

  /** Cancel only a current turn correlated with this adapter's submitted RPC. */
  stop(reason: Error): Promise<void> {
    if (this.stopping !== undefined) return this.stopping;
    if (this.settled) return Promise.resolve();
    this.stopReason = reason;
    this.admission.abort(reason);
    this.stopping = (async () => {
      let error = reason;
      const ownsCurrent =
        this.ownedTurn !== undefined &&
        this.currentTurn === this.ownedTurn &&
        !this.foreignTurns.has(this.ownedTurn) &&
        !this.ended;
      if (
        ownsCurrent &&
        this.binding !== undefined &&
        this.connection.generation.getSnapshot()?.id === this.generation
      ) {
        try {
          const result = await this.binding.session.cancel();
          error = result.ok
            ? new Error(
                `${reason.message}\n已请求停止本次任务；请在原 DSH 会话核对。`,
              )
            : new Error(
                `${reason.message}\n停止未确认：${result.error.message}。请在原 DSH 会话核对。`,
              );
        } catch (failure) {
          error = new Error(
            `${reason.message}\n停止未确认：${asError(failure).message}。请在原 DSH 会话核对。`,
          );
        }
      } else if (this.submitted && !this.ended) {
        error = new Error(
          `${reason.message}\n尚未确认本次输入对应的运行，未停止其他任务。请在原 DSH 会话核对待处理输入。`,
        );
      }
      this.fail(error);
    })();
    return this.stopping;
  }

  private observeEvents(): void {
    if (this.settled || !this.submitted || this.binding === undefined) return;
    const window = this.binding.eventSource.getSnapshot();
    if (window.revision === this.lastRevision) return;
    if (
      window.revision !== this.lastRevision + 1 ||
      window.change.kind === "replace"
    ) {
      return this.fail(new Error(UNKNOWN_OUTCOME));
    }
    this.lastRevision = window.revision;
    const change = window.change;
    if (change.kind === "prepend") return;
    const entries =
      change.kind === "append"
        ? change.entries
        : change.entry === undefined
          ? []
          : [change.entry];
    try {
      for (const { event } of entries) this.observeEvent(event);
      // An abandoned transient attempt has no durable replacement.
      if (change.kind === "settle-assistant" && change.entry === undefined) {
        for (const [step, value] of this.steps) {
          if (value.attempt === change.attemptId && value.final === undefined)
            this.steps.set(step, emptyStep());
        }
      }
      this.publishText();
      this.completeAfterDurableText();
    } catch (error) {
      void this.stop(asError(error));
    }
  }

  private observeEvent(event: SessionEventLike): void {
    if (this.settled) return;
    if (event.seq <= this.watermark) return;
    const key =
      event.type === "assistant/live-chunk"
        ? `live:${event.data.attemptId}:${event.seq}`
        : `event:${event.seq}`;
    if (this.seenEvents.has(key)) return;
    this.seenEvents.add(key);
    if (event.type === "turn/start") this.currentTurn = event.data.turn;
    if (event.type === "step/start" || event.type === "step/end") {
      const { turn, step } = event.data;
      let steps = this.turnSteps.get(turn);
      if (steps === undefined) this.turnSteps.set(turn, (steps = new Set()));
      steps.add(step);
      if (turn === this.ownedTurn && !this.steps.has(step))
        this.steps.set(step, emptyStep());
    }
    if (event.type === "user/message" && event.data.source.kind === "user") {
      if (
        "rpcId" in event.data.source &&
        event.data.source.rpcId === this.requestId
      ) {
        if (this.currentTurn === undefined)
          return this.fail(new Error(UNKNOWN_OUTCOME));
        if (this.ownedTurn !== undefined && this.ownedTurn !== this.currentTurn)
          return this.fail(new Error(UNKNOWN_OUTCOME));
        this.ownedTurn = this.currentTurn;
        // DSH emits step/start before it admits the identified user/message.
        for (const step of this.turnSteps.get(this.ownedTurn) ?? []) {
          if (!this.steps.has(step)) this.steps.set(step, emptyStep());
        }
      } else if (this.currentTurn !== undefined)
        this.foreignTurns.add(this.currentTurn);
      if (
        this.ownedTurn !== undefined &&
        this.foreignTurns.has(this.ownedTurn)
      ) {
        return this.fail(
          new Error(
            "检测到同一轮中的其他输入。画布不会停止共享运行，请在原 DSH 会话核对结果。",
          ),
        );
      }
    }
    if (this.ownedTurn === undefined) return;
    if (
      event.type === "assistant/live-chunk" &&
      event.data.turn === this.ownedTurn
    ) {
      const { step, attemptId, chunk } = event.data;
      let value = this.steps.get(step);
      if (value?.final !== undefined) return;
      if (value === undefined || value.attempt !== attemptId) {
        value = { ...emptyStep(), attempt: attemptId };
        this.steps.set(step, value);
      }
      if (chunk.type === "text-delta")
        value.blocks.set(
          chunk.index,
          (value.blocks.get(chunk.index) ?? "") + chunk.text,
        );
      if (chunk.type === "reasoning-delta")
        value.reasoningBlocks.set(
          chunk.index,
          (value.reasoningBlocks.get(chunk.index) ?? "") + chunk.text,
        );
      if (chunk.type === "block-end" && chunk.block.type === "text")
        value.blocks.set(chunk.index, chunk.block.text);
      if (chunk.type === "block-end" && chunk.block.type === "reasoning")
        value.reasoningBlocks.set(chunk.index, chunk.block.text);
      if (this.firstLiveTime === undefined) this.firstLiveTime = event.time;
    } else if (
      event.type === "assistant/message" &&
      event.data.turn === this.ownedTurn &&
      event.surfaceOp === "append"
    ) {
      const previous = this.steps.get(event.data.step);
      if (previous?.finalSeq !== undefined && previous.finalSeq >= event.seq)
        return;
      this.steps.set(event.data.step, {
        ...emptyStep(),
        final: event.data.message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n"),
        finalReasoning: event.data.message.content
          .flatMap((block) => (block.type === "reasoning" ? [block.text] : []))
          .join("\n\n"),
        finalTime: event.time,
        finalSeq: event.seq,
        interrupted: event.data.interrupted === true,
      });
    } else if (
      event.type === "assistant/attempt" &&
      event.data.turn === this.ownedTurn
    ) {
      if (this.steps.get(event.data.step)?.final === undefined)
        this.steps.set(event.data.step, emptyStep());
    } else if (
      event.type === "turn/end" &&
      event.data.turn === this.ownedTurn
    ) {
      this.ended = true;
      if (this.stopReason !== undefined) return;
      const reason = event.data.reason;
      if (reason.kind === "completed") {
        // DSH buffers assistant/message while a live attempt is active. Its
        // append/settle-assistant can arrive *after* the durable turn/end.
        // Keep observing until every entered step has a durable final message.
        if (!this.completedTurn) {
          this.completedTurn = true;
          this.clearGap();
          this.gapTimer = setTimeout(
            () => this.fail(new Error(UNKNOWN_OUTCOME)),
            this.grace,
          );
        }
      } else if (reason.kind === "error")
        this.fail(new Error(`${reason.error.code}: ${reason.error.message}`));
      else
        this.fail(
          new Error(`DSH 任务未正常完成（${reason.kind}），请打开原会话查看`),
        );
    }
  }

  private completeAfterDurableText(): void {
    if (!this.completedTurn || this.settled || this.stopReason !== undefined)
      return;
    // A completed turn without a settled assistant message is not proof that
    // the provisional output is complete. Do not persist a truncated reply.
    if (
      this.steps.size === 0 ||
      [...this.steps.values()].some(
        (step) => step.final === undefined || step.interrupted === true,
      )
    )
      return;
    this.settled = true;
    this.clearGap();
    this.resolve();
  }

  private publishText(): void {
    const ordered = [...this.steps]
      .sort(([a], [b]) => a - b)
      .map(([, step]) => step);
    const text = joinedSteps(ordered, "body");
    const reasoning = joinedSteps(ordered, "reasoning");
    const finalTimes = [...this.steps.values()]
      .map((step) => step.finalTime)
      .filter((value): value is number => value !== undefined);
    const durable =
      this.steps.size > 0 &&
      [...this.steps.values()].every(
        (step) => step.final !== undefined && step.interrupted !== true,
      );
    const timestamp =
      finalTimes.length > 0 ? Math.max(...finalTimes) : this.firstLiveTime;
    if (
      text === this.output &&
      reasoning === this.publishedReasoning &&
      timestamp === this.publishedTime &&
      durable === this.publishedDurable &&
      this.ownedTurn === this.publishedTurn
    )
      return;
    this.output = text;
    this.publishedReasoning = reasoning;
    this.publishedTime = timestamp;
    this.publishedDurable = durable;
    this.publishedTurn = this.ownedTurn;
    this.input.onText(text, {
      reasoning,
      timestamp,
      durable,
      turnId: this.ownedTurn,
      requestId: this.requestId,
    });
  }

  private clearGap(): void {
    if (this.gapTimer !== undefined) clearTimeout(this.gapTimer);
    this.gapTimer = undefined;
  }
  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.clearGap();
    this.admission.abort(error);
    this.reject(error);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Rebuild from authoritative history, not canvas cache or prompt similarity. */
function conversationTurns(
  window: SessionEventWindow,
): AgentConversationTurn[] {
  type Turn = {
    value: AgentConversationTurn;
    steps: Map<number, StepText>;
    firstLiveTime?: number;
    end?: Extract<SessionEventLike, { type: "turn/end" }>;
  };
  const turns = new Map<number, Turn>();
  const seen = new Set<string>();
  let currentTurn: number | undefined;
  // Successful settlement can be appended after later journal records. Sorting
  // restores the user-message turn context without dropping late durable text.
  for (const { event } of [...window.entries].sort(
    (a, b) => a.event.seq - b.event.seq,
  )) {
    const key =
      event.type === "assistant/live-chunk"
        ? `live:${event.data.attemptId}:${event.seq}`
        : `event:${event.seq}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (event.type === "turn/start") {
      currentTurn = event.data.turn;
      turns.set(currentTurn, {
        value: {
          turnId: currentTurn,
          userMessages: [],
          body: "",
          durable: false,
          status: "running",
        },
        steps: new Map(),
      });
      continue;
    }
    if (event.type === "user/message") {
      const turn =
        currentTurn === undefined ? undefined : turns.get(currentTurn);
      if (
        turn !== undefined &&
        event.surfaceOp === "append" &&
        event.data.source.kind === "user"
      ) {
        const text = event.data.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n");
        const media = event.data.content.flatMap(
          (block): UserMessageAttachment[] =>
            block.type === "image"
              ? [
                  {
                    type: "image" as const,
                    image: { attachment: block.attachment },
                  },
                ]
              : block.type === "file"
                ? [{ type: "file" as const, file: block.attachment }]
                : [],
        );
        // Native-style attachment cards use durable refs, never synthetic text.
        turn.value.userMessages.push({
          id: event.data.id,
          ...("rpcId" in event.data.source &&
          typeof event.data.source.rpcId === "string"
            ? { requestId: event.data.source.rpcId }
            : {}),
          text,
          ...(media.length ? { attachments: media } : {}),
          timestamp: event.time,
        });
      }
      continue;
    }
    if (
      !(
        event.type === "step/start" ||
        event.type === "step/end" ||
        event.type === "assistant/live-chunk" ||
        event.type === "assistant/message" ||
        event.type === "assistant/attempt" ||
        event.type === "turn/end"
      )
    )
      continue;
    const turn = turns.get(event.data.turn);
    // The oldest visible turn may be partial. Do not import it as a full reply.
    if (turn === undefined) continue;
    if (event.type === "turn/end") {
      turn.end = event;
      continue;
    }
    const step = event.data.step;
    if (event.type === "step/start" || event.type === "step/end") {
      if (!turn.steps.has(step)) turn.steps.set(step, emptyStep());
    } else if (
      event.type === "assistant/message" &&
      event.surfaceOp === "append"
    ) {
      turn.steps.set(step, {
        ...emptyStep(),
        final: event.data.message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n"),
        finalReasoning: event.data.message.content
          .flatMap((block) => (block.type === "reasoning" ? [block.text] : []))
          .join("\n\n"),
        finalTime: event.time,
        finalSeq: event.seq,
        interrupted: event.data.interrupted === true,
      });
    } else if (event.type === "assistant/attempt") {
      if (turn.steps.get(step)?.final === undefined)
        turn.steps.set(step, emptyStep());
    } else if (event.type === "assistant/live-chunk") {
      const { attemptId, chunk } = event.data;
      let value = turn.steps.get(step);
      if (value?.final !== undefined) continue;
      if (value === undefined || value.attempt !== attemptId) {
        value = { ...emptyStep(), attempt: attemptId };
        turn.steps.set(step, value);
      }
      if (chunk.type === "text-delta")
        value.blocks.set(
          chunk.index,
          (value.blocks.get(chunk.index) ?? "") + chunk.text,
        );
      if (chunk.type === "reasoning-delta")
        value.reasoningBlocks.set(
          chunk.index,
          (value.reasoningBlocks.get(chunk.index) ?? "") + chunk.text,
        );
      if (chunk.type === "block-end" && chunk.block.type === "text")
        value.blocks.set(chunk.index, chunk.block.text);
      if (chunk.type === "block-end" && chunk.block.type === "reasoning")
        value.reasoningBlocks.set(chunk.index, chunk.block.text);
      turn.firstLiveTime ??= event.time;
    }
  }
  return [...turns.values()].map(({ value, steps, firstLiveTime, end }) => {
    const ordered = [...steps]
      .sort(([a], [b]) => a - b)
      .map(([, step]) => step);
    value.body = joinedSteps(ordered, "body");
    const reasoning = joinedSteps(ordered, "reasoning");
    if (reasoning) value.reasoning = reasoning;
    const times = ordered.flatMap((step) =>
      step.finalTime === undefined ? [] : [step.finalTime],
    );
    value.timestamp = times.length > 0 ? Math.max(...times) : firstLiveTime;
    value.durable =
      ordered.length > 0 &&
      ordered.every(
        (step) => step.final !== undefined && step.interrupted !== true,
      );
    const reason = end?.data.reason;
    if (reason?.kind === "completed" && value.durable) value.status = "done";
    else if (reason !== undefined && reason.kind !== "completed") {
      value.status = "error";
      value.error =
        reason.kind === "error"
          ? `${reason.error.code}: ${reason.error.message}`
          : `DSH 任务未正常完成（${reason.kind}），请打开原会话查看`;
    }
    return value;
  });
}

/** Independent read-only lifetime. It never submits, abandons, or cancels work. */
class CanvasSessionObserver {
  private stopped = false;
  private token = 0;
  private queued = false;
  private reference?: SessionReference;
  private binding?: SessionBinding;
  private bindingCleanup: (() => void)[] = [];
  private readonly unsubscribeGeneration: () => void;
  private snapshot: AgentSessionSnapshot;

  constructor(
    private readonly ctx: Context,
    private readonly connection: ConnectionHandle,
    private readonly sessionId: string,
    private readonly onSnapshot: (snapshot: AgentSessionSnapshot) => void,
  ) {
    this.snapshot = { sessionId, turns: [], hasMore: false };
    this.unsubscribeGeneration = connection.generation.subscribe(() =>
      this.connect(),
    );
    this.connect();
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.token++;
    this.unsubscribeGeneration();
    this.releaseBinding();
  }

  private releaseBinding(): void {
    for (const unsubscribe of this.bindingCleanup.splice(0)) unsubscribe();
    this.binding = undefined;
    this.reference?.release();
    this.reference = undefined;
  }

  private connect(): void {
    if (this.stopped) return;
    const token = ++this.token;
    this.releaseBinding();
    if (this.connection.generation.getSnapshot() === undefined) {
      this.publishError(UNKNOWN_OUTCOME);
      return;
    }
    try {
      const reference = this.ctx.sessions.retain(this.sessionId as SessionId, {
        source: "canvas",
      });
      this.reference = reference;
      void reference.ready.then(
        (binding) => {
          if (this.stopped || token !== this.token) return;
          this.binding = binding;
          this.bindingCleanup.push(
            binding.eventSource.subscribe(() => this.schedule()),
          );
          this.bindingCleanup.push(
            binding.session.subscribe(() => this.schedule()),
          );
          this.schedule();
        },
        (error) => {
          if (!this.stopped && token === this.token) {
            this.releaseBinding();
            this.publishError(asError(error).message);
          }
        },
      );
    } catch (error) {
      this.publishError(asError(error).message);
    }
  }

  private schedule(): void {
    if (this.stopped || this.queued) return;
    this.queued = true;
    // Let the run's synchronous RPC correlation publish onText.turnId first.
    // Coalesce notifications only; this is not a timed success heuristic.
    queueMicrotask(() => {
      this.queued = false;
      if (this.stopped || this.binding === undefined) return;
      const state = this.binding.session.getSnapshot();
      const window = this.binding.eventSource.getSnapshot();
      this.snapshot = {
        sessionId: this.sessionId,
        turns: conversationTurns(window),
        hasMore: window.hasMore,
        ...(state.removed || state.openState !== "open"
          ? { error: state.openError?.message ?? UNKNOWN_OUTCOME }
          : {}),
      };
      this.onSnapshot(this.snapshot);
    });
  }

  private publishError(error: string): void {
    this.snapshot = { ...this.snapshot, error };
    this.onSnapshot(this.snapshot);
  }
}

/** Root services only; canvas selection never changes an implicit current Agent. */
export function createDshAdapter(
  ctx: Context,
  options: DshAdapterOptions = {},
): AgentAdapter & { dispose(): void; openSession(sessionId: string): void } {
  const connection = ctx.get("connection") as ConnectionHandle;
  const active = new Map<string, CanvasRun>();
  const observers = new Set<CanvasSessionObserver>();
  let disposed = false;
  return {
    kind: "dsh",
    async createSession() {
      if (disposed) throw new Error("画布插件已关闭");
      return ctx.sessions.create();
    },
    async run(input) {
      if (disposed) throw new Error("画布插件已关闭");
      if (active.has(input.sessionId))
        throw new Error("这个 Agent 已在运行，请等待或停止");
      const run = new CanvasRun(
        ctx,
        connection,
        input,
        options.settlementTimeoutMs ?? 10_000,
      );
      active.set(input.sessionId, run);
      try {
        await run.execute();
      } finally {
        if (active.get(input.sessionId) === run) active.delete(input.sessionId);
      }
    },
    async cancel(sessionId) {
      await active.get(sessionId)?.stop(new Error("已停止画布任务"));
    },
    isSessionBusy(sessionId) {
      const snapshot = ctx.sessions
        .binding(sessionId as SessionId)
        ?.session.getSnapshot();
      const scope = ctx.sessions.scope(sessionId as SessionId);
      const inputPhase = scope
        ? ctx.conversation.input.for(scope).state.getSnapshot().phase
        : undefined;
      return Boolean(
        active.has(sessionId) ||
          (inputPhase && inputPhase !== "plain") ||
          snapshot?.running ||
          snapshot?.awaitingFirstTurn ||
          snapshot?.pendingSubmissions.length,
      );
    },
    openSession(sessionId) {
      ctx.uiWorkspace.openSession(sessionId as SessionId);
    },
    observeSession(sessionId, onSnapshot) {
      if (disposed) throw new Error("画布插件已关闭");
      const observer = new CanvasSessionObserver(
        ctx,
        connection,
        sessionId,
        onSnapshot,
      );
      observers.add(observer);
      return () => {
        observer.dispose();
        observers.delete(observer);
      };
    },
    dispose() {
      disposed = true;
      for (const observer of observers) observer.dispose();
      observers.clear();
      for (const run of active.values())
        void run.stop(new Error("画布插件已关闭"));
    },
  };
}
