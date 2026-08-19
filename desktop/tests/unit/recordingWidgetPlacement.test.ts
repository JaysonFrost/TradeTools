import { describe, expect, it } from 'vitest'
import { getRecordingWidgetPlacement } from '../../src/main/recordingWidgetPlacement'

describe('recording widget placement', () => {
  it('keeps the widget above a bottom taskbar in every pin state', () => {
    const display = {
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1032 }
    }

    expect(getRecordingWidgetPlacement(display, true)).toEqual({ x: 1280, y: 980, width: 320, height: 44 })

    expect(getRecordingWidgetPlacement({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1044 }
    }, true)).toEqual({ x: 1280, y: 1000, width: 320, height: 36 })
  })

  it('keeps an unpinned widget above the work area', () => {
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
