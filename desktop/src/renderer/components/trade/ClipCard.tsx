import { Check, Copy, FolderOpen, Pencil, Play, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ClipQueueItem } from '../../../main/services/trades/tradeClipPipeline'
import { getTradeToolsApi } from '../../lib/tradeToolsApi'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type ClipCardProps = {
  clip: ClipQueueItem
  onDeleted?: (clip: ClipQueueItem) => void
  onRenamed?: (clip: ClipQueueItem) => void
}

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return minutes > 0 ? `${minutes}м ${rest}с` : `${rest}с`
}

export const ClipCard = ({ clip, onDeleted, onRenamed }: ClipCardProps) => {
  const [previewing, setPreviewing] = useState(false)
  const [deleting, setDeleting] = useState(false)
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

  const showInFolder = async () => {
    setManualMessage('')
    try {
      await getTradeToolsApi().clips.showInFolder(clip.videoPath)
      setManualMessage('Файл клипа открыт в папке')
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : 'Не удалось открыть файл клипа')
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
    <Card>
      <div className="flex gap-4">
        <button
          type="button"
          className="flex h-24 w-36 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-violet-600/40 to-black transition hover:border-violet-300/40 hover:bg-violet-500/10"
          onClick={() => void openPreview()}
          disabled={previewing}
          title="Открыть предпросмотр"
          aria-label="Открыть предпросмотр клипа"
        >
          <Play />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="m-0 truncate text-base font-semibold">{clip.title}</h3>
          </div>
          <p className="mono mt-2 truncate text-xs text-zinc-500">{formatDuration(clip.durationSeconds)} • {clip.videoPath}</p>
          <div className="mt-3">
            {editingFileName ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60"
                  value={fileNameInput}
                  onChange={(event) => setFileNameInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveFileName()
                    if (event.key === 'Escape') cancelRename()
                  }}
                  aria-label="Имя файла клипа"
                />
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => void saveFileName()} disabled={renaming}>
                    <Check size={16} className="mr-2" />{renaming ? 'Сохраняем...' : 'Сохранить'}
                  </Button>
                  <Button variant="ghost" onClick={cancelRename} disabled={renaming}>
                    <X size={16} className="mr-2" />Отмена
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" onClick={startRename}>
                <Pencil size={16} className="mr-2" />Переименовать файл
              </Button>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void openPreview()} disabled={previewing}>{previewing ? 'Открываем...' : 'Предпросмотр'}</Button>
            <Button
              variant="ghost"
              className="border-red-500/25 text-red-100 hover:bg-red-500/10"
              onClick={() => void deleteFromQueue()}
              disabled={deleting}
            >
              <Trash2 size={16} className="mr-2" />{deleting ? 'Удаляем...' : 'Убрать из очереди'}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void showInFolder()}>
              <FolderOpen size={16} className="mr-2" />Открыть файл
            </Button>
            <Button variant="ghost" onClick={() => void copyManualText(clip.title, 'Название скопировано')}>
              <Copy size={16} className="mr-2" />Скопировать название
            </Button>
          </div>
          {previewMessage && <p className="mt-3 text-sm text-amber-200">{previewMessage}</p>}
          {deleteMessage && <p className="mt-3 text-sm text-amber-200">{deleteMessage}</p>}
          {manualMessage && <p className="mt-3 text-sm text-zinc-300">{manualMessage}</p>}
        </div>
      </div>
    </Card>
  )
}
