import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /** Require the user to type this exact string. For the genuinely dangerous. */
  typeToConfirm?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  typeToConfirm,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      setTyped('')
      el.showModal()
    }
    if (!open && el.open) el.close()
  }, [open])

  const canConfirm = !typeToConfirm || typed.trim().toUpperCase() === typeToConfirm.toUpperCase()

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      onClose={onCancel}
      className="max-w-md rounded-lg border border-border bg-card p-0 text-card-foreground backdrop:bg-black/50"
    >
      <div className="space-y-3 p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {typeToConfirm && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="confirm-phrase">
              Type <span className="font-mono">{typeToConfirm}</span> to continue
            </label>
            <input
              id="confirm-phrase"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              autoComplete="off"
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
