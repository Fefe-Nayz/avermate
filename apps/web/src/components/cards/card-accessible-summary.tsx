/**
 * The exact reading behind a chart, in document order.
 *
 * Tooltips remain the compact visual interaction; this text is the equivalent for a
 * screen reader. It is deliberately not `aria-hidden`, and it is not a second caption:
 * several chart figures already own a visible `figcaption` explaining their semantics.
 */
export function CardAccessibleSummary({ items }: { items: readonly string[] }) {
  const spoken = items.filter((item) => item.trim().length > 0)
  if (spoken.length === 0) return null
  return (
    <p className="sr-only" data-card-accessible-summary>
      {spoken.join("; ")}
    </p>
  )
}
