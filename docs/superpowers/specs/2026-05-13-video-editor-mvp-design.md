# Video Editor MVP Design

Date: 2026-05-13
Project: TradeCut desktop app

## Goal

Add a small pre-upload video editor for clips in the review queue. The editor lets the user make privacy and framing edits before sending a clip to YouTube:

- Trim clip start and end.
- Crop the frame to a square or free rectangle.
- Add one or more static blur zones that apply to the whole exported clip.

The feature should stay intentionally narrow. It is not a general-purpose video editor and does not include timelines, keyframes, object tracking, captions, audio editing, transitions, or multi-clip composition.

## Current Context

TradeCut already creates local clips from OBS replay files, stores each clip with JSON metadata, and uploads the clip referenced by `metadata.videoPath` to YouTube. Video trimming is already performed through ffmpeg in the main process.

The editor should fit between clip creation and YouTube upload:

1. A clip appears in the review queue.
2. The user opens the editor from the clip card.
3. The user applies trim, crop, and blur zones.
4. TradeCut renders an edited mp4.
5. The clip metadata is updated so YouTube upload uses the edited file.

## Recommended Approach

Use a React editor modal in the renderer for interaction and an Electron IPC call to render the edited file in the main process with ffmpeg.

This keeps the UI responsive and keeps filesystem and process execution in the trusted main process. It also follows the existing project shape: renderer components call preload APIs, preload forwards to IPC, and main services handle local video work.

## User Experience

Each clip card gets a `Редактировать` action.

The editor opens as a focused modal with:

- A video preview.
- Trim controls for start and end.
- Crop controls:
  - no crop by default;
  - free rectangle mode;
  - square mode.
- Blur controls:
  - add blur zone;
  - select zone;
  - move and resize selected zone;
  - delete selected zone;
  - blur applies to the full output duration.
- Actions:
  - `Отмена`;
  - `Применить`;
  - a clear rendering/progress state while ffmpeg runs.

The preview should favor reliability over visual complexity. Rectangles are drawn as overlays on top of the video. The stored edit model uses normalized coordinates from 0 to 1 so resizing the app window does not change the intended crop or blur area.

## Edit Model

The renderer sends a compact edit request:

```ts
type ClipEditRequest = {
  metadataPath: string
  trim: {
    startSeconds: number
    endSeconds: number
  }
  crop?: {
    x: number
    y: number
    width: number
    height: number
  }
  blurZones: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
  }>
}
```

Crop and blur coordinates are normalized against the original source video frame. If both crop and blur are used, the preview shows both overlays on the same source frame. The main process converts normalized rectangles to even pixel coordinates using the probed source video width and height.

## Rendering

The main process builds a single ffmpeg command for the requested edit:

- Apply trim with `-ss` and `-t`.
- Apply static blur zones to the source frame with `filter_complex`.
- Apply crop after blur if crop is present.
- Re-encode to H.264/AAC mp4 with faststart, matching the current project convention.

For blur, the renderer sends source-frame rectangles and the main process generates an ffmpeg filter graph that crops each zone, applies blur, then overlays it back onto the base video. Applying blur before crop means crop and blur can share the same coordinate system in the first implementation.

The first implementation should render a new file next to the current clip, using a clear suffix such as `.edited.mp4`. It should not delete the original clip.

## Metadata

After a successful render, TradeCut updates the clip JSON:

- `videoPath` points to the edited file.
- `durationSeconds` reflects the edited output duration.
- Add an `edit` block with trim, crop, blur zones, source path, edited path, and edited timestamp.

The review queue continues to read the same metadata file. YouTube upload remains unchanged because it already uploads `metadata.videoPath`.

## Error Handling

The editor should block invalid requests before render:

- trim end must be after trim start;
- crop and blur rectangles must stay inside the video frame;
- rectangles must be at least 8 by 8 pixels after conversion to source video pixels;
- the source video must exist and be a supported local video file.

Main process errors should be surfaced in the modal in Russian. If rendering fails, metadata remains unchanged and the original clip stays available.

## Cross-Platform Notes

The MVP can initially use system `ffmpeg` and `ffprobe`, like the current code. For a reliable Mac and Windows release, TradeCut should bundle ffmpeg and ffprobe binaries and resolve their paths per platform.

Bundling is especially important for Windows because users are less likely to have ffmpeg on PATH.

## Testing

Unit tests should cover:

- edit request validation;
- normalized-to-pixel rectangle conversion;
- ffmpeg argument/filter graph generation for trim, crop, and blur;
- metadata update after a successful render;
- metadata unchanged after render failure.

Renderer tests can stay lightweight and verify that the clip card exposes the editor action and calls the preload API with the current clip metadata path.

Manual verification should include:

- trim-only render;
- crop-only render;
- one blur zone;
- multiple blur zones;
- crop plus blur;
- YouTube upload uses the edited file path after render.

## Deferred Features

These are intentionally out of scope for the MVP:

- blur zones active only during selected time ranges;
- animated blur/keyframes;
- object tracking;
- audio edits;
- captions;
- multi-clip timelines;
- YouTube metadata editing inside the video editor.
