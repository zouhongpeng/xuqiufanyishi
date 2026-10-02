import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '需求拆解师',
  description:
    '对话式需求拆解工具：输入一个模糊想法，AI 判断清晰度并追问关键问题，直至拆出一份含方案与行动清单的完整报告。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`antialiased`}>
        {children}
      </body>
    </html>
  );
}
