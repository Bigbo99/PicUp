# 图像模型参数与渠道核实

核对日期：2026-09-28。

## 官方依据

| 模型 | 参数依据 | PicUp 预设 |
| --- | --- | --- |
| GPT Image 2 / 2.5 Flare / 2.5 Sunburst | [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation) | 1K / 2K / 4K，11 种比例（含自动），应用最多接收 6 张参考图 |
| Gemini 3.1 Flash Image | [Google image generation](https://ai.google.dev/gemini-api/docs/image-generation) | 512 / 1K / 2K / 4K，包含极宽、极窄比例 |
| Gemini 3 Pro Image | 同上 | 1K / 2K / 4K，常用比例 |
| GrsAI Nano Banana 2 / Pro | [GrsAI 渠道接口文档](https://grsai.ai/dashboard/documents/nano-banana) | 渠道明确支持 1K / 2K / 4K；2 支持额外四种长宽比 |

1K、2K、4K 是 PicUp 的分辨率档位，不是 OpenAI 的 quality 枚举。OpenAI 请求使用具体的 `size=宽x高` 或 `auto`。宽高为 16 的倍数，最长边不超过 3840，最长边与最短边之比不超过 3，总像素为 655,360 到 8,294,400。超过 2560x1440 的输出是实验能力。

GPT Image 2 的渲染 quality 为 auto / low / medium / high；2.5 另有 xhigh / max。现有适配器保持 1K→low、2K→medium、4K→high 的调用策略，渠道已配置 imageQuality=high 时保持覆盖。后台详情分别展示这两种参数，且可选择比例查看实际请求像素尺寸。

Google 官方上限是 14 张参考图；PicUp 请求入口当前最多接受 6 张，因此预设采用应用上限。GrsAI 文档没有在该页面明确参考图数量上限，预设中的 6 也仅表示应用限制。

## DouFu 渠道证据

使用现有服务器密钥只读查询 `/v1/models`，未触发付费出图：

- `openai-images-0a3c1dc8`（doufu-1-2k）：HTTP 200，列出 `gpt-image-2`、`gpt-image-2.5-sunburst`。
- `openai-images-513c048b`（doufu-4k）：HTTP 200，列出 `gpt-image-2.5-sunburst-4k`。
- [DouFu 公开指南](https://doufuapi.com/guide/welcome)和[模型广场](https://doufuapi.com/model-plaza)未给出这些分组的图片分辨率保证。

因此目前只能确认模型被渠道列出，不能确认每一种尺寸、编辑或透明背景都可用。现有 1K/2K 限制不会被官方 4K 能力覆盖。带 `-4k` 等自定义后缀的模型不自动推断为官方模型；现有配置可保留、查看、启停，但未知别名不能通过预设新建。

## 管理流程与维护

渠道保存连接地址、密钥和协议后，在“添加模型”中勾选模型。OpenAI 兼容渠道实时获取目录；Gemini 和 GrsAI 目前使用已核实文档的目录，界面注明尚未验证密钥权限。网络失败不会回退到伪造的成功列表。

预设唯一来源是 `packages/shared/src/image-model-presets.ts`。新模型按预设添加；已有模型应用预设时取现有范围与文档范围的交集，保留价格、启停、上游映射和渠道限制。未知模型需要先补充有来源的预设，不允许模糊前缀匹配。

启用报错来自部分更新 DTO 中值为 undefined 的字段覆盖了已有数组；服务端现在只合并实际提供的字段。新增回归测试覆盖部分更新、目录只读、选择性导入、配置并发变化、渠道限制与尺寸映射。
