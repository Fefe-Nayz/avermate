import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TimestampedTranscript } from "./recording-playback"

describe("timestamped lecture transcript", () => {
  test("renders exact timestamps as keyboard-native seek buttons", () => {
    const html = renderToStaticMarkup(
      <TimestampedTranscript
        seekLabel="Play from"
        onSeek={() => undefined}
        segments={[
          { startMs: 0, endMs: 8_000, text: "Opening idea" },
          { startMs: 65_000, endMs: 72_000, text: "Worked example" },
        ]}
      />
    )

    expect(html).toContain("<button")
    expect(html).toContain('aria-label="Play from 0:00"')
    expect(html).toContain('aria-label="Play from 1:05"')
    expect(html).toContain("Opening idea")
    expect(html).toContain("Worked example")
  })
})
