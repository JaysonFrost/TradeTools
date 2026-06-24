import { describe, expect, it } from 'vitest'
import { buildVideoEncoderOptionsFromWindowsControllers } from '../../src/main/services/video/videoEncoderDevices'

describe('videoEncoderDevices', () => {
  it('lists only detected hardware encoder devices plus CPU', () => {
    expect(buildVideoEncoderOptionsFromWindowsControllers([
      { Name: 'Intel(R) UHD Graphics 770', AdapterCompatibility: 'Intel Corporation' },
      { Name: 'NVIDIA GeForce RTX 4070', AdapterCompatibility: 'NVIDIA' },
      { Name: 'Microsoft Basic Render Driver', AdapterCompatibility: 'Microsoft' }
    ])).toEqual([
      { id: 'gpu:intel:0', label: 'Intel(R) UHD Graphics 770', kind: 'gpu' },
      { id: 'gpu:nvidia:0', label: 'NVIDIA GeForce RTX 4070', kind: 'gpu' },
      { id: 'cpu', label: 'Процессор', kind: 'cpu' }
    ])
  })

  it('keeps multiple same-vendor adapters selectable by index', () => {
    expect(buildVideoEncoderOptionsFromWindowsControllers([
      { Name: 'NVIDIA GeForce RTX 4090' },
      { Name: 'NVIDIA GeForce RTX 4070' }
    ])).toEqual([
      { id: 'gpu:nvidia:0', label: 'NVIDIA GeForce RTX 4090', kind: 'gpu' },
      { id: 'gpu:nvidia:1', label: 'NVIDIA GeForce RTX 4070', kind: 'gpu' },
      { id: 'cpu', label: 'Процессор', kind: 'cpu' }
    ])
  })
})
