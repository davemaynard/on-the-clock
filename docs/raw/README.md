# Raw assets

The untouched inputs and outputs of the 3D device render, kept so the shot can be
remade without rebuilding it from scratch. Nothing here is referenced by the
project's README — those images are one directory up.

| File | What it is |
|---|---|
| `deviceframes-input-phone.png` | The board shot for the render's phone: 1290 x 2796, an iPhone 15 Pro Max screen at 3x. The top 59 points are flat `#f2f4f7` and the same amount is cropped off the bottom, so the frame's status bar and Dynamic Island land on empty background instead of over the heading. |
| `deviceframes-export.mov` | The render exactly as DeviceFrames exported it: 2722 x 1526, H.264, 2.07s. A quarter-second of it is a still hold before the rotation starts, and it does not loop. `../demo-rotating-devices.mov` is this file trimmed to the motion and cropped to 3:2; `../demo-rotating-devices.gif` is that at 800px and 33.3fps. |

## Remaking it

The template lives in the DeviceFrames account (iPhone 15 Pro Max, template
`a72b0db9-0b54-42dc-be8d-dc5958ed1617`), so a redesign does not mean rebuilding the
composition — reshoot the screens, swap them in the editor, export again.

Shoot a phone screen at the device's point size times its scale factor, and give it
the safe-area inset as flat background at the top with the same amount cropped off
the bottom. The frame draws its own status bar over whatever is up there.
