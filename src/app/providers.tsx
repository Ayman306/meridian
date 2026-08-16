'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { AuthProvider } from '@/providers/AuthProvider'
import { CoupleProvider } from '@/providers/CoupleProvider'
import { AccessProvider } from '@/providers/AccessProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { PwaProvider } from '@/providers/PwaProvider'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <CoupleProvider>
              <AccessProvider>
                <PwaProvider>{children}</PwaProvider>
              </AccessProvider>
            </CoupleProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
