import { Copy, ExternalLink, FileText, FolderOpen, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ClipQueueItem } from '../../../main/services/trades/tradeClipPipeline'
import { getTradeCutApi } from '../../lib/tradeCutApi'
import { buildManualYouTubeDescription } from '../../lib/youtubeManualUpload'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

export type ClipCardProps = {
  clip: ClipQueueItem
  onChanged?: (clip: ClipQueueItem) => void
  onDeleted?: (clip: ClipQueueItem) => void
}

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return minutes > 0 ? `${minutes}м ${rest}с` : `${rest}с`
}

export const ClipCard = ({ clip, onChanged, onDeleted }: ClipCardProps) => {
  const [previewing, setPreviewing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [previewMessage, setPreviewMessage] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const [deleteMessage, setDeleteMessage] = useState('')
  const [manualMessage, setManualMessage] = useState('')

  const openPreview = async () => {
    setPreviewing(true)
    setPreviewMessage('')
    try {
      await getTradeCutApi().clips.openPreview(clip.videoPath)
    } catch (error) {
      setPreviewMessage(error instanceof Error ? error.message : 'Не удалось открыть предпросмотр')
    } finally {
      setPreviewing(false)
    }
  }

  const uploadToYouTube = async () => {
    setUploading(true)
    setUploadMessage('')
    try {
      const updatedClip = await getTradeCutApi().clips.uploadToYouTube(clip.metadataPath)
      onChanged?.(updatedClip)
      setUploadMessage(updatedClip.youtubeUrl ? `Загружено: ${updatedClip.youtubeUrl}` : 'Клип загружен на YouTube')
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Не удалось загрузить клип на YouTube')
    } finally {
      setUploading(false)
    }
  }

  const deleteFromQueue = async () => {
    setDeleting(true)
    setDeleteMessage('')
    try {
      await getTradeCutApi().clips.deleteFromQueue(clip.metadataPath)
      onDeleted?.(clip)
    } catch (error) {
      setDeleteMessage(error instanceof Error ? error.message : 'Не удалось убрать клип из очереди')
    } finally {
      setDeleting(false)
    }
  }

  const openYouTubeStudio = async () => {
    setManualMessage('')
    try {
      await getTradeCutApi().youtube.openStudioUpload()
      setManualMessage('YouTube Studio открыт. Перетащите файл клипа или выберите его вручную.')
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : 'Не удалось открыть YouTube Studio')
    }
  }

  const showInFolder = async () => {
    setManualMessage('')
    try {
      await getTradeCutApi().clips.showInFolder(clip.videoPath)
      setManualMessage('Файл клипа открыт в папке')
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : 'Не удалось открыть файл клипа')
    }
  }

  const copyManualText = async (text: string, successMessage: string) => {
    setManualMessage('')
    try {
      await getTradeCutApi().clipboard.writeText(text)
      setManualMessage(successMessage)
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : 'Не удалось скопировать текст')
    }
  }

  return (
    <Card>
      <div className="flex gap-4">
        <div className="flex h-24 w-36 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-violet-600/40 to-black">
          <Play />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="m-0 truncate text-base font-semibold">{clip.title}</h3>
            <Badge tone="warning">На проверке</Badge>
          </div>
          <p className="mono mt-2 truncate text-xs text-zinc-500">{formatDuration(clip.durationSeconds)} • {clip.videoPath} • YouTube еще не загружен</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void openPreview()} disabled={previewing}>{previewing ? 'Открываем...' : 'Предпросмотр'}</Button>
            <Button
              className="bg-red-600 shadow-[0_0_32px_rgba(220,38,38,0.28)] hover:bg-red-500"
              onClick={() => void uploadToYouTube()}
              disabled={uploading || Boolean(clip.youtubeUrl)}
            >
              <ExternalLink size={16} className="mr-2" />{clip.youtubeUrl ? 'Загружено на YouTube' : uploading ? 'Загружаем...' : 'Загрузить на YouTube'}
            </Button>
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
            <Button variant="ghost" onClick={() => void openYouTubeStudio()}>
              <ExternalLink size={16} className="mr-2" />Открыть YouTube Studio
            </Button>
            <Button variant="ghost" onClick={() => void showInFolder()}>
              <FolderOpen size={16} className="mr-2" />Открыть файл
            </Button>
            <Button variant="ghost" onClick={() => void copyManualText(clip.title, 'Название скопировано')}>
              <Copy size={16} className="mr-2" />Скопировать название
            </Button>
            <Button variant="ghost" onClick={() => void copyManualText(buildManualYouTubeDescription(clip), 'Описание скопировано')}>
              <FileText size={16} className="mr-2" />Скопировать описание
            </Button>
          </div>
          {previewMessage && <p className="mt-3 text-sm text-amber-200">{previewMessage}</p>}
          {(uploadMessage || clip.youtubeUrl) && <p className="mt-3 text-sm text-red-100">{uploadMessage || `Загружено: ${clip.youtubeUrl}`}</p>}
          {deleteMessage && <p className="mt-3 text-sm text-amber-200">{deleteMessage}</p>}
          {manualMessage && <p className="mt-3 text-sm text-zinc-300">{manualMessage}</p>}
        </div>
      </div>
    </Card>
  )
}
