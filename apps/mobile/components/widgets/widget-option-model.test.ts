import { describe, expect, test } from "bun:test";
import { widgetFieldOptions } from "./widget-option-model";

describe("widget field options", () => {
  test("keeps the options filtered by resolveWidgetFlow", () => {
    const resolved = [{ value: "category", messageKey: "Category" }];
    const supplied = [{ value: "value", messageKey: "Value" }];

    expect(
      widgetFieldOptions(
        { options: resolved, optionProvider: "encoding-fields" },
        { "encoding-fields": supplied },
      ),
    ).toEqual(resolved);
  });

  test("resolves providers for nested collection descriptors", () => {
    const subjects = [{ value: "math", messageKey: "Mathematics" }];
    expect(
      widgetFieldOptions({ optionProvider: "subjects" }, { subjects }),
    ).toEqual(subjects);
  });
});
