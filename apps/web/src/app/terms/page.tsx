import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

const sections = [
  {
    title: '服务内容',
    body: 'PicUp 提供图片上传、AI 图片生成、图片编辑、结果下载、历史任务和账号相关服务。具体能力、模型、分辨率、积分消耗和免费次数以产品页面实际展示为准。'
  },
  {
    title: '账号与安全',
    body: '你应使用真实、可接收通知的邮箱完成注册，并妥善保管登录凭证。因你主动共享账号、设备或验证码造成的风险，由你自行承担。'
  },
  {
    title: '内容规范',
    body: '你承诺不会上传、输入、生成或传播违法违规、侵权、欺诈、骚扰、暴力、色情、恶意代码、侵犯隐私或其他不适当内容。PicUp 可以基于安全、合规或运营需要拒绝处理相关任务。'
  },
  {
    title: '积分与生成',
    body: '生成任务会按系统规则自动判断扣费方式：优先使用可用积分；积分不足时使用可用免费次数；二者都不足时需要充值。使用积分生成失败时，系统会按服务端记录自动返还预扣积分。'
  },
  {
    title: '免责声明',
    body: 'AI 生成结果可能存在不准确、不完整或不符合预期的情况。你在商业发布、广告投放或其他重要场景使用结果前，应自行完成必要审核和权利确认。'
  }
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink sm:px-6">
      <article className="mx-auto max-w-3xl rounded-lg border border-line bg-white p-5 shadow-panel sm:p-8">
        <Link className="mb-6 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-bold hover:border-teal-600 hover:text-teal-700" href="/login">
          <ArrowLeft size={18} aria-hidden />
          返回注册
        </Link>
        <p className="text-sm font-bold text-teal-700">PicUp Legal</p>
        <h1 className="mt-2 text-3xl font-black">用户协议</h1>
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
