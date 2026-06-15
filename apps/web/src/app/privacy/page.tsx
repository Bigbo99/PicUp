import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

const sections = [
  {
    title: '我们收集的信息',
    body: '为了提供服务，我们可能处理你的邮箱、登录状态、昵称、上传图片、提示词、生成任务、输出结果、积分余额、充值订单、设备信息和必要日志。'
  },
  {
    title: '使用目的',
    body: '这些信息用于账号认证、图片生成、任务历史展示、订单处理、积分结算、安全风控、故障排查、客服支持和服务质量改进。'
  },
  {
    title: '存储与保护',
    body: '我们会采用合理的技术和管理措施保护数据安全，并仅在实现服务目的所需范围内保存信息。上传内容和生成结果的保留周期以产品功能和运维要求为准。'
  },
  {
    title: '第三方服务',
    body: '图片生成、对象存储、邮件发送、微信支付或微信扫码登录等功能可能依赖第三方服务。我们会在必要范围内向相关服务传输完成处理所需的信息。'
  },
  {
    title: '你的权利',
    body: '你可以在账号页面更新资料，也可以联系 PicUp 请求访问、更正、删除或撤回相关授权。部分信息删除后，可能影响账号、历史任务或订单查询能力。'
  }
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink sm:px-6">
      <article className="mx-auto max-w-3xl rounded-lg border border-line bg-white p-5 shadow-panel sm:p-8">
        <Link className="mb-6 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-bold hover:border-teal-600 hover:text-teal-700" href="/login">
          <ArrowLeft size={18} aria-hidden />
          返回注册
        </Link>
        <p className="text-sm font-bold text-teal-700">PicUp Legal</p>
        <h1 className="mt-2 text-3xl font-black">隐私政策</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          以下为站内可阅读版本。正式法务文本可直接替换本页内容，注册页的协议勾选与弹窗逻辑无需变更。
        </p>
        <div className="mt-8 grid gap-5">
          {sections.map((section) => (
            <section key={section.title} className="border-t border-line pt-5">
              <h2 className="text-xl font-bold">{section.title}</h2>
              <p className="mt-2 text-sm leading-7 text-muted">{section.body}</p>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
