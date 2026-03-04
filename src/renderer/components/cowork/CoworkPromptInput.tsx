import React, { useCallback, useRef, useState } from "react";
import { CoworkImageAttachment } from "@/types/cowork";
import {
  PaperClipIcon,
  XMarkIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";
import {
  PaperAirplaneIcon,
  StopIcon,
  FolderIcon,
} from "@heroicons/react/24/solid";

import { i18nService } from "@/services/i18n";
import { RootState } from "@/store";
import { useSelector } from "react-redux";
import ModelSelector from "../ModelSelector";

type CoworkAttachment = {
  path: string;
  name: string;
  isImage?: boolean;
  dataUrl?: string;
};

export interface CoworkPromptInputRef {
  /** 设置输入框值 */
  setValue: (value: string) => void;
  /** 聚焦输入框 */
  focus: () => void;
}

interface CoworkPromptInputProps {
  onSubmit: (
    prompt: string,
    skillPrompt?: string,
    imageAttachments?: CoworkImageAttachment[],
  ) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
  size?: "normal" | "large";
  workingDirectory?: string;
  onWorkingDirectoryChange?: (dir: string) => void;
  showFolderSelector?: boolean;
  showModelSelector?: boolean;
  onManageSkills?: () => void;
}

const CoworkPromptInput = React.forwardRef<
  CoworkPromptInputRef,
  CoworkPromptInputProps
>((props, ref) => {
  const {
    onSubmit,
    onStop,
    isStreaming = false,
    placeholder = "Enter your task...",
    disabled = false,
    size = "normal",
    workingDirectory = "",
    onWorkingDirectoryChange,
    showFolderSelector = false,
    showModelSelector = false,
    onManageSkills,
  } = props;

  // const draftPrompt = useSelector(
  //   (state: RootState) => state.cowork.draftPrompt,
  // );
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<CoworkAttachment[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const folderButtonRef = useRef<HTMLButtonElement>(null);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const dragDepthRef = useRef(0);

  const isLarge = size === "large";
  const minHeight = isLarge ? 60 : 24;
  const maxHeight = isLarge ? 200 : 200;

  const handleRemoveAttachment = useCallback((path: string) => {
    setAttachments((prev) =>
      prev.filter((attachment) => attachment.path !== path),
    );
  }, []);

  const hasFileTransfer = (dataTransfer: DataTransfer | null): boolean => {
    if (!dataTransfer) return false;
    if (dataTransfer.files.length > 0) return true;
    return Array.from(dataTransfer.types).includes("Files");
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (!disabled && !isStreaming) {
      setIsDraggingFiles(true);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = disabled || isStreaming ? "none" : "copy";
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (disabled || isStreaming) return;
    void handleIncomingFiles(event.dataTransfer.files);
  };

  const handleIncomingFiles = (data) => {};

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {};

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (disabled || isStreaming) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void handleIncomingFiles(files);
    },
    [disabled, handleIncomingFiles, isStreaming],
  );

  const containerClass = isLarge
    ? "relative rounded-2xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface shadow-card focus-within:shadow-elevated focus-within:ring-1 focus-within:ring-claude-accent/40 focus-within:border-claude-accent"
    : "relative flex items-end gap-2 p-3 rounded-xl border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface";

  const textareaClass = isLarge
    ? `w-full resize-none bg-transparent px-4 pt-2.5 pb-2 dark:text-claude-darkText text-claude-text placeholder:dark:text-claude-darkTextSecondary/60 placeholder:text-claude-textSecondary/60 focus:outline-none text-[15px] leading-6 min-h-[${minHeight}px] max-h-[${maxHeight}px]`
    : "flex-1 resize-none bg-transparent dark:text-claude-darkText text-claude-text placeholder:dark:text-claude-darkTextSecondary placeholder:text-claude-textSecondary focus:outline-none text-sm leading-relaxed min-h-[24px] max-h-[200px]";

  const enhancedContainerClass = isDraggingFiles
    ? `${containerClass} ring-2 ring-claude-accent/50 border-claude-accent/60`
    : containerClass;

  return (
    <div className="relative">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.path}
              className="inline-flex items-center gap-1.5 rounded-full border dark:border-claude-darkBorder border-claude-border dark:bg-claude-darkSurface bg-claude-surface px-2.5 py-1 text-xs dark:text-claude-darkText text-claude-text max-w-full"
              title={attachment.path}
            >
              {attachment.isImage ? (
                <PhotoIcon className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
              ) : (
                <PaperClipIcon className="h-3.5 w-3.5 flex-shrink-0" />
              )}

              <span className="truncate max-w-[180px]">{attachment.name}</span>

              <button
                type="button"
                onClick={() => handleRemoveAttachment(attachment.path)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover"
                aria-label={i18nService.t("coworkAttachmentRemove")}
                title={i18nService.t("coworkAttachmentRemove")}
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className={enhancedContainerClass}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-claude-accent/10 text-xs font-medium text-claude-accent">
            {i18nService.t("coworkDropFileHint")}
          </div>
        )}

        <>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            disabled={disabled}
            rows={isLarge ? 2 : 1}
            className={textareaClass}
            style={{ minHeight: `${minHeight}px` }}
          />
          <div className="flex items-center justify-between px-4 pb-2 pt-1.5">
            <div className="flex items-center gap-2 relative">
              {showFolderSelector && (
                <>
                  <div className="relative group">
                    <button
                      ref={
                        folderButtonRef as React.RefObject<HTMLButtonElement>
                      }
                      type="button"
                      onClick={() => setShowFolderMenu(!showFolderMenu)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover dark:hover:text-claude-darkText hover:text-claude-text transition-colors"
                    >
                      <FolderIcon className="h-4 w-4" />
                      <span className="max-w-[150px] truncate text-xs">
                        文件夹名称
                      </span>
                    </button>
                    {/* Tooltip - hidden when folder menu is open */}
                    {!showFolderMenu && (
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3.5 py-2.5 text-[13px] leading-relaxed rounded-xl shadow-xl dark:bg-claude-darkBg bg-claude-bg dark:text-claude-darkText text-claude-text dark:border-claude-darkBorder border-claude-border border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50 max-w-[400px] break-all whitespace-nowrap">
                        文件夹名称
                      </div>
                    )}
                  </div>
                </>
              )}
              {showModelSelector && <ModelSelector dropdownDirection="up" />}
              <button
                type="button"
                className="flex items-center justify-center p-1.5 rounded-lg text-sm dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover dark:hover:text-claude-darkText hover:text-claude-text transition-colors"
                title={i18nService.t("coworkAddFile")}
                aria-label={i18nService.t("coworkAddFile")}
                disabled={disabled || isStreaming}
              >
                <PaperClipIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      </div>
    </div>
  );
});

CoworkPromptInput.displayName = "CoworkPromptInput";

export default CoworkPromptInput;
