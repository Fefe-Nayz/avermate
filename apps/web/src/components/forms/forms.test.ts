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

  test("the primary action clears both the tab bar and the keyboard", async () => {
    const flow = await source("./form-flow.tsx")

    // Two ways to be unreachable: behind the z-40 tab bar, and behind the
    // keyboard, which does not shrink the viewport a fixed bar is placed in.
    expect(flow).toContain("useKeyboardInset")
    expect(flow).toContain("var(--spacing-tabbar) + var(--spacing-safe-bottom)")
    expect(flow).toContain("z-40")
    // Static again on desktop, where nothing needs pinning.
    expect(flow).toContain("md:static")
  })

  test("a focused field is pulled clear of the keyboard", async () => {
    const flow = await source("./form-flow.tsx")

    expect(flow).toContain("scrollIntoView({ block: \"center\"")
    // The document does not scroll; the shell scrolls a pane.
    expect(flow).toContain("closest(\".scroll-pane\")")
  })

  test("the keyboard inset is measured from the visual viewport", async () => {
    const hook = await source("../../hooks/use-keyboard-inset.ts")

    expect(hook).toContain("window.visualViewport")
    expect(hook).toContain("viewport.offsetTop")
    // A collapsing browser toolbar is not a keyboard.
    expect(hook).toContain("covered > 80")
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
    // A month that fills its card rather than floating in the middle of one.
    expect(controls).toContain('layout === "page" && !wide')
    expect(controls).toContain("[--cell-size:--spacing(10)]")
  })

  test("nothing saves before the last screen says so", async () => {
    const calendar = await source("../ui/calendar.tsx")

    // A day is a `<button>` inside a `<form>`. Without a type it defaults to
    // submit, and picking a date saved the grade.
    expect(calendar).toContain("type=\"button\"")

    // The optional last touches are asked for on the review screen, where the
    // only button is the one that saves.
    expect(await source("../grades/grade-form.tsx")).toContain("beforeSave={")
    expect(await source("../cards/card-form.tsx")).toContain("beforeSave={")
  })

  test("the calendar's month and year use this app's select", async () => {
    const calendar = await source("../ui/calendar.tsx")

    expect(calendar).toContain("Dropdown: ({ value, onChange, options")
    expect(calendar).toContain("<SelectTrigger")
    // The invisible native select the shadcn recipe overlays is gone.
    expect(calendar).not.toContain("absolute inset-0 bg-popover opacity-0")
  })

  test("the keyboard's next key moves through the flow", async () => {
    const flow = await source("./form-flow.tsx")
    const controls = await source("./controls.tsx")

    expect(flow).toContain("event.key !== \"Enter\" || wide")
    expect(flow).toContain("if (onReview) submit()")
    expect(controls).toContain("enterKeyHint=\"next\"")
  })

  test("a composite grade needs a part with a result in it", async () => {
    const form = await source("../grades/grade-form.tsx")

    // `rollUp` returns null when every part is blank, and the payload's
    // `?? 0` would have saved a mark of zero nobody typed.
    expect(form).toContain(
      "composite && components.length > 0 && effectiveValue === null"
    )
  })

  test("the number stepper is a pointer control", async () => {
    const controls = await source("./controls.tsx")

    expect(controls).toContain("ButtonGroup")
    // Hidden on a phone: the keypad is already there, and three of these
    // fields share a row.
    expect(controls).toContain("hidden size-9 shrink-0 md:inline-flex")
  })

  test("a step whose only job is choosing shows the list, not a way in", async () => {
    const picker = await source("./picker.tsx")
    expect(picker).toContain('layout === "page"')
    // Arriving with the keyboard already up would hide the very list the
    // step exists to show.
    expect(picker).toContain("searchBox(false)")

    // Every choice that is a step of its own is laid out that way.
    for (const path of [
      "../grades/grade-form.tsx",
      "../subjects/subject-form.tsx",
      "../goals/goal-form.tsx",
      "../cards/card-form.tsx",
    ]) {
      expect(await source(path)).toContain('layout="page"')
    }
  })
})
