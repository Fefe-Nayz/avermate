export interface RecordingUploadItem {
  seq: number
}

export interface RecordingUploadSnapshot {
  pendingCount: number
  uploadingSeq: number | null
  failedSeq: number | null
  error: unknown
}

const EMPTY_SNAPSHOT: RecordingUploadSnapshot = {
  pendingCount: 0,
  uploadingSeq: null,
  failedSeq: null,
  error: null,
}

/**
 * A tiny external store around a strict FIFO. A failed item remains at the
 * head, so retrying reuses its original sequence number and server idempotency
 * key instead of silently skipping or duplicating audio.
 */
export class RecordingUploadQueue<T extends RecordingUploadItem> {
  private readonly items: T[] = []
  private readonly completed = new Set<number>()
  private readonly listeners = new Set<() => void>()
  private active: Promise<void> | null = null
  private snapshot: RecordingUploadSnapshot = EMPTY_SNAPSHOT

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = () => this.snapshot

  enqueue(item: T): boolean {
    if (
      this.completed.has(item.seq) ||
      this.items.some((candidate) => candidate.seq === item.seq)
    ) {
      return false
    }
    this.items.push(item)
    this.publish({})
    return true
  }

  drain(upload: (item: T) => Promise<unknown>): Promise<void> {
    if (this.active) return this.active
    if (this.items.length === 0) {
      this.publish({ failedSeq: null, error: null })
      return Promise.resolve()
    }

    this.publish({ failedSeq: null, error: null })
    const run = async () => {
      while (this.items.length > 0) {
        const item = this.items[0]
        if (!item) return
        this.publish({ uploadingSeq: item.seq })
        try {
          await upload(item)
        } catch (error) {
          this.publish({ uploadingSeq: null, failedSeq: item.seq, error })
          throw error
        }
        this.items.shift()
        this.completed.add(item.seq)
        this.publish({ uploadingSeq: null })
      }
    }

    const tracked = run().finally(() => {
      if (this.active === tracked) this.active = null
      this.publish({ uploadingSeq: null })
    })
    this.active = tracked
    return tracked
  }

  private publish(change: Partial<RecordingUploadSnapshot>) {
    this.snapshot = {
      pendingCount: this.items.length,
      uploadingSeq:
        change.uploadingSeq === undefined
          ? this.snapshot.uploadingSeq
          : change.uploadingSeq,
      failedSeq:
        change.failedSeq === undefined
          ? this.snapshot.failedSeq
          : change.failedSeq,
      error: change.error === undefined ? this.snapshot.error : change.error,
    }
    for (const listener of this.listeners) listener()
  }
}
