type RectangleLike = { x: number, y: number, width: number, height: number }

type DisplayLike = {
  bounds: RectangleLike
  workArea: RectangleLike
}

const widgetWidth = 320
const fallbackHeight = 48
const edgeGap = 8
const taskbarSystemAreaReserve = 320

export const getRecordingWidgetPlacement = (display: DisplayLike, overlapBottomTaskbar: boolean): RectangleLike => {
  const boundsBottom = display.bounds.y + display.bounds.height
  const workAreaBottom = display.workArea.y + display.workArea.height
  const bottomTaskbarHeight = Math.max(0, boundsBottom - workAreaBottom)
  const hasBottomTaskbar = bottomTaskbarHeight >= 30
  const taskbarGap = Math.min(4, Math.max(0, bottomTaskbarHeight - 36))
  const height = hasBottomTaskbar
    ? Math.min(fallbackHeight, bottomTaskbarHeight - taskbarGap)
    : fallbackHeight
  const x = Math.max(
    display.workArea.x + edgeGap,
    display.workArea.x + display.workArea.width - widgetWidth - taskbarSystemAreaReserve
  )
  const y = hasBottomTaskbar && overlapBottomTaskbar
    ? workAreaBottom + Math.floor((bottomTaskbarHeight - height) / 2)
    : workAreaBottom - height - edgeGap

  return { x, y, width: widgetWidth, height }
}
