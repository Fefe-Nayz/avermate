import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

const FORMS = [
  "../grades/grade-form.tsx",
  "../subjects/subject-form.tsx",
  "../goals/goal-form.tsx",
  "../averages/average-form.tsx",
  "../cards/card-form.tsx",
]

describe("form flows", () => {
  test("every form is a flow of steps, not one long screen", async () => {
    for (const path of FORMS) {
      const form = await source(path)
      expect(form).toContain("FormFlow")
      expect(form).toContain("const steps: FlowStep[]")
      // A step without a summary cannot be read back on the review screen,
      // which is the whole reason the phone has one.
      expect(form).toContain("summary:")
    }
  })

  test("the phone shows one step and the desktop shows all of them", async () => {
    const flow = await source("./form-flow.tsx")

    // The two surfaces are separate branches on purpose: a stepper on a laptop
    // is busywork, and a wall of fields on a phone is what this replaced.
    expect(flow).toContain("hidden flex-col gap-6 md:flex")
    expect(flow).toContain("md:hidden")
    expect(flow).toContain("role=\"progressbar\"")
    expect(flow).toContain("function Review(")
  })

  test("the primary action stays above the keyboard on a phone", async () => {
    const flow = await source("./form-flow.tsx")

    expect(flow).toContain("fixed inset-x-0 bottom-0")
    expect(flow).toContain("env(safe-area-inset-bottom)")
    // Static again on desktop, where nothing needs pinning.
    expect(flow).toContain("md:static")
  })

  test("a step can refuse to be left behind", async () => {
    const flow = await source("./form-flow.tsx")

    expect(flow).toContain("step?.validate && !step.validate()")
    expect(flow).toContain("haptic(\"warning\")")
  })

  test("choices take the whole screen on a phone", async () => {
    const layer = await source("./full-screen-layer.tsx")

    expect(layer).toContain("fixed inset-0 z-50")
    expect(layer).toContain("md:hidden")
    // The back gesture has to cancel the choice rather than the form, which
    // means the layer owns a history entry.
    expect(layer).toContain("window.history.pushState")
    expect(layer).toContain("popstate")
    expect(layer).toContain("window.history.back()")
  })

  test("the picker and the calendar both use it", async () => {
    const picker = await source("./picker.tsx")
    const controls = await source("./controls.tsx")

    expect(picker).toContain("FullScreenLayer")
    expect(picker).toContain("useMediaQuery")
    // Desktop keeps the list under the field, where the pointer already is.
    expect(picker).toContain("open && wide")

    expect(controls).toContain("FullScreenLayer")
    expect(controls).toContain("relativeDays()")
    // And desktop keeps the popover.
    expect(controls).toContain("<Popover open={open}")
  })
})
