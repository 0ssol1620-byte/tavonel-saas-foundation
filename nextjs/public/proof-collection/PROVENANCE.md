# Foundation public collection proof

The three PDFs in this directory are one-page derivatives of the public DART
fixture `dart-jtc-2026-q1.pdf` already held by the TAVONEL Core repository.
They are used only when `?foundation-proof=1` is present.

- Source bytes: 2,276,931
- Source SHA-256: `fb998430db82774afc0d69090383650421ab9a14e6e37c7f32821aa1c6a32eee`
- Source pages: 121
- Derivative method: `pdf-lib` page copy with object streams disabled
- Derivative pages: source page indexes 0, 1, and 2
- Intended use: browser-direct Foundation quarantine/CDR/OCR/collection proof

The derivatives contain no private customer material. The browser checks each
derivative SHA-256 before requesting an upload capability.

## Specimens

`specimens/` holds the four cells of Home's specimen strip (P2-31 and P2-32;
hard-proof 2026-10-27 added the two NASA SP-5079 pages). Each is one page of a
public document, cut to a one-page extract whose view box,
text-layer strings and operator list equal the original page's, and read once by
the Foundation OCR image. The reader's text is kept exactly as it returned it,
errors included.

- `naca-rm-l50c03-p001`: page 1 of 92 of NACA Research Memorandum RM L50C03
  (1950), from NASA Technical Reports Server citation 19930086148. Licence
  `US-GOV-WORK`: a U.S. federal government work, and the NTRS record marks the
  item "Work of the US Gov. Public Use Permitted." Read at
  2026-10-19T12:27:25.717Z.
- `kma-2026-09-climate-p001`: page 1 of 32 of the Korea Meteorological
  Administration press release "[2026년 9월 기후특성]", post 1194749. Licence
  `KOGL-1`: the post itself is marked "공공누리 1유형(출처명시) 공공저작물
  자유이용허락". Read at 2026-10-19T12:27:29.687Z.
- `nasa-sp-5079-p039`: page 39 of 78 of NASA Special Publication SP-5079
  (1968), "Constructing inexpensive automatic picture-transmission ground
  stations", from NASA Technical Reports Server citation 19680010155: the VHF
  receiver schematic (Figure 26). Licence `US-GOV-WORK`: a U.S. federal
  government work, and the NTRS record marks the item "Work of the US Gov. Public
  Use Permitted." Read at 2026-10-27T02:28:08.610Z.
- `nasa-sp-5079-p074`: page 74 of 78 of the same publication: the VHF receiver
  parts list. Licence `US-GOV-WORK`, on the same NTRS record. Read at
  2026-10-27T02:28:10.592Z.

Each cell has its extract (`<id>.pdf`), its crop as 720 px and 960 px AVIF with a
960 px WebP fallback, the whole page as 720 px and 960 px AVIF with a 480 px WebP
fallback (`<id>-page-*`, added 2026-10-27; each box `avoidInCrop` lists is painted
white in these files, as the receipt's `fullPage.method` records), and its run receipt (`<id>.run.json`,
`tavonel.specimen_run_receipt.v1`). The run receipt records the source and its
SHA-256, the extract, the reader image digest, the run, every region the reader
returned, the selection rule fixed before the run, the crop, and what it does not
claim: any accuracy figure, that the reader's text is correct, or the deployed
product path end to end, because the CDR step was a local replica of the
rasterizer.

The rights are the P2-23 snapshots, retrieved 2026-10-17, and for the two NASA
SP-5079 pages a snapshot of the NTRS record, retrieved 2026-10-27.
`lib/specimen-sources.json` pins each run receipt and each rights snapshot by
SHA-256:

| Cell | Run receipt | Rights snapshot |
| --- | --- | --- |
| `naca-rm-l50c03-p001.run.json` | `sha256:d1f3ea1532d0fef9ad9b7fc0e273717d789915ade7976199065a45636a84cb3d` | `sha256:9107cd70f084d9f836bfb98221dc6d47e8c969bfb44aa6de08c34a51c38c0eb5` |
| `kma-2026-09-climate-p001.run.json` | `sha256:a13f8b1c39dc6cbd6b3b3cf8e9950103ef3b23c346ec193fe29f1aa5d3c1a2c5` | `sha256:7b2b75fcf4953f94cf236a18dacca3347669491f4f38b3ce76d48a6156d03fe7` |
| `nasa-sp-5079-p039.run.json` | `sha256:3084b786343d9ffe6c0d81ccb77f6060c9b17f9bf052161f7dd3d5fc2c87879a` | `sha256:1b9e846c7d6005a436fc6de3bb7716007eb9aaf83a15839db0b744a79909a24a` |
| `nasa-sp-5079-p074.run.json` | `sha256:eabc62d892bd130696de47fbcc52fbc80bc130aa9bb9b3087bb399c509de989e` | `sha256:1b9e846c7d6005a436fc6de3bb7716007eb9aaf83a15839db0b744a79909a24a` |

`lib/specimen-sources.ts` refuses a production receipt whose licence is not
`US-GOV-WORK`, `KOGL-0` or `KOGL-1`. tavonel.com renders the strip at the end of
Home's second scene (`SPECIMEN_STRIP_ROLLOUT` is `"on"` since 2026-10-27).

## Compiler releases

`compiler-releases/` holds what the Core pins in `lib/compiler-release.ts` are
read from. The reader pins of both releases are read from the specimen run
receipts above.

- `core-v2-health-2026-10-27T09-28-53Z.json`: the body of
  `GET https://tavonel-product-core-v2.vercel.app/health`, byte for byte as
  curl saved it (224 bytes, SHA-256
  `365fb7d28ad49aeef1faf6158639fbc53538f6d5e2980b6c5404263009fe4133`). Captured
  at 2026-10-27T09:28:53Z: `date -u` read 09:28:52Z before the request and
  09:28:53Z after it, and the response's `x-vercel-id` carries
  2026-10-27T09:28:53.126Z. The response's own `Date` header read
  2026-10-27 09:21:46 GMT; it is recorded here and not used as the capture time.
  Its `coreReleaseDigest`,
  `sha256:b787dd86f6f57f92b76d91dcce1cba2d8064f5a75445f24010db0cc55f4598cd`, is
  Compiler 1.1's Core pin, served by deployment
  `dpl_AsvGT4RAKac6XdC88rNqomf2b2Z4` (READY 2026-10-27T09:21:44.349Z).
- Compiler 1's Core pin,
  `sha256:ceed3860d3da5efad5b6dab199f131fa4925aa48a60c0ad62805d6b1958f211e`, has
  no file here. It was read from the same `/health` at 2026-10-27T08:04:58Z,
  before that deployment, and the value was written down without the response
  bytes. It was also re-derived by re-hashing the 134 files of the staged Core
  release. Both records are in the hard-proof campaign's working receipts, which
  are not committed to any repository.
