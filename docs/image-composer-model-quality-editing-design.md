# PicUp 图片模型与编辑能力设计方案（基于当前输入框）

本文以 PicUp 当前工作台代码为基线，设计 GPT Image 2、GPT Image 2.5、生成精细度、Mask 和其他 Image API 能力的接入方式。

相关资料：

- [OpenAI Image API：GPT Image 2 与 GPT Image 2.5 参数参考](./openai-image-api-gpt-image-2-and-2-5.md)
- 当前输入框：[studio.tsx](../apps/web/src/components/studio/studio.tsx)
- 当前样式：[studio.css](../apps/web/src/app/studio.css)
- 当前草稿状态：[use-studio-draft.ts](../apps/web/src/components/studio/use-studio-draft.ts)

## 修订结论

本方案不重新设计输入框，不增加一排新的工具按钮，也不移动参考图入口。

必须保留当前结构：

1. 左侧是参考图堆叠和添加按钮。
2. 右侧是提示词输入区。
3. 底部左侧依次是“画板”“选择模型”“比例与清晰度”。
4. 底部右侧是积分预估和发送按钮。
5. 桌面端和移动端继续使用同一套工具栏，只由现有响应式样式压缩文案。

新增能力只进入当前已有入口：

| 新能力 | 放置位置 | 是否增加输入框按钮 |
| --- | --- | --- |
| GPT Image 2 / 2.5 | 现有“选择模型”弹层 | 否 |
| 生成精细度 | 现有“比例与清晰度”弹层 | 否 |
| 背景、格式、数量、压缩 | 现有“比例与清晰度”弹层中的折叠区 | 否 |
| Mask | 现有“参考图片”管理弹层中的主图操作 | 否 |
| 流式预览 | 系统行为，在生成结果区显示 | 否 |
| `moderation`、`user` | 后端自动处理 | 否 |

## 当前输入框基线

当前 `.integrated-composer` 是上下两层结构：

```text
┌──────────────────────────────────────────────────────────────────┐
│ ┌────────┐  描述画面、风格和细节……                                │
│ │参考图堆│                                                         │
│ │叠 / ＋ │                                                         │
│ └────────┘                                                         │
│                                                                    │
│ [画板] [自动推荐 ▾] [智能 · 1K ▾]                 1 积分       [↑] │
└──────────────────────────────────────────────────────────────────┘
```

对应现有组件关系：

```text
.composer-input
├── .composer-writing
│   ├── .composer-reference-stack
│   └── .composer-writing-content
│       └── textarea
├── .skill-options（输入 / 时向上弹出）
└── .composer-bottom-row
    ├── .composer-selectors
    │   ├── 画板
    │   ├── 模型
    │   └── 比例与清晰度
    └── .composer-submit
        ├── 积分预估
        └── 发送
```

后续功能必须服从这棵结构，不能把参考图移到底部工具栏，也不能把模型、精细度、尺寸拆成多个常驻按钮。

## 接入后的输入框

接入全部功能后，输入框外观只会发生两处轻微变化：模型名称变化；参数存在非默认值时，现有参数按钮显示一个状态点。

```text
┌──────────────────────────────────────────────────────────────────┐
│ ┌────────┐  保留人物和服装，把背景换成明亮摄影棚……                 │
│ │  2 张  │                                                         │
│ │参考图＋│                                                         │
│ └────────┘                                                         │
│                                                                    │
│ [画板] [GPT Image 2.5 精准 ▾] [1:1 · 2K ▾]●       4 积分       [↑] │
└──────────────────────────────────────────────────────────────────┘
```

状态点 `●` 只表示参数弹层内存在非默认设置，例如精细度、透明背景、多图输出或 Mask。它不占用新的工具栏位置。

工具栏不显示完整参数摘要。完整内容放在参数按钮的 Tooltip 和弹层内：

```text
1:1 · 2K · 精细 · PNG · 2 张输出 · 已设置编辑区域
```

## 模型选择：扩展现有弹层

当前模型按钮已经通过 `modelTrigger` 打开带锚点的 `Dialog`，弹层内使用 `.composer-model-list` 和 `.composer-model-option`。继续使用这个组件，不新增模型选项卡。

```text
┌────────────────────────────────────────────────┐
│ 选择模型                                    ×  │
├────────────────────────────────────────────────┤
│ [魔棒] 自动推荐                         ✓       │
│        根据任务和参考图自动选择                  │
│                                                │
│ [模型] GPT Image 2                             │
│        通用生成与编辑 · 最高精细                │
│                                                │
│ [模型] GPT Image 2.5 精准          编辑推荐     │
│        对应 Sunburst · 局部编辑和一致性更好      │
│                                                │
│ [模型] GPT Image 2.5 快速          速度推荐     │
│        对应 Flare · 日常生成和反复尝试更快       │
└────────────────────────────────────────────────┘
```

### 命名原则

API 模型名不直接作为主要文案：

| API 模型 | 用户看到的名称 | 辅助说明 |
| --- | --- | --- |
| `gpt-image-2` | GPT Image 2 | 通用生成与编辑 |
| `gpt-image-2.5-sunburst` | GPT Image 2.5 精准 | 编辑推荐 |
| `gpt-image-2.5-flare` | GPT Image 2.5 快速 | 速度推荐 |

这样仍然符合当前“一行一个模型”的数据和组件结构，不需要在模型弹层内再嵌套第二层选择。

### 选中模型后的行为

- 关闭当前模型弹层，延续现有交互。
- 检查当前比例、分辨率和精细度是否受支持。
- 不支持的值自动切换到最接近值，并用一次轻提示说明。
- 重新请求积分预估。
- 输入框左侧参考图和底部工具栏不变化。

## 精细度：放进现有生成设置

当前参数按钮由 `sizeTrigger` 打开“生成设置”，弹层已有“图片比例”和“清晰度”两个 `fieldset`。生成精细度应作为第三个 `fieldset` 加在同一个弹层中。

输入框上不再添加“精细度”按钮。

```text
┌────────────────────────────────────────────────┐
│ 生成设置                                    ×  │
├────────────────────────────────────────────────┤
│ 图片比例                                       │
│ [智能] [1:1] [4:3] [3:4] [16:9] [9:16] [...] │
│                                                │
│ 输出尺寸                                       │
│ [1K] [2K] [4K]                                 │
│                                                │
│ 生成精细度                  仅 GPT Image 显示    │
│ [自动] [快速] [标准] [精细] [极致]              │
│ 精细：适合文字、人物和复杂细节，生成时间较长。   │
│                                                │
│ [▸ 输出设置]                                   │
│                                                │
│ 预计 4 积分                              [完成] │
└────────────────────────────────────────────────┘
```

原来的“清晰度”实际表示 `1K/2K/4K` 输出像素，建议在弹层内改名为“输出尺寸”或“分辨率”。输入框按钮仍显示 `1K/2K/4K`，不改变用户已经熟悉的摘要。

### 精细度映射

精细度和输出尺寸必须独立。用户可以选择“1K + 极致”，也可以选择“4K + 快速”。

| 用户选项 | GPT Image 2 | GPT Image 2.5 | 展示规则 |
| --- | --- | --- | --- |
| 自动 | `auto` | `auto` | 默认值 |
| 快速 | `low` | `low` | 草图和反复尝试 |
| 标准 | `medium` | `medium` | 日常生成 |
| 精细 | `high` | `high` | 正式成图 |
| 极致 | 不支持 | `xhigh` | GPT Image 2 中禁用 |
| 最高 | 不支持 | `max` | 放在“极致”的二级说明或高级选项中 |

不建议在紧凑弹层中同时平铺六个同宽按钮。可将 `max` 放在“极致”选项的更多菜单里：

```text
极致 ▾
├── 极致（xhigh）
└── 最高（max，耗时和积分最高）
```

如果产品希望所有档位一步可见，移动端使用三列两行网格，不能挤压现有工具栏。

### 非 GPT 模型

Nano Banana 和 Gemini 当前仍使用自己的质量逻辑。选择这些模型时隐藏“生成精细度”字段，保留现有“图片比例 + 输出尺寸”，不要向不支持的 Provider 发送 OpenAI 参数。

## 其他输出参数：折叠在同一个弹层

背景、输出数量和格式属于低频选项，放在“生成设置”底部的“输出设置”折叠区。默认折叠，打开时在弹层内部向下展开，不影响输入框高度。

```text
┌────────────────────────────────────────────────┐
│ [▾ 输出设置]                              [重置]│
│                                                │
│ 背景     [自动] [不透明] [透明]                │
│ 输出数量 [−]  1  [+]                           │
│ 格式     [PNG] [JPEG] [WebP]                  │
│ 压缩质量 80 ─────────●──── 100                 │
└────────────────────────────────────────────────┘
```

联动规则：

- 透明背景只允许 PNG 或 WebP；选择透明时自动切换为 PNG。
- PNG 隐藏压缩质量；`output_compression` 只在 JPEG/WebP 时显示。
- 输出数量用步进器控制 `1–10`，积分预估按实际数量更新。
- 多图结果继续使用现有 `outputImages[]`，对话预览组件展示同一任务的多张结果。
- `stream` 和 `partial_images` 由系统统一控制，不给普通用户增加开关。
- `moderation` 默认由服务端设置为 `auto`。
- `user` 由服务端使用当前用户 ID 填充。
- GPT Image 2 不显示也不发送 `input_fidelity`。

## Mask：从参考图管理器进入

Mask 不进入输入框工具栏。用户点击当前左侧参考图堆叠，仍然打开现有“参考图片”弹层。

当前参考图卡片已有预览、继续绘制和删除操作。在第一张图片上增加“编辑区域”操作：

```text
┌──────────────────┐
│                  │
│     参考图 1      │
│                  │
└──────────────────┘
[主编辑图]       已设置区域

       [继续绘制] [编辑区域] [移除]
```

其他参考图保持原操作，不显示 Mask：

```text
┌──────────────────┐
│     参考图 2      │
└──────────────────┘
              [继续绘制] [移除]
```

Images Edits 的 Mask 只作用于第一张图。界面必须明确第一张图是“主编辑图”，避免用户在其他参考图上画 Mask 后才收到错误。

### Mask 编辑器与当前组件的关系

当前项目已有：

- `ImageLightbox`：统一的图片预览入口。
- `Board`：普通绘制和保存图片。
- `Dialog fullscreen`：全屏工具容器。

Mask 应新增独立的 `MaskEditor`，复用全屏 `Dialog` 和预览操作习惯。不要把 Mask 保存逻辑直接塞进 `Board`，因为 Board 保存的是修改后的彩色图片，而 Mask 保存的是与原图同尺寸的灰度或透明区域数据。

建议入口：

```text
参考图堆叠
  → 参考图片弹层
    → 第一张主编辑图“编辑区域”
      → 全屏 MaskEditor
```

建议路由状态沿用当前 `view` 机制：

```text
?view=references
?view=mask
```

### Mask 编辑器示意

```text
┌──────────────────────────────────────────────────────────────┐
│ [取消]                    编辑区域                    [完成] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                     原图 + 半透明遮罩                         │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ [画笔] [橡皮] [撤销] [恢复] [反选] [清除]  大小 ──●── [预览]│
└──────────────────────────────────────────────────────────────┘
```

需要支持：

- 鼠标、触控笔和手指连续绘制。
- 画笔大小、橡皮擦、撤销、恢复、反选和清除。
- `Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`、Delete/Backspace。
- 放大、缩小和拖动画布。
- Mask 与第一张主图绑定；更换或删除第一张图时提示并清除 Mask。
- 完成后回到“参考图片”弹层，输入框布局保持原样。

## 参考图数量与角色

当前输入框左侧的堆叠缩略图和数量角标已经能表达多张参考图，应继续使用。

本阶段不在输入框中增加“主体参考、风格参考”等角色控件。参考图管理器只做两件必要的事：

1. 标明第一张是主编辑图。
2. 允许拖动排序，让用户决定哪一张接受 Mask。

图片角色描述仍可由提示词表达。等真实用户出现多图角色混淆后，再考虑在参考图管理器中增加备注字段。

模型上限由 `selectedModel.maxInputImages` 控制。官方支持 16 张不代表产品必须立刻开放 16 张；需要同时评估第三方 TokenRun 的实际限制、上传等待和费用。

## 桌面和移动端

### 桌面端

- 模型和生成设置继续使用当前锚定按钮的 `composer-popover`。
- 弹层向输入框上方展开，最大宽度保持约 `440px`。
- 参数较多时弹层内部滚动，输入框本身不增高。
- Mask 使用全屏编辑器。

### 移动端

当前底部工具栏已经会隐藏选择器的尾部箭头并压缩文字。新增功能后仍保持：

```text
┌──────────────────────────────┐
│ [参考图]  提示词……            │
│                              │
│ [画板] [Image 2.5] [1:1·1K] │
│                      2积分 [↑]│
└──────────────────────────────┘
```

- 不在工具栏增加“精细度”“Mask”“更多”按钮。
- 模型和生成设置在移动端使用现有底部 Dialog；内容内部滚动。
- Mask 全屏展示，工具栏固定在安全区上方。
- 参数按钮只展示比例和输出尺寸，完整精细度通过 Tooltip 或弹层查看。

## 状态设计：在当前草稿上增量扩展

当前 `StudioDraft` 已有：

```ts
type StudioDraft = {
  prompt: string;
  provider: string;
  model: string;
  files: UploadedFileRecord[];
  aspectRatio: string;
  quality: ImageQuality; // 当前实际是 512 / 1K / 2K / 4K
  // 其他已有字段
};
```

为降低改动范围，保留现有 `quality` 字段表示输出尺寸，再增量加入 Image API 参数：

```ts
type ImageDetailLevel = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

type StudioDraft = {
  // 现有字段保持不变
  detailLevel?: ImageDetailLevel;
  background?: 'auto' | 'opaque' | 'transparent';
  outputFormat?: ImageOutputFormat;
  outputCompression?: number;
  outputCount?: number;
  maskFileId?: string;
  maskSourceFileId?: string;
};
```

旧草稿没有这些字段时使用默认值：

```ts
{
  detailLevel: 'auto',
  background: 'auto',
  outputFormat: 'png',
  outputCompression: 100,
  outputCount: 1
}
```

这样不会让已保存在 Session Storage 的旧草稿失效。

## 模型能力配置

当前 `ModelConfig` 只有参考图上限、比例、输出尺寸和积分。需要增加可选的能力字段，让现有 Gemini 和 Nano 模型继续兼容：

```ts
interface ImageModelCapabilities {
  detailLevels?: ImageDetailLevel[];
  supportsMask?: boolean;
  supportsTransparentBackground?: boolean;
  outputFormats?: ImageOutputFormat[];
  maxOutputCount?: number;
  supportsStreaming?: boolean;
}

interface ModelConfig {
  // 当前字段保持不变
  capabilities?: ImageModelCapabilities;
}
```

前端根据能力字段决定“生成设置”中显示哪些字段。后端仍要执行同样校验，不能只依赖前端隐藏按钮。

## 请求、报价和任务记录

`ImageJobCreateRequest` 增加可选字段：

```ts
interface ImageJobCreateRequest {
  // 当前字段保持不变
  detailLevel?: ImageDetailLevel;
  background?: 'auto' | 'opaque' | 'transparent';
  outputFormat?: ImageOutputFormat;
  outputCompression?: number;
  outputCount?: number;
  maskFileId?: string;
}
```

必须同步更新：

- `quoteImageJob`：模型、精细度、尺寸、数量改变时重新报价。
- 幂等签名：新字段必须包含在现有 `JSON.stringify(request)` 中。
- 数据库存档：保存最终使用的完整参数，历史任务才能正确“复用参数”。
- `reuseParameters`：恢复精细度、背景、格式、数量和 Mask。
- TokenRun Provider：Generate 使用 JSON，Edits 使用 multipart，并只在有 Mask 时追加 `mask`。
- 积分账本：输出数量大于 1 时按报价结果一次预占，失败时按实际规则退款。

## 与当前文件的对应关系

| 文件 | 建议改动 |
| --- | --- |
| `packages/shared/src/index.ts` | 增加精细度、输出格式和请求字段类型 |
| `packages/shared/src/model-catalog.ts` | 增加 GPT Image 2.5 模型和可选能力配置 |
| `apps/web/src/components/studio/use-studio-draft.ts` | 给现有草稿增加可选字段和默认值 |
| `apps/web/src/components/studio/studio.tsx` | 扩展现有模型弹层、生成设置弹层和参考图管理器 |
| `apps/web/src/components/studio/mask-editor.tsx` | 新增 Mask 全屏编辑器 |
| `apps/web/src/app/studio.css` | 只补弹层、Mask 和状态点样式，不改工具栏结构 |
| `apps/api/src/modules/jobs/dto.ts` | 校验新增参数组合 |
| `apps/api/src/modules/jobs/jobs.service.ts` | 报价、模型能力校验和任务持久化 |
| `apps/api/src/modules/providers/provider.types.ts` | 把新增参数传给 Provider |
| `apps/api/src/modules/providers/tokenrun.provider.ts` | 映射 Generate / Edits 参数和 Mask 文件 |
| `apps/api/prisma/schema.prisma` | 保存任务参数和 Mask 关联 |

## 分阶段实现

### 第一阶段：不改变输入框结构

- 在现有模型列表加入 GPT Image 2 和两个 GPT Image 2.5 选项。
- 在现有“生成设置”加入条件显示的精细度。
- 拆清输出尺寸与生成精细度的传参。
- 报价、提交、任务历史和参数复用全链路保存新字段。

### 第二阶段：低频输出选项

- 在现有“生成设置”加入折叠的输出设置。
- 支持背景、格式、输出数量和压缩质量。
- 输入框只通过参数按钮状态点提示存在非默认设置。

### 第三阶段：Mask

- 在现有参考图管理器标出第一张主编辑图。
- 支持拖动排序。
- 新增全屏 `MaskEditor`。
- 上传和持久化 Mask，并接入 Edits 请求。
- 将 Mask 状态纳入复用参数和历史任务。

### 第四阶段：流式预览

- 服务端统一开启 `stream` 和 `partial_images`。
- 对话中的现有生成区域显示中间图。
- 最终图返回后替换中间图，不增加用户设置项。

## 验收标准

- 未选择新功能时，输入框外观、按钮数量、顺序和尺寸与当前一致。
- 添加参考图后，左侧堆叠缩略图位置不变。
- 模型切换只发生在现有模型弹层中。
- 精细度、背景、格式和数量只发生在现有生成设置弹层中。
- Mask 只从第一张主编辑图进入，不占用输入框工具栏。
- 320px 宽移动端中，画板、模型、参数、积分和发送仍可操作且不互相覆盖。
- 弹层内容过高时内部滚动，不撑高输入框。
- 所有非默认参数都进入报价、幂等签名、数据库记录和“复用参数”。
- 非 OpenAI 模型不会收到 GPT Image 专属参数。

## 技术讲解

- **增量扩展**：在已有组件和数据结构上增加可选能力，不推翻现有交互。
- **条件渲染**：只有模型声明支持某项能力时，界面才显示对应设置。
- **能力配置**：用结构化数据描述每个模型支持的参数，减少前端写死模型名称。
- **幂等签名**：用完整请求参数识别重复提交；新增参数若未进入签名，两个不同任务可能被错误当成同一次请求。
- **向后兼容**：旧草稿没有新增字段时补默认值，使历史 Session Storage 数据仍能读取。
- **任务状态保留**：Mask 和高级参数需要跟随任务保存，才能在历史记录和“复用参数”中恢复。
