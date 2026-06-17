import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { FileText, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import type {
  ReadingCompletionResponse,
  ReadingMaterial,
  ReadingSessionResult,
  ReadingVersion,
  SentenceAnnotation,
  SpanAnnotation,
} from "@/shared/api/contracts";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { SentenceLine } from "@/features/english-reading/components/EnglishReadingText";

type ReadingTimerState = {
  effectiveSeconds: number;
  idleSeconds: number;
  pauseCount: number;
  status: "idle" | "running" | "paused" | "completed";
  start: (options: { source: string }) => void;
  pause: (options: { source: string }) => void;
  resume: (options: { source: string }) => void;
  adjustDuration: (seconds: number) => void;
  reset: () => void;
};

export function EnglishReadingReadingPanels({
  versionLoading,
  material,
  version,
  readingPanelRef,
  readingContentRef,
  generating,
  timer,
  annotationMap,
  sentenceAnnotationMap,
  expandedSentenceIds,
  completionPanelOpen,
  completionSubmitting,
  completionResponse,
  onGeneratePendingMaterial,
  onOpenRegenerateDialog,
  onReadingContentPointerDown,
  onHoverAnnotation,
  onLookupWord,
  onToggleExpandedSentence,
  onToggleCompletionPanel,
  onCompleteReading,
  formatMinutes,
  summarizeFeedback,
}: {
  versionLoading: boolean;
  material: ReadingMaterial | null;
  version: ReadingVersion | null;
  readingPanelRef: RefObject<HTMLDivElement | null>;
  readingContentRef: RefObject<HTMLDivElement | null>;
  generating: boolean;
  timer: ReadingTimerState;
  annotationMap: Map<string, SpanAnnotation>;
  sentenceAnnotationMap: Map<string, SentenceAnnotation>;
  expandedSentenceIds: Set<string>;
  completionPanelOpen: boolean;
  completionSubmitting: ReadingSessionResult["feedback"] | null;
  completionResponse: ReadingCompletionResponse | null;
  onGeneratePendingMaterial: () => void;
  onOpenRegenerateDialog: () => void;
  onReadingContentPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onHoverAnnotation: (annotationId: string) => void;
  onLookupWord: (
    word: string,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onToggleExpandedSentence: (sentenceId: string) => void;
  onToggleCompletionPanel: () => void;
  onCompleteReading: (feedback: ReadingSessionResult["feedback"]) => void;
  formatMinutes: (seconds: number) => string;
  summarizeFeedback: (
    feedback: ReadingSessionResult["feedback"],
  ) => string;
}) {
  return (
    <>
      {versionLoading ? (
        <div className="flex min-h-[25vh] items-center justify-center text-sm text-muted-foreground">
          正在加载阅读面板...
        </div>
      ) : null}

      {material && !version && !versionLoading ? (
        <Card className="border-border/70 bg-card/95">
          <div ref={readingPanelRef} />
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{material.sourceType.toUpperCase()}</Badge>
              <Badge variant="outline">{material.wordCount} 词</Badge>
              <Badge variant="secondary">尚未生成阅读稿</Badge>
            </div>
            <CardTitle className="text-2xl">{material.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-3xl border border-dashed border-border/70 bg-background/60 px-5 py-6 text-sm text-muted-foreground">
              这篇材料已经进入阅读历史，但还没有生成可阅读版本。你可以直接继续生成，不需要重新上传。
            </div>
            <Button
              onClick={onGeneratePendingMaterial}
              disabled={generating}
              className="h-11 rounded-2xl px-5"
            >
              {generating ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              为这篇材料生成阅读稿
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {material && version ? (
        <Card className="overflow-hidden border-border/70 bg-card/95">
          <div ref={readingPanelRef} />
          <CardHeader className="space-y-4 border-b border-border/70 bg-card/90">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{material.sourceType.toUpperCase()}</Badge>
                  <Badge variant="secondary">目标 {version.targetCefr}</Badge>
                  <Badge variant="outline">{material.wordCount} 词</Badge>
                  {version.summary._resolvedAi?.reading_sentence_rewrite?.model_label ? (
                    <Badge variant="outline">
                      改写：
                      {version.summary._resolvedAi.reading_sentence_rewrite.model_label}
                    </Badge>
                  ) : null}
                  {version.summary._resolvedAi?.reading_lexical_resolution?.model_label ? (
                    <Badge variant="outline">
                      分级：
                      {version.summary._resolvedAi.reading_lexical_resolution.model_label}
                    </Badge>
                  ) : null}
                </div>
                <CardTitle className="text-2xl">{material.title}</CardTitle>
                <div className="text-sm text-muted-foreground">
                  黑色是舒适区，绿色是原文 i+1，黄色是升级表达，红色是降阶救援。
                </div>
              </div>
              <Button
                variant="outline"
                onClick={onOpenRegenerateDialog}
                disabled={generating}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                重新生成内容
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-4 sm:p-6">
            <div className="rounded-[32px] border border-border/70 bg-card/90 px-5 py-6 shadow-floating sm:px-8 sm:py-9">
              <div
                ref={readingContentRef}
                className="mx-auto max-w-4xl space-y-6 text-[1.05rem] leading-9 text-foreground selection:bg-info/10 selection:text-primary sm:text-[1.1rem]"
                onPointerDown={onReadingContentPointerDown}
              >
                {version.renderBlocks.map((block) => (
                  <div key={block.id} className="space-y-3">
                    {block.sentences.map((sentence) => (
                      <SentenceLine
                        key={sentence.id}
                        sentence={sentence}
                        sentenceAnnotation={sentenceAnnotationMap.get(
                          sentence.sentenceAnnotationId,
                        )}
                        annotationMap={annotationMap}
                        expanded={expandedSentenceIds.has(sentence.id)}
                        onHoverAnnotation={onHoverAnnotation}
                        onLookupWord={onLookupWord}
                        onToggleExpanded={() =>
                          onToggleExpandedSentence(sentence.id)
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>

              <div className="mx-auto mt-8 flex max-w-4xl flex-col gap-4 border-t border-border/80 pt-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    绿色 {version.summary.greenCount}
                  </span>
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    黄色 {version.summary.yellowCount}
                  </span>
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    红色 {version.summary.redCount}
                  </span>
                  <span className="rounded-full bg-white/90 px-3 py-1 shadow-sm">
                    句法重构 {version.summary.sentenceSimplifiedCount}
                  </span>
                </div>
                <Button size="lg" className="rounded-2xl px-7" onClick={onToggleCompletionPanel}>
                  我读完了
                </Button>
              </div>
            </div>

            {completionPanelOpen ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
                <Card className="border-border/70 bg-background/85">
                  <CardHeader>
                    <CardTitle className="text-base">本次阅读反馈</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                        <div className="text-xs text-muted-foreground">当前用时</div>
                        <div className="mt-2 text-lg font-semibold">
                          {formatMinutes(timer.effectiveSeconds)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                        <div className="text-xs text-muted-foreground">
                          已接触增长内容
                        </div>
                        <div className="mt-2 text-lg font-semibold">
                          {version.summary.greenCount + version.summary.yellowCount}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => onCompleteReading("too_easy")}
                        disabled={completionSubmitting !== null}
                      >
                        {completionSubmitting === "too_easy" ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        太简单
                      </Button>
                      <Button
                        onClick={() => onCompleteReading("just_right")}
                        disabled={completionSubmitting !== null}
                      >
                        {completionSubmitting === "just_right" ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        刚刚好
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => onCompleteReading("too_hard")}
                        disabled={completionSubmitting !== null}
                      >
                        {completionSubmitting === "too_hard" ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        有点难
                      </Button>
                    </div>
                    <div className="rounded-2xl border border-dashed border-border/70 px-4 py-4 text-sm text-muted-foreground">
                      系统会根据你的主观反馈、阅读速度、悬浮次数和句法展开次数，只校准下一篇材料的内部难度，不会突然把当前文章改掉。
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-background/85">
                  <CardHeader>
                    <CardTitle className="text-base">努力的痕迹</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {completionResponse ? (
                      <div className="space-y-3 text-sm">
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          本次阅读用时：
                          {formatMinutes(completionResponse.session.durationSeconds)}
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          阅读速度：{completionResponse.session.wordsPerMinute} 词/分钟
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          你与 {version.summary.greenCount + version.summary.yellowCount} 个
                          i+1 词汇进行了亲密接触，并无痛掠过了 {version.summary.redCount} 个超纲词。
                        </div>
                        <div className="rounded-2xl border border-success/20 bg-success/5 px-4 py-4 text-success">
                          本次反馈：
                          {summarizeFeedback(completionResponse.session.feedback)} · 获得{" "}
                          {completionResponse.session.xpAwarded} XP
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
                          当前等级：{completionResponse.profile.declaredCefr} · 升级进度{" "}
                          {completionResponse.profile.levelProgress}/100
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
                        选择一个反馈后，这里会出现本次阅读的温和回顾。
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!material && !versionLoading ? (
        <Card className="border-border/70 bg-card/95">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <div className="text-base font-medium">先导入一篇英文材料</div>
            <div className="max-w-xl text-sm text-muted-foreground">
              你可以先粘贴全文，或者上传 `txt / md / pdf`。系统会基于本地词典和 Qwen
              Flash，把它改造成真正能读进去的 i+1 阅读稿。
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
