# OpenAI Image API：GPT Image 2 与 GPT Image 2.5 参数参考

本文整理 OpenAI 官方 Image API 中 `gpt-image-2`、`gpt-image-2.5-sunburst` 和
`gpt-image-2.5-flare` 的图片生成（Generate）与图片编辑（Edits）参数。

官方文档：

- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [Images API reference](https://developers.openai.com/api/reference/resources/images)

## 模型

| 模型 | 适合场景 |
| --- | --- |
| `gpt-image-2` | 通用生成和编辑；质量档位为 `auto`、`low`、`medium`、`high` |
| `gpt-image-2.5-sunburst` | 编辑精度优先；支持更高质量档位 |
| `gpt-image-2.5-flare` | 快速、高质量的日常生成；支持更高质量档位 |

也可以使用带日期的固定版本，例如 `gpt-image-2-2026-04-21`。生产环境如果需要结果稳定，建议固定具体版本号。

## Generate：文生图

接口：

```http
POST /v1/images/generations
Content-Type: application/json
Authorization: Bearer $OPENAI_API_KEY
```

请求示例：

```json
{
  "model": "gpt-image-2",
  "prompt": "一间现代、明亮的室内工作室，产品摄影风格",
  "size": "1024x1024",
  "quality": "high",
  "output_format": "png",
  "background": "opaque",
  "n": 1
}
```

### 参数

| 参数 | 可选值或限制 | 说明 |
| --- | --- | --- |
| `model` | GPT Image 模型名 | 必填 |
| `prompt` | GPT Image 最长 32,000 字符 | 必填 |
| `quality` | GPT Image 2：`auto`、`low`、`medium`、`high`；GPT Image 2.5 另支持 `xhigh`、`max` | 默认 `auto` |
| `size` | `auto`、推荐尺寸或合法的自定义 `WIDTHxHEIGHT` | 默认 `auto` |
| `n` | `1` 到 `10` | 同一个提示词生成多个结果 |
| `background` | `transparent`、`opaque`、`auto` | 输出背景；透明背景需使用 PNG 或 WebP |
| `output_format` | `png`、`jpeg`、`webp` | 默认 PNG |
| `output_compression` | `0` 到 `100` | 仅 JPEG/WebP 有效，默认 `100` |
| `moderation` | `auto`、`low` | 内容审核强度 |
| `stream` | `true`、`false` | 是否流式返回 |
| `partial_images` | `0` 到 `3` | 仅流式模式有效 |
| `user` | 字符串 | 业务侧用户标识 |

GPT Image 返回 Base64 图片，不要传 DALL·E 常见的 `response_format: "url"`：

```json
{
  "data": [{ "b64_json": "..." }]
}
```

## Edits：图片编辑

接口：

```http
POST /v1/images/edits
Content-Type: multipart/form-data
Authorization: Bearer $OPENAI_API_KEY
```

multipart 请求示例：

```bash
curl https://api.openai.com/v1/images/edits \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "model=gpt-image-2.5-sunburst" \
  -F "prompt=保留人物和服装，只把背景替换成明亮的摄影棚" \
  -F "image[]=@input.png" \
  -F "size=1024x1024" \
  -F "quality=high" \
  -F "output_format=png"
```

### 参数

| 参数 | 可选值或限制 | 说明 |
| --- | --- | --- |
| `images` / `image[]` | 最多 16 张 | 编辑输入图或参考图 |
| `prompt` | GPT Image 最长 32,000 字符 | 必填 |
| `model` | GPT Image 模型名 | 必填 |
| `quality` | GPT Image 2：`auto`、`low`、`medium`、`high`；GPT Image 2.5 另支持 `xhigh`、`max` | 默认 `auto` |
| `input_fidelity` | 通用字段为 `low`、`high` | 见下方模型差异说明 |
| `mask` | 一个 `file_id` 或 `image_url` | 指定编辑区域 |
| `n` | `1` 到 `10` | 同一个编辑请求生成多个结果 |
| `size` | `auto` 或合法尺寸 | 输出尺寸 |
| `background` | `transparent`、`opaque`、`auto` | 输出背景 |
| `output_format` | `png`、`jpeg`、`webp` | 输出格式 |
| `output_compression` | `0` 到 `100` | JPEG/WebP 压缩质量 |
| `moderation` | `auto`、`low` | 内容审核 |
| `stream` | `true`、`false` | 流式输出 |
| `partial_images` | `0` 到 `3` | 流式预览图数量 |
| `user` | 字符串 | 用户标识 |

### 参考图数量

- 官方上限是 **16 张**。
- 多图时，建议在提示词中按编号说明每张图的作用：

```text
Image 1：主编辑对象
Image 2：人物脸部参考
Image 3：服装参考
Image 4：背景风格参考
```

### Mask

- `mask` 提供 `file_id` 或 `image_url`，二选一。
- 多张参考图时，mask 只应用于第一张图。
- GPT Image 的 mask 是提示性约束，不保证像传统图像软件一样严格贴合边缘。
- 编辑时应同时写清楚修改范围和保持不变的内容。

## 质量控制

### GPT Image 2

```text
auto | low | medium | high
```

### GPT Image 2.5

```text
auto | low | medium | high | xhigh | max
```

建议：`low` 用于草图，`medium` 用于普通生成，`high` 用于最终图片和复杂编辑，`xhigh` 或 `max` 用于精细编辑和一致性优先的任务。

## 尺寸限制

推荐尺寸：`1024x1024`、`1536x1024`、`1024x1536`、`auto`。

自定义尺寸必须满足：

- 宽和高都是 16 的倍数。
- 长宽比在 `1:3` 到 `3:1` 之间。
- 任意一边不超过 `3840` 像素。
- 总像素数约为 `655,360` 到 `8,294,400`。
- 高于 `2560x1440` 的尺寸属于实验性分辨率。

常用尺寸：`1024x1024`、`1536x1024`、`1024x1536`、`2048x2048`、`2048x1152`、`3840x2160`、`2160x3840`。

## 透明背景和输出格式

- 透明背景必须配 `png` 或 `webp`。
- GPT Image 2 的透明背景属于 preview 能力；GPT Image 2.5 正式支持透明和不透明背景。
- PNG 适合无损和透明背景；JPEG 通常更快、文件更小但不支持透明通道；WebP 支持透明并可使用压缩参数。

## `input_fidelity` 模型差异

对于 `gpt-image-2`，官方明确说明不要传 `input_fidelity`。模型会自动按高保真方式处理输入图片，传入该参数可能被拒绝。

Images API 参考中仍列出了通用的 `input_fidelity: low/high` 字段。对于 GPT Image 2.5，应以实际模型的接口校验为准；如果服务端返回不支持该参数，应移除该字段。

## 流式输出

```json
{
  "model": "gpt-image-2.5-flare",
  "prompt": "一只坐在窗边的橘猫",
  "size": "1024x1024",
  "quality": "high",
  "stream": true,
  "partial_images": 2
}
```

事件类型：`image_generation.partial_image`、`image_generation.completed`、`image_edit.partial_image`、`image_edit.completed`。

每张 partial image 会额外消耗 image output tokens，服务端也可能在返回全部 partial 图片前直接返回最终图。

## PicUp 当前实现差异

当前 `apps/api/src/modules/providers/tokenrun.provider.ts` 主要传递：

```ts
{
  model,
  prompt,
  size,
  quality,
  output_format: 'png'
}
```

当前代码与官方能力的差异：

- 只注册了 `gpt-image-2`，尚未配置两个 GPT Image 2.5 模型。
- 质量映射只有 `low/medium/high`，没有 `auto/xhigh/max`。
- 参考图限制为 4 张，低于官方 16 张。
- 尚未传 `background`、`moderation`、`n`、`output_compression`、`stream`、`partial_images`、`mask` 和 `user`。
- Edits 使用 multipart 的 `image[]`，方向正确。
- 当前尺寸校验已经覆盖 16 倍数、长宽比、总像素和最大边限制。

## 技术术语说明

- **Generate**：文生图接口，主要输入是文字提示词。
- **Edits**：图片编辑接口，需要通过 multipart 表单上传图片和普通字段。
- **multipart/form-data**：可以在一个 HTTP 请求中同时发送文件和文本字段的格式。
- **Base64**：把二进制图片编码成字符串；收到 `b64_json` 后，需要解码成 Blob 或文件才能显示。
- **quality**：影响生成过程投入的计算资源、耗时和成本。
- **size**：决定输出图片的像素尺寸，和 `quality` 是两个独立参数。
- **mask**：告诉模型重点修改哪个区域，但属于软约束，不是传统图像软件的像素级选区。
