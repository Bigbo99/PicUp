# PicUp 模型、参数路由与积分完整方案

核对日期：2026-09-22。状态：设计方案，尚未实施，不代表模型已恢复服务或已通过真实调用验证。

本文整合本轮讨论，以本次读取的 OpenAI、Google 官方文档、GrsAI 接口文档和用户提供的 GrsAI 价格截图为依据。凡是“建议”“暂定”“待验证”均为 PicUp 产品或工程决策，不是服务商承诺。本文替代此前讨论中“前台增加精细度选项”和“每个上游模型单独显示”的设计。

## 1. 用户最终看到什么

工作台只提供四个模型系列：Image 2.5、Image 2、Nano Banana 2、Nano Banana Pro。保留现有“自动推荐”，但它按确定的后台规则报价，不代表随机选模型。

用户仍然只操作：输入描述、添加参考图、选择模型、选择比例、选择 1K / 2K / 4K、点击显示积分的发送按钮。

- Image 2.5 放在 Image 2 前面，附“新品”标记；它与 Nano Banana 各有用途，不承诺所有任务都更好。
- 不展示 VIP、Flare、Sunburst、low、high、xhigh、max，不增加精细度开关。
- 沿用现有模型弹层和比例/清晰度弹层，不增加一排工具按钮。
- 同一个前台名称按尺寸路由到不同上游模型，切换尺寸时更新积分和可用状态。
- 高级质量、输出格式、轮询方式由后台配置。海报等工具以后使用独立场景预设。
- 每次提交按一次任务报价，首版目标输出一张；不开放多张输出数量选择。上游意外返回多张结果不追加扣费。

推荐简短模型说明：

| 前台名称 | 列表说明 | 初始尺寸 | 首版参考图上限建议 |
| --- | --- | --- | --- |
| Image 2.5 | 新一代图片生成与编辑 | 1K | 4 张，待 GrsAI 验证 |
| Image 2 | 日常图片生成与编辑 | 1K | 4 张，待 GrsAI 验证 |
| Nano Banana 2 | 日常创作与多图参考 | 1K | 6 张，沿用现有产品配置 |
| Nano Banana Pro | 复杂画面与专业创作 | 1K | 6 张，沿用现有产品配置 |

这里的 4 张和 6 张是 PicUp 的首版产品限额，不能写成 GrsAI 官方上限。切换尺寸保留参考图；如果目标路由上限更低，提示用户调整，不静默删图或偷偷换成另一种收费路由。

## 2. 本次核实的重要事实

1. OpenAI 官方明确定位：Sunburst 适合重视编辑精度的工作流，Flare 适合快速、高质量的日常图片生成。[O1]
2. OpenAI 官方的两个 2.5 模型都支持 `xhigh/max`；GrsAI 的 Flare 仅列出 `low/medium/high`。走中转时按中转支持范围发送。[O1][G1]
3. GrsAI 的 `gpt-image-2` 和 `gpt-image-2.5` 普通版仅开放 1K 与 `quality=auto`；Image 2 的高分辨率由 `gpt-image-2-vip` 承接，质量只能是 `medium`。[G1]
4. 官方 GPT Image 编辑接口最多 16 张输入图；Google 当前生图文档最多 14 张参考图。GrsAI 两个统一生图接口均只写明图片数组支持 URL/Base64，未给出张数上限。[O2][D1][G1][G2]
5. `gpt-image-2-vip` 是 GrsAI 通道名称；普通 `gpt-image-2.5` 在 GrsAI 有明确配置，但本次 OpenAI 官方页面主要列出 Sunburst/Flare。不能擅自认定普通 2.5 对应哪个官方快照。
6. 截图中的“维护中”是截图时状态。本次未调用账户接口或付费生成，不能当成当前实时状态。
7. 现有 Nano Banana Pro 的 4K 配置会调用 `nano-banana-pro-vt`。它的价格不在截图里，不应套用普通 Pro 的 ¥0.12 成本。

## 3. 官方能力与中转开放能力

### 3.1 GPT Image 系列

| 实际接口模型 | 官方能力依据 | GrsAI 当前开放尺寸 | GrsAI 质量参数 | GrsAI 参考图数量 | 透明背景 |
| --- | --- | --- | --- | --- | --- |
| `gpt-image-2` | 官方支持合法自定义尺寸，质量 low/medium/high/auto | 1K；比例或像素值 | auto | 未注明 | 本中转普通版未列入支持名单 |
| `gpt-image-2-vip` | GrsAI 通道名，不是新增官方模型 | 1K / 2K / 4K；使用像素值 | medium | 未注明 | GrsAI 明确支持 |
| `gpt-image-2.5` | 中转普通版；具体官方映射未披露 | 1K；比例或像素值 | auto | 未注明 | 本中转普通版未列入支持名单 |
| `gpt-image-2.5-flare` | 官方支持 low/medium/high/xhigh/max/auto | 1K / 2K / 4K；使用像素值 | low / medium / high | 未注明 | GrsAI 明确支持 |
| `gpt-image-2.5-sunburst` | 官方支持 low/medium/high/xhigh/max/auto | 1K / 2K / 4K；使用像素值 | low / medium / high / xhigh / max | 未注明 | GrsAI 明确支持 |

官方 GPT Image 编辑通用上限是 16 张，不能直接推导中转同样支持 16 张，也不能确认普通 2.5 的内部模型身份。[O2]

官方尺寸约束：宽高为 16 的倍数，最长边不超过 3840，长短边比不超过 3，总像素 655,360～8,294,400；高于 2560×1440 的尺寸被官方标为实验性。GrsAI 自定义约束段落标注“仅限 vip”，同时为 Flare/Sunburst 提供预设像素表，首版优先使用中转给定的预设表。[O1][G1]

### 3.2 Nano Banana 系列

| 前台系列 | Google 当前官方 ID | 官方尺寸档位 | 官方参考图 | GrsAI ID | GrsAI 开放尺寸/参考图 |
| --- | --- | --- | --- | --- | --- |
| Nano Banana 2 | `gemini-3.1-flash-image` | 512px / 1K / 2K / 4K | 最多 14 张 | `nano-banana-2` | 1K / 2K / 4K；张数未注明 |
| Nano Banana Pro | `gemini-3-pro-image` | 1K / 2K / 4K | 最多 14 张 | `nano-banana-pro` | 1K / 2K / 4K；张数未注明 |

Google 还区分不同参考用途：Nano Banana 2 最多 10 张物体参考、4 张人物参考；Pro 表格列出最多 6 张物体、5 张人物、3 张风格参考，整体仍最多 14 张。这是不同参考用途的能力说明，不能理解成任意数量人物都能稳定保持一致。[D1]

Nano Banana 没有与 GPT 相同的 `quality=high/xhigh` 参数。通过 `imageSize` 选择分辨率，按其接口支持的默认行为生成，不能把 GPT 质量参数硬传过去。[G2]

Google 官方 ID 目前为不带 preview 的名称；现有项目官方通道仍配置 preview 上游 ID。官方通道重新启用前需要核实账户可用模型并更新配置，不能静默假定旧别名永久可用。

## 4. 工作台后台路由与完整默认参数

下面是建议配置。普通 1K 使用服务商低成本普通版；Image 2.5 的 2K 使用 Flare high，4K 使用 Sunburst max。Image 2 VIP 只允许 medium，4K 指尺寸最高，不代表它有更高的 quality 档位。

| 前台系列 | 尺寸 | 服务商 | 上游 ID | 后台质量 | 上游尺寸字段 | 首版总输入图限额 | 积分 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Image 2 | 1K | GrsAI | gpt-image-2 | auto | aspectRatio，发送受支持比例 | 4，待验证 | 1 |
| Image 2 | 2K | GrsAI | gpt-image-2-vip | medium | aspectRatio，转换成 2K 像素值 | 4，待验证 | 4 |
| Image 2 | 4K | GrsAI | gpt-image-2-vip | medium | aspectRatio，转换成 4K 像素值 | 4，待验证 | 4 |
| Image 2.5 | 1K | GrsAI | gpt-image-2.5 | auto | aspectRatio，发送受支持比例 | 4，待验证 | 2 |
| Image 2.5 | 2K | GrsAI | gpt-image-2.5-flare | high | aspectRatio，转换成 2K 像素值 | 4，待验证 | 5 |
| Image 2.5 | 4K | GrsAI | gpt-image-2.5-sunburst | max | aspectRatio，转换成 4K 像素值 | 4，待验证 | 5 |
| Nano Banana 2 | 1K | GrsAI | nano-banana-2 | 不传 | aspectRatio + imageSize=1K | 6，需回归验证 | 2 |
| Nano Banana 2 | 2K | GrsAI | nano-banana-2 | 不传 | aspectRatio + imageSize=2K | 6，需回归验证 | 2 |
| Nano Banana 2 | 4K | GrsAI | nano-banana-2 | 不传 | aspectRatio + imageSize=4K | 6，需回归验证 | 2 |
| Nano Banana Pro | 1K | GrsAI | nano-banana-pro | 不传 | aspectRatio + imageSize=1K | 6，需回归验证 | 3 |
| Nano Banana Pro | 2K | GrsAI | nano-banana-pro | 不传 | aspectRatio + imageSize=2K | 6，需回归验证 | 3 |
| Nano Banana Pro | 4K | GrsAI | nano-banana-pro | 不传 | aspectRatio + imageSize=4K | 6，需验证并替换旧 vt 路由 | 3，条件价 |

Pro 4K 的“3 积分”前提是普通 `nano-banana-pro` 的 4K 调用、成本均通过验证。验证前不能直接删除现有 vt 路由后宣布完成，也不能把未知成本的 vt 以这个价格上线；可暂时不开放该组合。

所有路线共同参数：`prompt` 来自描述与结构化参考图引用；`images` 为本轮实际输入的有序 URL/Base64 数组；建议 `replyType=async`；普通工作台省略 `mask/background`；GrsAI 统一接口没有列出的 `n/output_format/input_fidelity` 不发送。默认不改变 GrsAI Key，只增加同服务商下的通道路由。

“自动推荐”首版保留现有业务意图：1K/2K 且少于 4 张参考图时，候选顺序为 Nano Banana 2、Nano Banana Pro；4K 或至少 4 张参考图时，候选顺序为 Nano Banana Pro、Nano Banana 2。参考图数以最终实际发送的总数为准。后台按顺序排除不支持比例、数量、未验证或维护中的路线，选择第一个可用项并返回确定报价。两者都不可用则提示暂无可用模型，不自动加入 GPT 或高价官方路线。该选择发生在报价前，不等于允许提交后任意回退。新品排序不等于擅自修改自动推荐规则。

## 5. 比例、尺寸与智能比例

### 5.1 前台可选比例

共同基础比例：`auto / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9`。

Nano Banana 2 额外提供 `1:4 / 4:1 / 1:8 / 8:1`。这些超宽比例不能带入 Image 2、Image 2.5 或 Nano Banana Pro。不新增中转参数表之外的比例，后续按需求扩展。

### 5.2 GPT VIP / Flare / Sunburst 像素表

以下直接采用 GrsAI 给出的示例映射，不用现有 TokenRun 通用计算函数替代，因为计算结果可能不同。[G1]

| 比例 | 1K 参考像素 | 2K 像素 | 4K 像素 |
| --- | --- | --- | --- |
| 1:1 | 1024×1024 | 2048×2048 | 2880×2880 |
| 16:9 | 1280×720 | 2048×1152 | 3840×2160 |
| 9:16 | 720×1280 | 1152×2048 | 2160×3840 |
| 4:3 | 1152×864 | 2304×1728 | 3264×2448 |
| 3:4 | 864×1152 | 1728×2304 | 2448×3264 |
| 3:2 | 1536×1024 | 2048×1360 | 3504×2336 |
| 2:3 | 1024×1536 | 1360×2048 | 2336×3504 |
| 5:4 | 1120×896 | 2240×1792 | 3200×2560 |
| 4:5 | 896×1120 | 1792×2240 | 2560×3200 |
| 21:9 | 1456×624 | 2912×1248 | 3840×1648 |

普通 Image 2 / 2.5 的 1K 不使用上表的 VIP 1K 像素映射，而按普通版受支持比例发送；其结果尺寸以实际返回为准。GrsAI 给出的普通 Image 2 部分尺寸是 16:9=1672×941、3:2=1536×1024，说明“1K”并不意味着所有长边严格等于 1024。

各家 4K 也不是相同像素：GPT 正方形示例为 2880×2880，Google 官方 Nano Banana 正方形 4K 为 4096×4096。[G1][D1] 前台保留熟悉的档位名称，结果详情显示实际宽高，不宣传所有模型的 4K 都是 4096×4096。

“智能比例＋2K/4K”：GPT 中转虽然列出 auto，但没有独立分辨率字段，直接传 auto 不能保证选中的档位。建议后台按第一张主参考图的比例匹配最近支持比例，无参考图默认 1:1，再按所选档位生成明确像素值。Nano 路线仍传 `aspectRatio=auto` 与明确 `imageSize`。报价快照保存请求尺寸策略：GPT 高分辨率存明确宽高，Nano auto 和普通 GPT 1K 存比例/档位或 auto，不虚构尚未返回的宽高。结果保存实际测得的像素尺寸，并在结果详情展示。

## 6. 参考图、上传与连续编辑

### 6.1 数量必须分三层

| 层次 | GPT Image | Nano Banana 2 / Pro |
| --- | --- | --- |
| 官方可接收数量 | 最多 16 张，编辑接口 | 最多 14 张，生图文档 |
| GrsAI 已公开承诺 | 未注明，不能确认等于 16 | 未注明，不能确认等于 14 |
| PicUp 首版建议限额 | 总输入 4 张，验证后开放 | 总输入 6 张，沿用并验证 |

后续可逐档测试再提高上限，但不要在未验证时宣称支持 14/16 张。现有 DTO 有 `ArrayMaxSize(6)`，增加前台配置不足以放开更多图，需要同步请求校验、引用编辑器、上传、后台配置和测试。

### 6.2 哪些图计入上限

上限针对实际发送给模型的图片总数，包括用户上传的参考图、被明确用作编辑对象的上一轮结果、画板生成的引导图、实际发送的主体裁切图。同一文件重复引用不重复发送。Mask 是单独字段，是否计入中转限额待确认，首版仍限制为一个。

主编辑图必须在第一位；Mask 应匹配第一张主图。连续对话不把所有历史图片自动发送，仅发送本轮所需图片。保留 `parentJobId` 作为业务关联，不等于模型已经获得上一轮图片内容。

### 6.3 文件和请求体

- PicUp 现有上传规则为 JPG/PNG/WebP，单张最大 10 MiB；首版继续保持。[C3]
- Google 官方支持 PNG/JPEG/WebP/HEIC/HEIF，但 PicUp 不因官方支持而直接扩大上传格式。[D2]
- Google 内联图片请求整体限制 20 MB；官方直连如启用，应按编码后的整个请求计算，超出走官方文件上传机制或明确报错。[D2]
- GrsAI 未公开单图大小和请求体总大小，必须另行验证。6 张各 10 MiB 的图转 Base64 后可能约 80 MiB，单图上传通过不代表生成请求能通过。
- 当前 GrsAI 实现为绕过 CDN 防盗链而读取原图并发送 Base64。优先保留已验证路径；大图采用可控缩放/编码预算，或经验证使用服务商可访问的短期签名 URL，不把外链“应该能访问”当作保证。
- OpenAI 官方 Mask 指南要求主图与 Mask 同尺寸、同格式且小于 50 MB，Mask 包含 alpha 通道；PicUp 仍采用更小的自身上传限制。GrsAI Mask 兼容性需要单独验证。[O1]

超限错误应在报价/提交前提示用户，不能自动丢掉参考图，以免改变创作含义。

## 7. 请求协议和参数映射

### 7.1 推荐 GrsAI 统一异步接口

```http
POST https://grsai.dakka.com.cn/v1/api/generate
Authorization: Bearer <server-side-key>
Content-Type: application/json
```

Image 2.5，16:9，4K 的后台示例：

```json
{
  "model": "gpt-image-2.5-sunburst",
  "prompt": "用户描述与参考图用途",
  "images": [],
  "aspectRatio": "3840x2160",
  "quality": "max",
  "replyType": "async"
}
```

Nano Banana 2，16:9，2K 的后台示例：

```json
{
  "model": "nano-banana-2",
  "prompt": "用户描述与参考图用途",
  "images": [],
  "aspectRatio": "16:9",
  "imageSize": "2K",
  "replyType": "async"
}
```

查询结果用 `GET /v1/api/result?id=<task-id>`，沿用 Bearer Key。处理 `running/succeeded/failed/violation`；`violation` 是终止失败，不继续等待，也不自动改换通道重试。接收 `results[].url` 后存入 PicUp 存储，再把任务标成成功。[G3]

### 7.2 与现有实现的差别

当前 GrsAI 代码使用 `/v1/draw/nano-banana`、`urls`、`shutProgress` 和 `POST /v1/draw/result`；新文档使用 `/v1/api/generate`、`images`、`replyType` 和 GET 查询。不能仅改路径而沿用旧请求体/方法。

建议在同一个 GrsAI Provider 内显式区分旧协议与统一协议，新增 Image 系列先走统一协议；Nano 通过回归后再逐条切换，不为每个模型复制 Key。复用下载、存储、错误处理基础能力。

### 7.3 官方 API 与中转参数对照

| 含义 | OpenAI 官方 Images API | Google 官方 Gemini | GrsAI 统一接口 | PicUp 决策 |
| --- | --- | --- | --- | --- |
| 模型 | model | 请求模型 ID | model | 后台路由 |
| 提示词 | prompt，最长 32,000 字符 | 文本输入部分 | prompt，长度未注明 | 继续 4,000 字符产品限制 |
| 参考图 | edits 的图片引用/上传，最多 16 | 图片输入部分，生图最多 14 | images，URL/Base64，张数未注明 | 首版 4/6 张，验证后开放 |
| 尺寸 | size=WIDTHxHEIGHT/auto | image size + aspect ratio | GPT 用 aspectRatio 像素；Nano 用 aspectRatio+imageSize | 用户选比例和档位 |
| 质量 | quality，按模型支持范围 | 没有同名 GPT 质量档位 | GPT quality；Nano 不传 | 全部后台配置 |
| 多张输出 | n=1～10 | 不保证按提示词精确输出张数 | 统一接口未列 n | 不开放数量，按单次任务报价 |
| 格式/压缩 | png/jpeg/webp；jpeg/webp 可设 0～100 | 返回图片媒体类型，按使用的协议设置 | 统一接口未列同名字段 | 不发送未知参数，保留实际文件类型 |
| 透明背景 | 2.5 支持；2 为 preview；输出 png/webp | 本方案不依赖原生透明参数 | background=transparent，仅 VIP/Flare/Sunburst | 专用工具启用 |
| 局部编辑 | mask；应用于第一张输入图 | 不能当成同等 OpenAI mask API | 文档有 mask URL，细节不完整 | 验证后接入现有编辑入口 |
| 输入保真 | 2 不允许调整 input_fidelity；2.5 有通用字段 | 不等同该字段 | 统一接口未列 | 不传 |
| 流式预览 | stream 与 partial_images=0～3 | 流式接口与生图能力按协议处理 | replyType=json/stream/async | 首版用 async，进度不等于预览图 |
| 联网/思考 | 不等同尺寸参数 | 官方存在 Search/Thinking 能力 | 统一接口未公开对应控制字段 | 不承诺中转支持 |

官方通道与中转的协议、账单不同。不能把 Google 当前文档的 Interactions 参数直接塞到现有 `generateContent` 请求里；恢复官方直连时需逐项核对所选接口版本。[D1]

## 8. 积分、成本和毛利

充值建议继续采用 ¥9.90=100 积分、¥19.90=225 积分。最优惠套餐每积分实收约 ¥0.088444；下表用它计算。

| 前台模型/档位 | 成本依据，元/次 | 积分 | 最低收入，元/次 | 仅扣调用成本毛利率 |
| --- | --- | --- | --- | --- |
| Image 2 1K | 600/15000 = 0.04 | 1 | 0.0884 | 54.8% |
| Image 2 2K/4K | 2000/15000 ≈ 0.13333 | 4 | 0.3538 | 62.3% |
| Image 2.5 1K | 600/15000 = 0.04 | 2 | 0.1769 | 77.4% |
| Image 2.5 2K | 2000/15000 ≈ 0.13333 | 5 | 0.4422 | 69.8% |
| Image 2.5 4K | 2400/15000 = 0.16 | 5 | 0.4422 | 63.8% |
| Nano Banana 2 全档 | 1200/15000 = 0.08 | 2 | 0.1769 | 54.8% |
| Nano Banana Pro 全档 | 1800/15000 = 0.12 | 3 | 0.2653 | 54.8% |

成本依据为用户价格截图的 CNY 参考换算，不是本次读取账户账单。截图充值还有 ¥49/750,000 上游积分活动，相当于单价更低；本方案不依赖活动折扣，使用 ¥1/15,000 的参考成本保守定价。

Image 2 相同档位比 Image 2.5 便宜。2K/4K 不强行拉开积分，新增分辨率不等于必须新增价格。Flare/Sunburst 各质量是否另加价、Pro 4K 实际调用成本，均要核实后启用对应路线。

“盈利一半以上”在这里定义为调用毛利率超过 50%，不是净利润超过 50%。最低档 54.8% 留给其他成本的空间有限。例如 Image 2 1K 若希望计入全部变动成本后仍超过 50%，服务器/存储/支付/赠送与失败摊销合计必须低于约 ¥0.00422/次。上线后应按真实账单复算，不能承诺净利润。

成本价设置时用整数分或高精度十进制，不用四舍五入后的 ¥0.13 作为精确成本。若未来上游成本变动，先发布新报价配置，已提交任务价格不变。

### 8.1 扣费规则

发送前给出确定报价；提交后锁定配置版本、实际模型、参数、尺寸策略、积分。在同一个数据库事务内检查可用余额、冻结本次积分并建立任务；已冻结积分不可用于其他并发任务。成功后将冻结转为已消费，最终失败释放冻结，前台可以显示“退回积分”。如果沿用现有“先扣后退”的账本实现，也必须满足相同原子性和幂等性，不必为文字命名重建账本。同任务系统重试不重复向用户扣费。用户主动重新生成是新任务。

上游成功但下载临时失败，先重试下载已有结果，不直接再付费生成。已取得 task ID 的超时先恢复查询，不盲目新建任务。若运营选择退分后仍轮询到结果，必须有唯一终态策略，不能再自动补扣。

上游内容拒绝不自动换模型规避。PicUp 可按失败退积分政策处理，但并非每个通道都退还上游费用，CL/VIP 等截图有“违规不返还”的通道，该损失需计入运营成本。

### 8.2 旧积分迁移

当前真实套餐为 ¥9.9=20 积分、¥19.9=45 积分。实施新方案时余额单位乘 5，套餐也乘 5，旧余额购买价值不会仅因面额变化缩水。

迁移必须单独实施并可审计：暂停新扣费、处理在途任务和待支付订单、记录每个账户换算流水、升级赠送规则与定价版本，再恢复。旧账单不改写；旧订单按创建时规则结算后转换到统一单位，不能按回调时新套餐重复放大。历史任务退款要按其原计费单位转换，不能退错数量。

## 9. 其他模型与备用渠道的处理

“所有模型”在本方案中覆盖四个前台系列、五个 GPT 中转 ID、截图中的 Nano 变体，以及项目已有官方/TokenRun 渠道。以下模型可以保留后台配置，但不因为服务商提供就全部放入前台。

| 通道/模型 | 截图成本或依据 | 尺寸/参数证据 | 处理建议 |
| --- | --- | --- | --- |
| nano-banana-2-lite | 440 积分，约 ¥0.02933 | Google 对应 Lite 仅 1K；GrsAI 模型列表有它，但统一接口支持模型列表未列 | 暂不开放，先核实 ID 与多图能力 |
| nano-banana-fast | 同上 | 截图称基于 Flash Lite；统一接口列有 ID，但没有独立尺寸说明 | 不能套用 Nano 2 的全档位，待验证 |
| nano-banana（旧款） | 截图无本次单独价格 | Google 旧款为 2.5 Flash Image；GrsAI 内部映射未保证一致 | 不新增到前台 |
| nano-banana-2-cl | ¥0.40 | 截图标 1K | 不作低价路线的隐形回退 |
| nano-banana-2-2k-cl | ¥0.60 | 截图标 2K | 同上 |
| nano-banana-2-4k-cl | 13000 积分，约 ¥0.86667 | 截图标 4K | 同上 |
| nano-banana-pro-cl | 10000 积分，约 ¥0.66667 | 截图标 1K | 同上 |
| nano-banana-pro-vip | 同上 | 截图标 1K/2K | 不能按普通 Pro 的 ¥0.12 估价 |
| nano-banana-pro-4k-vip | ¥1.20 | 截图标 4K | 不自动回退，成本远高于 3 积分收入 |
| nano-banana-pro-vt | 截图未提供 | 统一文档列有 ID；项目目前用在 Pro 4K | 查清成本/能力后独立配置，不能与 vip 混同 |
| TokenRun GPT Image 2 | 用户提供 ¥0.20/次 | 当前代码允许 1K/2K/4K、4 图；中转文档未提供 | 保留历史任务，退出默认新单路线；不作为 1 积分隐形回退 |
| Gemini 官方 Nano 2/Pro | 按美元 token 计费 | 官方最多 14 图，1K/2K/4K；Nano 2 另有 512px | 当前 provider 停用，保持后台备用，重新核价后启用 |

Google 官方标准输出价格示例：Nano 2 的 1K/2K/4K 约 $0.067/$0.101/$0.151；Pro 的 1K/2K 约 $0.134，4K 约 $0.24，另有输入等费用。[D3] OpenAI 2.5 官方按 token 计费，图像输入 $8/百万、图像输出 $30/百万，文本输入 $5/百万，不能用 GrsAI 的固定单次成本替代。[O4]

已有旧任务保持原 provider/model 身份供历史展示和结果下载；新任务由稳定的前台系列 ID 路由，不能把旧 TokenRun 任务改写成 GrsAI 任务。

## 10. 后台配置与报价一致性

建议采用“前台系列 + 少量路线 + 工具预设”的配置，不引入复杂通用规则引擎。

每条路线保存：系列 ID、场景 ID、尺寸档位、provider、协议类型、上游 model、quality、尺寸映射、允许比例、参考图上限、输入字节预算、透明/Mask 支持标志、积分、成本依据、启用状态、配置版本、验证日期。

工作台只需 12 个尺寸组合，上文已全部列出。配置后台使用表格编辑：一行一个组合；管理员可见参数，普通用户不可见。

一次选择的处理顺序：

1. 根据系列、尺寸和场景选路线，并校验全部输入图、比例、文件预算和维护状态。
2. 确定请求尺寸策略与质量，计算积分，返回绑定输入指纹和配置版本的报价凭据；上游自动选择的最终宽高留待结果返回。
3. 前端收到最新报价后允许发送；连续切换选项时，旧报价响应不得覆盖新选择。
4. 提交时后端验证报价凭据与可用性，在同一事务内检查余额、冻结积分、建立任务并保存不可变任务配置快照。重复提交复用同一任务，不重复冻结。
5. Worker 严格按快照调用，不在执行时再次读取已变动的默认模型配置。

客户端不能自己指定隐藏质量来获得更高档位，不能自己提交积分或借用海报工具 ID 调用高质量路线。后端始终决定真实路由和应付积分。

同一任务中的回退只允许预先配置、参数兼容、成本可承受的路线；不降低用户选定的尺寸，不临时补扣。没有兼容路线时提示该组合暂不可用。默认不跨到官方或高价 CL/VIP 渠道兜底。

项目现有 `quality` 字段实际上存的是 `1K/2K/4K`，实施时不要把它突然改成 `high`。可在接口兼容期继续保留原字段，在解析后的内部对象使用 `resolution` 和 `generationQuality` 区分，避免大范围重命名。

## 11. 后续海报等工具

| 场景 | 推荐初始路线 | 隐藏默认参数 | 用户输入 | 收费方式 |
| --- | --- | --- | --- | --- |
| 普通工作台 | 按第 4 节 | 由尺寸决定 | 描述、参考图、模型、比例、尺寸 | 第 8 节 |
| 海报制作 | Sunburst | quality=xhigh；尺寸默认 2K；海报专用提示词模板 | 标题、正文、风格、参考图、比例/尺寸 | 按工具成本单独报价，暂不定价 |
| 品牌/商品一致性编辑 | Sunburst | 经对比选择 high/xhigh；明确保留元素 | 主图、品牌参考、修改要求 | 同上 |
| 透明商品图 | 经验证的 VIP/Sunburst | background=transparent；透明输出验证 | 主图和用途 | 同上 |

工具只展示“海报制作”等用途和价格，不展示 xhigh。一个工具可能使用文本整理、一次或多次生图，其收费覆盖完整工作流，不能直接套用一次工作台调用的价格。

工具与工作台共享 Key、协议适配和账本，但质量默认值独立。后续将海报从 xhigh 调到其他档位，不改变工作台同尺寸的默认质量。

## 12. 实施范围和验收

### 12.1 需要修改的模块

| 模块 | 必要改动 |
| --- | --- |
| shared 类型与模型目录 | 前台系列、路线能力、报价结果；保留旧字段兼容 |
| ai-config 和管理后台 | 同服务商下每尺寸路线、质量、积分、能力和启用状态 |
| GrsAI Provider | 新协议请求/GET 查询/violation 终态；沿用 Key 和输出存储 |
| Models / Jobs / Worker | 一个权威路由解析器，报价与执行使用同一快照 |
| 工作台 | 仍只提供模型/比例/尺寸；动态报价、数量上限、不可用状态 |
| 图片预览编辑 | 接入同一报价规则，原有背景操作写死 1 积分需替换 |
| 上传与 DTO | 以路由校验数量/字节预算，未来提升数量不能只改前端 |
| Payments / 账本 | 套餐、迁移、在途订单、退款单位兼容 |

### 12.2 上线前必须确认

- GrsAI 五条 GPT 路线分别验证无图、1 图、4 图；Nano 验证无图、1 图、6 图，超限不会静默丢图。
- 验证 1K/2K/4K 的真实输出尺寸、1:1/16:9/9:16，以及智能比例行为；Nano 2 验证一个额外超宽比例。
- Flare high、Sunburst max 真实调用成本和失败返还；维护结束后再启用。
- 普通 Pro 4K 与旧 pro-vt 的成本、能力和切换策略。
- 检查数据传输大小，尤其是多张接近 10 MiB 的图；验证下载、防盗链、轮询恢复。
- 报价与实际扣费一致，快速切换选项不显示旧价；重复提交不重复扣费；失败只退款一次。
- 发布新配置后在途任务保持旧快照；迁移前后历史退款、待支付订单均正确。
- 手机和桌面布局保持现有样式，不出现技术参数、不重复显示同一系列的通道名称。

先做不产生上游费用的协议/报价/边界测试，再按限定数量进行真实小额验证。当前文档阶段没有发起付费生成、充值、余额迁移或部署。

## 13. 资料索引

### 官方来源

- [O1 OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)：Sunburst/Flare 定位、质量档位、自定义尺寸、Mask、输出和成本说明。
- [O2 OpenAI Images edit reference](https://developers.openai.com/api/reference/resources/images/methods/edit)：16 张参考图、32,000 字符、Mask、透明背景、输出数量。
- [O3 OpenAI Images generate reference](https://developers.openai.com/api/reference/resources/images/methods/generate)：生成参数、n、格式、压缩和流式参数。
- [O4 OpenAI Pricing](https://developers.openai.com/api/docs/pricing)：官方 token 单价，不能当作中转固定价格。
- [D1 Google Nano Banana image generation](https://ai.google.dev/gemini-api/docs/image-generation)：官方模型 ID、最多 14 张参考图、参考用途分类、尺寸和比例。
- [D2 Google Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)：输入格式、内联请求 20 MB 限制和文件上传。
- [D3 Google Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)：官方输入/输出费用。

### 中转来源

- [G1 GrsAI GPT Image 2 / 2.5](https://qmy27nhsd9.apifox.cn/452409160e0)：五个模型、质量范围、像素表、images、透明背景。
- [G2 GrsAI Nano Banana](https://qmy27nhsd9.apifox.cn/452392911e0)：各通道 ID、比例、imageSize、images、replyType。
- [G3 GrsAI 异步结果查询](https://qmy27nhsd9.apifox.cn/452409577e0)：GET 查询、id、结果状态。
- [G4 GrsAI OpenAI edits 兼容接口](https://qmy27nhsd9.apifox.cn/512807352e0)：兼容接口字段。示例中普通 2.5 带透明背景，但支持名单未包含普通版；本方案采用明确的模型支持名单，不依据矛盾示例开放能力。
- P1 本对话中用户提供的 GrsAI 完整价格截图（附件名 `codex-clipboard-e8f099dd-53eb-46f4-8ffd-b72f15b9b242.png`）：15 个图片模型、上游积分、CNY 换算、维护及返还标记。本次文件检查未找到原临时文件，以上价格依据对话内图片读取；实施时应保存新的价格快照并复核账户账单。

### 当前项目依据

- [C1 工作台](../apps/web/src/components/studio/studio.tsx)：现有模型/尺寸弹层、参考图限制、报价调用。
- [C2 GrsAI Provider](../apps/api/src/modules/providers/grsai.provider.ts)：旧协议、模型覆盖、Base64 输入和轮询。
- [C3 上传限制](../apps/api/src/modules/files/files.service.ts)：10 MiB、JPG/PNG/WebP。
- [C4 任务 DTO](../apps/api/src/modules/jobs/dto.ts)：4,000 字符与最多 6 个 imageIds。
- [C5 任务计费](../apps/api/src/modules/jobs/jobs.service.ts)：当前按模型 costCredits，背景操作另有写死费用。
- [C6 充值套餐](../apps/api/src/modules/payments/payments.service.ts)：现有 20/45 积分套餐。
- [C7 模型目录](../packages/shared/src/model-catalog.ts)：当前前台模型能力与默认值。

## 14. 新增技术术语说明

- **能力交集**：最终可用能力必须同时满足官方、中转通道和 PicUp 实现的限制；不能仅看官方最高规格。
- **配置快照**：提交时保存本次任务使用的完整参数与价格副本，后台以后改默认值也不会影响正在生成的任务。
- **幂等**：同一个请求因网络问题重复发送，系统仍只建立一次任务、扣一次积分、退一次款。
- **请求体预算**：不仅限制单张图片，还限制发送给服务商的整包数据大小，Base64 编码会额外放大数据。

模型路由、组合报价、场景预设、毛利率等概念此前已解释，本文用具体配置说明，不再重复定义。
