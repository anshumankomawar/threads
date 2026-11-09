# The welcome screen's scene

`src/renderer/src/assets/horizon.png` is NASA's photo of Earth's limb with Space Shuttle Endeavour (ISS022-E-062672,
public domain), the shuttle painted out and the rest dithered into a dot-matrix scene, as Devin and Capy do.

```sh
python3 clean.py source.jpeg clean.png    # paints out the shuttle along the atmosphere's bands
python3 dither.py clean.png horizon.png 400 300 6 4 6 200,250,3500,2725 0.8 0.12
#                cells: 400×300, 6px apart, 4px dots; 6 levels a channel; crop; darken; noise
```

It's drawn at half its pixel size (1200×900), so every dot lands on whole pixels on a Retina screen.
