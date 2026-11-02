# 音效素材来源

本项目的声音全部来自 [Freesound](https://freesound.org) 的公开音效库录音，本地完成变调、
剪裁、滤波、混响与响度统一。除特别标注外均为 **CC0**（可商用、免署名）。

| 用途 | 素材 | Freesound ID | 许可 |
|---|---|---|---|
| 木击（低） | Wood block hit | [218460](https://freesound.org/s/218460/) | CC0 |
| 木击（中） | wood block | [218461](https://freesound.org/s/218461/) | CC0 |
| 木击（高） | Wood Block (LP Jamblock) | [533093](https://freesound.org/s/533093/) | CC0 |
| 极短点击 | Click.wav | [256116](https://freesound.org/s/256116/) | CC0 |
| UI 点击 | UI_Click.wav | [546974](https://freesound.org/s/546974/) | CC0 |
| 柔和点击 | Soft UI Button Click | [528561](https://freesound.org/s/528561/) | CC0 |
| 开关咔哒 | click（switch） | [215772](https://freesound.org/s/215772/) | CC0 |
| 短提示音 | Family Friendly Inspect Sound | [657948](https://freesound.org/s/657948/) | CC0 |
| 玻璃钟 | ding.wav | [127149](https://freesound.org/s/127149/) | CC0 |
| 明亮铃 | Approval – High Pitched Bell | [625174](https://freesound.org/s/625174/) | CC0 |
| 颂钵 | singing bowl strike sound | [271370](https://freesound.org/s/271370/) | CC0 |
| 卡林巴（评分 / 毛毡） | Kalimba (C-note) | [331047](https://freesound.org/s/331047/) | CC0 |
| 马林巴 | Marimba note struck | [185833](https://freesound.org/s/185833/) | CC0 |
| 低闷击 | found matress hit.wav | [405705](https://freesound.org/s/405705/) | CC0 |
| 气流 | whoosh_short_mid.wav | [449996](https://freesound.org/s/449996/) | CC0 |
| 轻扫 | Swoosh.ogg | [419341](https://freesound.org/s/419341/) | CC0 |
| 铜片 | Cymbal Swish Short.wav | [39664](https://freesound.org/s/39664/) | CC0 |
| 纸张翻动 | Paper Sketchbook Page Flips 1 | [320148](https://freesound.org/s/320148/) | CC0 |
| 纸张铺开 | paper sheets flip through turn page | [450803](https://freesound.org/s/450803/) | CC0 |
| 翻页 | Page Turn – Please Turn Over (PTO) | [63318](https://freesound.org/s/63318/) | **CC BY 4.0**（作者 flag2） |

> 翻页声是唯一需要署名的素材。若不想在应用内署名，可把它替换成上表中的
> `paper sheets flip`（CC0），或在“关于”页加入一行：
> “Page turn sound by flag2, CC BY 4.0, via Freesound.”

## 处理链

1. `prepare_library.py`：解码 → 去静音头 → 剪出单次击打 → 高通 → 首尾淡入淡出 → 峰值归一。
2. `palette.py`：按目标音高做等比例变速（varispeed）→ 按时长裁剪 → 低通/高通塑形 →
   叠加层（纸、玻璃、铜片）→ 统一房间混响 → K 加权起始响度归一。
3. `build_demo.py`：导出 44.1 kHz WAV 母版，演示页内短音保留 WAV、带尾音的声音转 160 kbps MP3。

## 重新生成

```bash
python tools/sound_design/prepare_library.py "tmp/audio-source-lib"
python tools/sound_design/prepare_samples.py "tmp/audio-source-paper"
python tools/sound_design/build_demo.py
```
