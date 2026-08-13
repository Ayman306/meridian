import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/states'

/** A screen whose module is scheduled but not yet built. */
export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        title="Not built yet"
        description={`${title} arrives in ${phase}. The route, shell and guards are already in place.`}
      />
    </>
  )
}
