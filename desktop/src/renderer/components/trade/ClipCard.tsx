import { Check, Copy, ExternalLink, FolderOpen, Pencil, Play, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ClipQueueItem } from '../../../main/services/trades/tradeClipPipeline'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type ClipCardProps = {
  clip: ClipQueueItem
  selected?: boolean
  onSelectedChange?: (selected: boolean) => void
  onDeleted?: (clip: ClipQueueItem) => void
  onRenamed?: (clip: ClipQueueItem) => void
}

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return minutes > 0 ? `${minutes}м ${rest}с` : `${rest}с`
}

export const ClipCard = ({ clip, selected = false, onSelectedChange, onDeleted, onRenamed }: ClipCardProps) => {
  const [previewing, setPreviewing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletingFile, setDeletingFile] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [editingFileName, setEditingFileName] = useState(false)
  const [fileNameInput, setFileNameInput] = useState(clip.fileName)
  const [previewMessage, setPreviewMessage] = useState('')
  const [deleteMessage, setDeleteMessage] = useState('')
  const [manualMessage, setManualMessage] = useState('')

  useEffect(() => {
    setFileNameInput(clip.fileName)
  }, [clip.fileName])

  const openPreview = async () => {
    setPreviewing(true)
    setPreviewMessage('')
    try {
      await getTradeToolsApi().clips.openPreview(clip.videoPath)
    } catch (error) {
      setPreviewMessage(error instanceof Error ? error.message : 'Не удалось открыть предпросмотр')
    } finally {
      setPreviewing(false)
    }
  }

  const deleteFromQueue = async () => {
    setDeleting(true)
    setDeleteMessage('')
    try {
      await getTradeToolsApi().clips.deleteFromQueue(clip.metadataPath)
      onDeleted?.(clip)
    } catch (error) {
      setDeleteMessage(error instanceof Error ? error.message : 'Не удалось убрать клип из очереди')
    } finally {
      setDeleting(false)
    }
  }

  const deleteFile = async () => {
    setDeletingFile(true)
    setDeleteMessage('')
    try {
      await getTradeToolsApi().clips.deleteFile(clip.metadataPath)
      onDeleted?.(clip)
    } catch (error) {
      setDeleteMessage(error instanceof Error ? error.message : 'Не удалось удалить файл клипа')
    } finally {
      setDeletingFile(false)
    }
  }

  const showInFolder = async () => {
    setManualMessage('')
    try {
      await getTradeToolsApi().clips.showInFolder(clip.videoPath)
      setManualMessage('Файл клипа открыт в папке')
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : 'Не удалось открыть файл клипа')
    }
  }

  const openTmmTrade = async () => {
    if (!clip.tmmTradeUrl) return
    setManualMessage('')
    try {
      await getTradeToolsApi().links.openExternal(clip.tmmTradeUrl)
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : 'Не удалось открыть сделку в TMM')
    }
  }

  const startRename = () => {
    setFileNameInput(clip.fileName)
    setManualMessage('')
    setEditingFileName(true)
  }

  const cancelRename = () => {
    setFileNameInput(clip.fileName)
    setEditingFileName(false)
  }

  const saveFileName = async () => {
    setRenaming(true)
    setManualMessage('')
    try {
      const result = await getTradeToolsApi().clips.renameFile({
        metadataPath: clip.metadataPath,
        fileName: fileNameInput
      })
      onRenamed?.(result.clip)
      setEditingFileName(false)
      setManualMessage('Имя файла обновлено')
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : 'Не удалось переименовать файл')
    } finally {
      setRenaming(false)
    }
  }

  const copyManualText = async (text: string, successMessage: string) => {
    setManualMessage('')
    try {
      await getTradeToolsApi().clipboard.writeText(text)
      setManualMessage(successMessage)
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : 'Не удалось скопировать текст')
    }
  }

  return (
    <Card className="rounded-2xl p-3">
      <div className="flex gap-3">
        {onSelectedChange && (
          <label className="flex h-16 shrink-0 cursor-pointer items-center px-1" title="Выбрать клип">
            <input
              className="h-4 w-4 cursor-pointer accent-violet-500"
              checked={selected}
              onChange={(event) => onSelectedChange(event.target.checked)}
              aria-label="Выбрать клип"
              type="checkbox"
            />
          </label>
        )}
        <button
          type="button"
          className="flex h-16 w-24 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-violet-600/40 to-black transition hover:border-violet-300/40 hover:bg-violet-500/10"
          onClick={() => void openPreview()}
          disabled={previewing}
          title="Открыть предпросмотр"
          aria-label="Открыть предпросмотр клипа"
        >
          <Play size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="m-0 truncate text-sm font-semibold">{clip.title}</h3>
          </div>
          <p className="mono mt-1 truncate text-[11px] text-zinc-500">{formatDuration(clip.durationSeconds)} • {clip.fileName}</p>
          <div className="mt-2">
            {editingFileName ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-zinc-100 outline-none transition focus:border-violet-400/60"
                  value={fileNameInput}
                  onChange={(event) => setFileNameInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveFileName()
                    if (event.key === 'Escape') cancelRename()
                  }}
                  aria-label="Имя файла клипа"
                />
                <div className="flex gap-2">
                  <Button variant="ghost" className="min-h-8 rounded-lg px-2 py-1 text-xs" onClick={() => void saveFileName()} disabled={renaming}>
                    <Check size={14} className="mr-1" />{renaming ? 'Сохраняем...' : 'Сохранить'}
                  </Button>
                  <Button variant="ghost" className="min-h-8 rounded-lg px-2 py-1 text-xs" onClick={cancelRename} disabled={renaming}>
                    <X size={14} className="mr-1" />Отмена
                  </Button>
                </div>
              </div>
            ) : (
              <div />
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="ghost" className="min-h-7 rounded-md border-violet-400/20 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-100 hover:bg-violet-500/20" onClick={() => void openPreview()} disabled={previewing}><Play size={13} className="mr-1" />{previewing ? 'Открываем...' : 'Смотреть'}</Button>
            <Button
              variant="ghost"
              className="min-h-7 rounded-md border-sky-400/20 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-500/20 disabled:text-zinc-500"
              onClick={() => void openTmmTrade()}
              disabled={!clip.tmmTradeUrl}
              title={clip.tmmTradeUrl ? 'Открыть эту сделку в дневнике TraderMake.Money' : 'Для этого клипа сделка в TMM пока не найдена'}
            >
              <ExternalLink size={13} className="mr-1" />{clip.tmmTradeUrl ? 'Открыть сделку в TMM' : 'Сделка TMM не найдена'}
            </Button>
            <Button variant="ghost" className="min-h-7 rounded-md px-2 py-1 text-[11px]" onClick={() => void showInFolder()}><FolderOpen size={13} className="mr-1" />В папке</Button>
            <Button variant="ghost" className="min-h-7 rounded-md px-2 py-1 text-[11px]" onClick={startRename}><Pencil size={13} className="mr-1" />Переименовать</Button>
            <Button variant="ghost" className="min-h-7 rounded-md px-2 py-1 text-[11px]" onClick={() => void copyManualText(clip.title, 'Название скопировано')}><Copy size={13} className="mr-1" />Скопировать</Button>
            <Button
              variant="ghost"
              className="min-h-7 rounded-md border-red-500/25 px-2 py-1 text-[11px] text-red-100 hover:bg-red-500/15"
              onClick={() => void deleteFromQueue()}
              disabled={deleting || deletingFile}
            >
              <Trash2 size={13} className="mr-1" />{deleting ? 'Удаляем...' : 'Убрать из списка'}
            </Button>
            <Button
              variant="ghost"
              className="min-h-7 rounded-md border-red-500/30 px-2 py-1 text-[11px] text-red-100 hover:bg-red-500/15"
              onClick={() => void deleteFile()}
              disabled={deleting || deletingFile}
            >
              <Trash2 size={13} className="mr-1" />{deletingFile ? 'Удаляем...' : 'Удалить видео с диска'}
            </Button>
          </div>
          {previewMessage && <p className="mt-2 text-xs text-amber-200">{previewMessage}</p>}
          {deleteMessage && <p className="mt-2 text-xs text-amber-200">{deleteMessage}</p>}
          {manualMessage && <p className="mt-2 text-xs text-zinc-300">{manualMessage}</p>}
        </div>
      </div>
    </Card>
  )
}
