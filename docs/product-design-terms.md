# Product and Design Notes

Delivery preference: explain completed changes with standard product and design terminology in Chinese.
Keep each explanation tied to a concrete behavior rather than listing jargon.

| Term | Meaning in PicUp |
| --- | --- |
| 信息架构 (Information Architecture) | 将创作、对话历史、图片资产库、账户偏好分为独立入口。 |
| 会话管理 (Conversation Management) | 按创作链聚合任务，找回最近一轮并继续编辑。 |
| 数字资产管理 (Digital Asset Management, DAM) | 管理上传和生成的图片，支持搜索、重命名、预览、下载、引用与移除。 |
| 增删改查 (CRUD) | 上传/自动入库、移除、重命名、搜索和查看。修改图片内容通过“用于创作”产生新版本。 |
| 用户偏好 (User Preferences) | 将默认清晰度、比例、发送方式、自动继续编辑和主题保存到账户。 |
| 系统主题适配 (System Theme) | 默认跟随客户端浅色/深色设置，并响应系统设置变化；允许用户覆盖。 |
| 非破坏性操作 (Non-destructive Editing) | 从资产库移除不删除对话图片；修改图片产生新版本。 |
| 渐进披露 (Progressive Disclosure) | 常用操作直接显示，低频参数收进设置面板。 |
| 一体化输入区 (Composer) | 将参考图、文字输入、模型、参数、费用和发送整合到同一区域。 |
| 锚定浮层 (Popover) | 桌面端在模型或参数按钮附近展开选择面板，保持操作与上下文的关系。 |
| 底部面板 (Bottom Sheet) | 手机端从底部展示参数选项，便于触达。 |
| 选中态 (Selected State) | 使用勾选标记和底色反馈当前模型、比例、清晰度。 |
| 设计令牌 (Design Tokens) | 将背景、文字、边框和交互色定义为统一变量，浅色与深色使用相同语义。 |
| 视觉层级 (Visual Hierarchy) | 用字重、间距和对比度区分主要内容、操作与辅助信息，减少不必要的边框。 |
| 自适应输入框 (Auto-resizing Textarea) | 输入框随文字增高，达到上限后在内部滚动。 |
| 全局导航 (Global Navigation) | 创作和图库保留在主导航；对话历史移至右上角，账户入口固定在左下角。 |
| 账户入口整合 (Account Menu) | 登录、昵称、登录状态和账户设置通过同一入口呈现，取代独立的“我的”。 |
| 模态登录 (Modal Authentication) | 在当前创作页内打开登录和注册弹窗，登录完成后关闭弹窗并保留草稿。 |
| 状态反馈 (Status Feedback) | 二维码区分别呈现加载、等待确认、成功、过期和失败，提供明确的重试入口。服务端未提供单独的“已扫码”状态时不模拟它。 |
| 响应式布局 (Responsive Layout) | 登录在桌面端居中，在移动端使用底部面板；小屏和横屏允许内容滚动。 |
| 用户体验文案 (UX Writing) | 将接口错误转为清楚的中文原因与下一步操作，例如“邮箱或密码不正确，请检查后重试”。 |
| 缩略图堆叠 (Thumbnail Stack) | 多张参考图收成带数量的堆叠，点击展开管理，减少输入区占用。 |
| 指令预设 (Prompt Preset) | 技能标签填入可编辑的创作指令，保留原输入并等待用户发送；当前仍使用通用图片生成流程。 |
| 斜杠命令 (Slash Commands) | 输入 `/` 筛选技能，方向键选择、Enter 填入、Esc 关闭。 |
| 点击外部关闭 (Click Outside to Dismiss) | 点击弹窗外的遮罩关闭窗口；从窗口内部拖到外部不触发关闭。 |
| 焦点管理 (Focus Management) | 弹窗打开时限制键盘焦点，关闭时返回触发位置，嵌套预览返回上一层。 |
| 环境覆盖配置 (Environment Override) | 本地 Docker 使用 localhost 和非 Secure Cookie 验证登录；正式部署继续使用 HTTPS 安全配置。 |

Current implementation: conversations are grouped by the root of the existing parent-job chain.
本轮新增术语：

| 名词 | 本次应用 |
| --- | --- |
| 全屏图片查看器 (Image Viewer / Lightbox) | 将看图与编辑分开，支持缩放、拖动、切图和明确的关闭入口。 |
| 安全区适配 (Safe Area) | 工具栏避开手机刘海和底部手势区域。 |
| 价格透明 (Pricing Transparency) | 参数确定后显示本次积分消耗，紧邻发送按钮，输入文字不重新计价。 |
| 按需披露 (Progressive Disclosure) | 充值套餐通过积分入口展开，避免账户页堆积无关操作。 |
| 偏好持久化 (Preference Persistence) | 默认模型、比例和主题保存到账户，单项修改保留其他偏好。 |
| 自动轮询 (Polling) | 支付结果自动查询，关闭窗口、进入后台或订单结束后停止定时查询。 |
| 同源资源访问 (Same-origin Resource Access) | 图片通过本站权限校验后读取，降低浏览器跨站加载依赖。 |
| 模态弹窗 (Modal Dialog) | 画板作为独立任务层居中打开，保留背景上下文并支持点击遮罩关闭。 |
| 工具状态机 (Tool State Machine) | 选择、画笔、文字、形状和橡皮擦共享明确的当前状态，避免工具按钮与编辑器状态不一致。 |
| 渐进式错误反馈 (Progressive Error Feedback) | 空画布、导出失败和保存中状态在画板内即时反馈，不静默关闭窗口。 |
| 对话层级 (Conversation Hierarchy) | 用户消息、助手回复和结果图片使用不同的宽度、对齐和间距，形成清晰的信息层级。 |
| 内容列 (Content Column) | 结果图片限制在助手回复的最大阅读宽度内，避免媒体撑满整行。 |
| 响应式媒体 (Responsive Media) | 图片根据容器和视口自适应缩放，同时保留最大宽高和完整比例。 |
| 会话连续性 (Conversation Continuity) | 同一会话中的每次生成都链接到上一轮任务，用户可以在当前对话中向上滚动查看完整过程。 |
| 会话边界 (Conversation Boundary) | 点击“新建”后清空父任务关系，后续生成进入新的历史记录。 |
| 非破坏式预览 (Non-destructive Preview) | 点击历史图片只打开灯箱，不改变当前会话、路由或编辑上下文。 |
| 会话轴灯箱 (Conversation Lightbox) | 同一会话中的多张结果在同一个灯箱内连续切换，预览结束后仍停留在原对话位置。 |
| 缩略图导航 (Thumbnail Navigation) | 在灯箱侧边提供同组图片的缩略图，当前图片高亮，可直接切换。 |
| 缩放控制器 (Zoom Control) | 通过缩小、百分比、放大三个控件调整图片查看比例，桌面端也支持滚轮。 |
| 会话范围灯箱 (Session-scoped Lightbox) | 预览范围限定在当前会话的结果集合内，不离开当前对话，也不切换任务上下文。 |
| 内容自适应容器 (Content-fit Container) | 图片容器跟随图片内容收缩，图片超过内容列时再按最大宽高缩放。 |
| 媒体边界约束 (Media Boundary Constraint) | 无论输出分辨率是多少，图片都不能突破对话内容列和视口边界。 |

This is not a separate conversation entity. Large accounts currently require loading their
job metadata before grouping/pagination; a persisted conversation table is the next scaling step.
Asset metadata and preferences are persisted in PostgreSQL and isolated by account.
Theme coverage includes the studio, account, library, conversation drawer, settings and payment dialogs.
