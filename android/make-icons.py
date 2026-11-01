# Rebuilds the launcher icons and the splash picture in app/src/main/res from the web app's own icons (public/).
# Needs Python 3 with Pillow. The results are committed, so this only has to run when the web icons change.
from PIL import Image
import os
here = os.path.dirname(os.path.abspath(__file__))
pub = os.path.join(here, '..', 'public')
res = os.path.join(here, 'app', 'src', 'main', 'res')
legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
src = Image.open(os.path.join(pub, 'icon-512.png')).convert('RGB')
for d, px in legacy.items():
    os.makedirs(os.path.join(res, f'mipmap-{d}'), exist_ok=True)
    src.resize((px, px), Image.LANCZOS).save(os.path.join(res, f'mipmap-{d}', 'ic_launcher.png'), optimize=True)
# adaptive icon: the maskable picture (the mark sits in the safe zone) over the same background colour
fg = Image.open(os.path.join(pub, 'icon-maskable-512.png')).convert('RGB').resize((432, 432), Image.LANCZOS)
os.makedirs(os.path.join(res, 'drawable-nodpi'), exist_ok=True)
fg.save(os.path.join(res, 'drawable-nodpi', 'ic_launcher_foreground.png'), optimize=True)
fg2 = Image.open(os.path.join(pub, 'icon-512.png')).convert('RGB').resize((320, 320), Image.LANCZOS)
fg2.save(os.path.join(res, 'drawable-nodpi', 'splash.png'), optimize=True)
