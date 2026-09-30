import { describe, expect, it } from 'vitest'
import { getRecordingWidgetPlacement } from '../../src/main/recordingWidgetPlacement'

describe('recording widget placement', () => {
  it('places the Windows widget over the bottom taskbar', () => {
    const display = {
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1032 }
    }

    expect(getRecordingWidgetPlacement(display, true)).toEqual({ x: 1180, y: 1034, width: 320, height: 44 })

    expect(getRecordingWidgetPlacement({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1044 }
    }, true)).toEqual({ x: 1180, y: 1044, width: 320, height: 36 })

    expect(getRecordingWidgetPlacement({
      bounds: { x: -1920, y: -1080, width: 1920, height: 1080 },
      workArea: { x: -1920, y: -1080, width: 1920, height: 1032 }
    }, true)).toEqual({ x: -740, y: -46, width: 320, height: 44 })

    expect(getRecordingWidgetPlacement({
      bounds: { x: 0, y: 0, width: 640, height: 480 },
      workArea: { x: 0, y: 0, width: 640, height: 432 }
    }, true)).toEqual({ x: 8, y: 434, width: 320, height: 44 })
  })

  it('keeps the widget in the work area when taskbar overlap is disabled', () => {
    expect(getRecordingWidgetPlacement({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1032 }
    }, false)).toEqual({ x: 1280, y: 980, width: 320, height: 44 })
  })

  it('sits above the work area when the taskbar is hidden or vertical', () => {
    expect(getRecordingWidgetPlacement({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1872, height: 1080 }
    }, true)).toEqual({ x: 1232, y: 1024, width: 320, height: 48 })
  })
})
