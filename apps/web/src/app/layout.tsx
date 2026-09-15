import type { Metadata } from 'next';
import { NotificationProvider } from '@/components/notification-provider';
import { QueryProvider } from '@/components/query-provider';
import './globals.css';
import './studio.css';

export const metadata: Metadata = {
  title: 'PicUp 片刻 P 图',
  description: '上传图片，说一句话就能改。',
  icons: {
    icon: '/brand/picup-icon.png'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('picup:theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.studioTheme=t==='dark'||(t!=='light'&&d)?'dark':'light'}catch(e){}})()` }} /></head>
      <body>
        <QueryProvider>
          <NotificationProvider>{children}</NotificationProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
