# The welcome screen's scene

`src/renderer/src/assets/horizon.png` is NASA's photo of Earth's limb with Space Shuttle Endeavour (ISS022-E-062672,
public domain), the shuttle painted out, shrunk to one pixel per cell and ordered-dithered, as Devin's is: Bayer 4×4,
the same threshold in every channel, eight levels a channel on pure black. With small steps between neighbouring cells
the photo reads through and the texture sits on it as grain, and the dark stays black with faint static and a few dim
coloured specks. The app draws each pixel as a solid square of whole screen pixels, about 3 CSS pixels across.

```sh
python3 clean.py source.jpeg clean.png    # paints out the shuttle along the atmosphere's bands
python3 dither.py clean.png horizon.png 640 427 0,0,4096,2731 8 2.2 0.62 1.15 0.028 0.016 0.035
#                cells; crop; levels; gamma; gain; saturation; floor; colour noise; grain
```

The source is the full-size photo from NASA (4096×2731); it isn't kept in the repository.
