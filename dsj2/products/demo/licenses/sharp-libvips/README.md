# Native dependency attribution: sharp-libvips1.3.3

Exact target: `@img/sharp-libvips-linux-x64@1.3.3`; upstream build commit `6e5971d333377743163edc3ad9e5d0b897abcbc9`.
These are the license texts and notices from the versioned upstream sources listed below. Files retain original bytes and copyright wording; collection.json records exact URLs and SHA-256. This is a text-collection result, not complete binary redistribution clearance.

This software is based in part on the work of the Independent JPEG Group.
This software uses the FreeType project. Its original FTL terms and copyright notices are reproduced in freetype/docs__FTL.TXT.

| Component | Exact version / embedded source | Declaration in package README | Collected original files |
| --- | --- | --- | --- |
| cgif | 0.5.3 | MIT License | [LICENSE](cgif/LICENSE) |
| expat | 2.8.3 | MIT License | [expat/COPYING](expat/expat__COPYING) |
| freetype | 2.14.3 | [freetype License](https://git.savannah.gnu.org/cgit/freetype/freetype2.git/tree/docs/FTL.TXT) (BSD-like) | [LICENSE.TXT](freetype/LICENSE.TXT), [docs/FTL.TXT](freetype/docs__FTL.TXT), [docs/GPLv2.TXT](freetype/docs__GPLv2.TXT) |
| fribidi | 1.0.16 | LGPLv3 | [COPYING](fribidi/COPYING) |
| glib | 2.89.4 | LGPLv3 | [COPYING](glib/COPYING), [LICENSES/LGPL-2.1-or-later.txt](glib/LICENSES__LGPL-2.1-or-later.txt) |
| harfbuzz | 14.3.1 | MIT License | [COPYING](harfbuzz/COPYING) |
| highway | 1.4.0 | BSD 3-Clause | [LICENSE](highway/LICENSE) |
| lcms | 2.19.1 | MIT License | [LICENSE](lcms/LICENSE) |
| libarchive | 3.8.9 | BSD 2-Clause | [COPYING](libarchive/COPYING), [libarchive/archive_read_support_filter_compress.c](libarchive/libarchive__archive_read_support_filter_compress.c), [libarchive/archive_write_add_filter_compress.c](libarchive/libarchive__archive_write_add_filter_compress.c) |
| libexif | 0.6.26 | LGPLv3 | [COPYING](libexif/COPYING) |
| libffi | 3.8.0 | MIT License | [LICENSE](libffi/LICENSE) |
| libheif | 1.23.2 | LGPLv3 | [COPYING](libheif/COPYING) |
| libimagequant | 2.4.1 | [BSD 2-Clause](https://github.com/lovell/libimagequant/blob/main/COPYRIGHT) | [COPYRIGHT](libimagequant/COPYRIGHT) |
| libpng | 1.6.58 | [libpng License](https://github.com/pnggroup/libpng/blob/master/LICENSE) | [LICENSE](libpng/LICENSE) |
| librsvg | 2.62.91 | LGPLv3 | [COPYING.LIB](librsvg/COPYING.LIB) |
| libultrahdr | 2.0.2 | MIT License | [LICENSE](libultrahdr/LICENSE) |
| libvips | 8.18.6 | LGPLv3 | [LICENSE](libvips/LICENSE) |
| libxml2 | 2.15.3 | MIT License | [Copyright](libxml2/Copyright) |
| mozjpeg | 0826579 | [zlib License, IJG License, BSD 3-Clause](https://github.com/mozilla/mozjpeg/blob/master/LICENSE.md) | [LICENSE.md](mozjpeg/LICENSE.md), [README.ijg](mozjpeg/README.ijg), [simd/nasm/jsimdext.inc](mozjpeg/simd__nasm__jsimdext.inc) |
| pango | 1.58.2 | LGPLv3 | [COPYING](pango/COPYING) |
| proxy-libintl | 0.5 | LGPLv3 | [COPYING](proxy-libintl/COPYING) |
| zlib-ng | 2.3.3 | [zlib License](https://github.com/zlib-ng/zlib-ng/blob/develop/LICENSE.md) | [LICENSE.md](zlib-ng/LICENSE.md) |
| cairo | 1.18.4 | Mozilla Public License 2.0 | [COPYING](cairo/COPYING), [COPYING-MPL-1.1](cairo/COPYING-MPL-1.1), [COPYING-LGPL-2.1](cairo/COPYING-LGPL-2.1) |
| fontconfig | 2.18.3 | [fontconfig License](https://gitlab.freedesktop.org/fontconfig/fontconfig/blob/main/COPYING) (BSD-like) | [COPYING](fontconfig/COPYING) |
| pixman | 0.46.4 | MIT License | [COPYING](pixman/COPYING) |
| libtiff | 4.7.2 | [libtiff License](https://gitlab.com/libtiff/libtiff/blob/master/LICENSE.md) (BSD-like) | [LICENSE.md](libtiff/LICENSE.md) |
| aom | 3.15.0 | BSD 2-Clause + [Alliance for Open Media Patent License 1.0](https://aomedia.org/license/patent-license/) | [LICENSE](aom/LICENSE), [PATENTS](aom/PATENTS) |
| libwebp | 1.6.0 | New BSD License | [COPYING](libwebp/COPYING), [PATENTS](libwebp/PATENTS) |
| libnsgif | bundled-in-libvips-8.18.6 | MIT License | [libvips/foreign/libnsgif/COPYING](libnsgif/libvips__foreign__libnsgif__COPYING) |

Collection limits:

- Deliver full corresponding source including exact sharp build patches and scripts, and satisfy applicable LGPL replacement/relink requirements for the chosen distribution method; source is not collected by this bounded license-text task.
- The generic package README names29 libraries; exact static-link contribution/per-file copyright coverage and transitive Rust crate notices are not proved solely by28 version entries.
- Cairo upstream1.18.4 root COPYING says LGPL2.1/MPL1.1 while package README selects MPL2.0; both full versions preserved, legal applicability not silently inferred.
- Bundled libnsgif is mapped to the exact libvips8.18.6 embedded source, without inventing a standalone version.

The README declares LGPLv3 using upstream later-version permissions; upstream original LGPL2.1 texts and complete LGPL3/GPL3 terms are all retained. This bundle does not silently replace upstream terms with a build-script Apache license.

The original exact build recipe is in build-build__posix.sh, including GLib and mozjpeg patches and source modifications; versions are in build-versions.properties. These small files are provenance, not a corresponding-source archive.
