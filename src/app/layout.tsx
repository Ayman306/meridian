import type { Metadata, Viewport } from 'next'
import { Providers } from '@/app/providers'
import { APP_NAME } from '@/lib/constants'
import '@/index.css'

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Travel planning for long-distance couples.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0d12',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
