import type {
  ChangeEventHandler,
  DragEventHandler,
  KeyboardEventHandler,
  RefObject,
} from "react";
import {
  BookOpenText,
  ExternalLink,
  FileText,
  LoaderCircle,
  PencilLine,
  Settings2,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import type { CefrLevel, ReadingMaterial, ReadingProfile } from "@/shared/api/contracts";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";

export function EnglishReadingProfileCard({
  cefrLevels,
  profile,
  profileSaving,
  onSelectLevel,
  formatWorkingBand,
}: {
  cefrLevels: CefrLevel[];
  profile: ReadingProfile;
  profileSaving: CefrLevel | null;
  onSelectLevel: (level: CefrLevel) => void;
  formatWorkingBand: (value: number) => string;
}) {
  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4" />
          建立我的 i
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {cefrLevels.map((level) => {
            const active = profile.declaredCefr === level;
            return (
              <button
                key={level}
                type="button"
                className={cn(
                  "rounded-lg border px-4 py-3 text-left transition-all",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-card"
                    : "border-border/70 bg-background/75 hover:border-border hover:bg-background",
                )}
                onClick={() => onSelectLevel(level)}
                disabled={profileSaving !== null}
              >
                <div className="text-[11px] uppercase tracking-[0.2em] opacity-70">
                  CEFR
                </div>
                <div className="mt-1.5 text-xl font-semibold">{level}</div>
                {profileSaving === level ? (
                  <div className="mt-1.5 text-xs opacity-80">更新中...</div>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border border-border/70 bg-background/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">升级进度</div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                当前等级 {profile.declaredCefr} · 距离下一等级{" "}
                {Math.max(0, 100 - profile.levelProgress)} XP
              </div>
            </div>
            <Badge variant="secondary">
              置信度 {Math.round(profile.confidence * 100)}%
            </Badge>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-info via-memory-strong to-success transition-all"
              style={{
                width: `${Math.max(0, Math.min(100, profile.levelProgress))}%`,
              }}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-card px-4 py-3">
              <div className="text-xs text-muted-foreground">词汇舒适区</div>
              <div className="mt-1.5 text-lg font-semibold">
                {formatWorkingBand(profile.workingLexicalI)}
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-card px-4 py-3">
              <div className="text-xs text-muted-foreground">句法舒适区</div>
              <div className="mt-1.5 text-lg font-semibold">
                {formatWorkingBand(profile.workingSyntacticI)}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function EnglishReadingGeneratorCard({
  textInput,
  onTextInputChange,
  fileInputRef,
  readingFileAccept,
  dropzoneActive,
  generating,
  selectedFile,
  sourceMode,
  visibleStage,
  generationProgress,
  onOpenAutomation,
  onOpenFilePicker,
  onDropzoneKeyDown,
  onDropzoneDragEnter,
  onDropzoneDragOver,
  onDropzoneDragLeave,
  onDropzoneDrop,
  onFileInputChange,
  onCreateAndGenerate,
}: {
  textInput: string;
  onTextInputChange: ChangeEventHandler<HTMLTextAreaElement>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  readingFileAccept: string;
  dropzoneActive: boolean;
  generating: boolean;
  selectedFile: File | null;
  sourceMode: "text" | "file";
  visibleStage: string;
  generationProgress: number;
  onOpenAutomation: () => void;
  onOpenFilePicker: () => void;
  onDropzoneKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onDropzoneDragEnter: DragEventHandler<HTMLDivElement>;
  onDropzoneDragOver: DragEventHandler<HTMLDivElement>;
  onDropzoneDragLeave: DragEventHandler<HTMLDivElement>;
  onDropzoneDrop: DragEventHandler<HTMLDivElement>;
  onFileInputChange: ChangeEventHandler<HTMLInputElement>;
  onCreateAndGenerate: () => void;
}) {
  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" />
            定制我的 i+1 材料
          </CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenAutomation}
          >
            <Settings2 className="mr-2 size-4" />
            自动化配置
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3.5">
        <Textarea
          value={textInput}
          onChange={onTextInputChange}
          placeholder="直接粘贴英文文章全文，或者上传 txt / md / pdf 文件。"
          className="min-h-[170px] resize-y rounded-lg bg-background/70 px-4 py-4 text-[15px] leading-6.5"
        />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div
            role="button"
            tabIndex={0}
            aria-label="拖动或选择阅读文件"
            data-testid="reading-file-dropzone"
            className={cn(
              "rounded-lg border border-dashed px-5 py-4 text-left transition-all",
              dropzoneActive
                ? "border-info/50 bg-info/5 shadow-popover"
                : "border-border/70 bg-background/65 hover:border-border hover:bg-background",
              generating ? "cursor-not-allowed opacity-70" : "cursor-pointer",
            )}
            onClick={onOpenFilePicker}
            onKeyDown={onDropzoneKeyDown}
            onDragEnter={onDropzoneDragEnter}
            onDragOver={onDropzoneDragOver}
            onDragLeave={onDropzoneDragLeave}
            onDrop={onDropzoneDrop}
          >
            <Input
              ref={fileInputRef}
              type="file"
              accept={readingFileAccept}
              className="sr-only"
              tabIndex={-1}
              onChange={onFileInputChange}
            />
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors",
                  dropzoneActive
                    ? "border-info/30 bg-info/10 text-info"
                    : "border-border/70 bg-card text-muted-foreground",
                )}
              >
                <FileText className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-primary">
                  拖动 `txt / md / pdf` 到这里，或点击选择文件
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {sourceMode === "file" && selectedFile
                    ? "当前将按文件导入生成。继续编辑上方正文可切回粘贴导入。"
                    : "你也可以完全不上传文件，直接粘贴英文正文开始生成。"}
                </div>
                {selectedFile ? (
                  <div className="mt-3 inline-flex max-w-full items-center rounded-full border border-border/70 bg-card px-3 py-1 text-sm text-muted-foreground">
                    <span className="truncate">已选择文件：{selectedFile.name}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <Button
            onClick={onCreateAndGenerate}
            disabled={generating}
            className="h-11 rounded-lg px-5"
          >
            {generating ? (
              <LoaderCircle className="mr-2 size-4 animate-spin" />
            ) : (
              <BookOpenText className="mr-2 size-4" />
            )}
            开始定制我的 i+1 材料
          </Button>
        </div>
        {generating ? (
          <div className="rounded-lg border border-info/20 bg-info/5 px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-info">
              <LoaderCircle className="size-4 animate-spin" />
              {visibleStage}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-info/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-info to-primary transition-all"
                style={{ width: `${generationProgress}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/60 px-4 py-4 text-sm text-muted-foreground">
            当前支持手动粘贴，以及点击或拖动上传 `txt / md / pdf`。生成时会优先使用本地
            CEFR 词典，不认识的词形再交给 Qwen Flash 补洞。
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EnglishReadingRecentMaterialsCard({
  recentMaterials,
  activeMaterialId,
  openingMaterialId,
  renamingMaterialId,
  deletingMaterialId,
  onOpenRecentMaterial,
  onRenameRecentMaterial,
  onDeleteRecentMaterial,
}: {
  recentMaterials: ReadingMaterial[];
  activeMaterialId: number | null | undefined;
  openingMaterialId: number | null;
  renamingMaterialId: number | null;
  deletingMaterialId: number | null;
  onOpenRecentMaterial: (item: ReadingMaterial) => void;
  onRenameRecentMaterial: (item: ReadingMaterial) => void;
  onDeleteRecentMaterial: (item: ReadingMaterial) => void;
}) {
  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">最近阅读材料</CardTitle>
        <div className="text-xs text-muted-foreground">
          点击一条会直接打开这篇材料的最近阅读版本
        </div>
      </CardHeader>
      <CardContent>
        {recentMaterials.length > 0 ? (
          <div className="space-y-3">
            {recentMaterials.map((item) => {
              const active = activeMaterialId === item.id;
              const busy =
                openingMaterialId === item.id ||
                renamingMaterialId === item.id ||
                deletingMaterialId === item.id;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-lg border transition-all",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-soft"
                      : "border-border/70 bg-background/70",
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded-t-2xl px-4 py-4 text-left transition-all",
                      active
                        ? "hover:bg-primary-foreground/10"
                        : "hover:border-border hover:bg-background",
                    )}
                    onClick={() => onOpenRecentMaterial(item)}
                    disabled={busy}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={active ? "secondary" : "outline"}>
                            {item.sourceType.toUpperCase()}
                          </Badge>
                          <Badge variant={active ? "secondary" : "outline"}>
                            {item.latestVersionId ? "已生成" : "仅已导入"}
                          </Badge>
                          <span
                            className={cn(
                              "text-xs",
                              active
                                ? "text-primary-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {item.wordCount} 词
                          </span>
                        </div>
                        <div className="mt-2 text-sm font-medium">{item.title}</div>
                        <div
                          className={cn(
                            "mt-2 text-xs",
                            active
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground",
                          )}
                        >
                          更新于{" "}
                          {item.updatedAt
                            ? new Date(item.updatedAt).toLocaleString("zh-CN")
                            : "刚刚"}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px]",
                          active
                            ? "border-primary-foreground/20 text-primary-foreground"
                            : "border-border/70 text-muted-foreground",
                        )}
                      >
                        {openingMaterialId === item.id ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="h-3.5 w-3.5" />
                        )}
                        打开
                      </span>
                    </div>
                  </button>
                  <div
                    className={cn(
                      "flex items-center justify-end gap-2 border-t px-3 py-2",
                      active
                        ? "border-primary-foreground/20 bg-primary-foreground/10"
                        : "border-border/60 bg-background/60",
                    )}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        active
                          ? "text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                          : "",
                      )}
                      onClick={() => onRenameRecentMaterial(item)}
                      disabled={busy}
                    >
                      {renamingMaterialId === item.id ? (
                        <LoaderCircle className="mr-2 size-4 animate-spin" />
                      ) : (
                        <PencilLine className="mr-2 size-4" />
                      )}
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        active
                          ? "text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                          : "",
                      )}
                      onClick={() => onDeleteRecentMaterial(item)}
                      disabled={busy}
                    >
                      {deletingMaterialId === item.id ? (
                        <LoaderCircle className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 size-4" />
                      )}
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
            还没有阅读历史。先导入一篇英文材料，生成后会自动出现在这里。
          </div>
        )}
      </CardContent>
    </Card>
  );
}
