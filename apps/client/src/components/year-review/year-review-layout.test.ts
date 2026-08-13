/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    calculateSafeRect,
    calculateYearReviewLayout,
    type Rect,
} from "./year-review-layout";

function assertContained(rect: Rect, container: Rect) {
    const epsilon = 1e-9;

    assert.ok(rect.x >= container.x - epsilon, `left edge ${rect.x} is outside ${container.x}`);
    assert.ok(rect.y >= container.y - epsilon, `top edge ${rect.y} is outside ${container.y}`);
    assert.ok(
        rect.x + rect.width <= container.x + container.width + epsilon,
        `right edge ${rect.x + rect.width} is outside ${container.x + container.width}`,
    );
    assert.ok(
        rect.y + rect.height <= container.y + container.height + epsilon,
        `bottom edge ${rect.y + rect.height} is outside ${container.y + container.height}`,
    );
}

function toViewportRect(rect: Rect, safeRect: Rect): Rect {
    return {
        ...rect,
        x: rect.x + safeRect.x,
        y: rect.y + safeRect.y,
    };
}

describe("calculateSafeRect", () => {
    it("preserves four asymmetric safe-area insets", () => {
        assert.deepEqual(calculateSafeRect({
            viewportWidth: 1200,
            viewportHeight: 800,
            insets: { top: 31, right: 17, bottom: 48, left: 73 },
        }), {
            x: 73,
            y: 31,
            width: 1110,
            height: 721,
        });
    });
});

describe("calculateYearReviewLayout", () => {
    it("keeps the canonical story and desktop controls in an asymmetric safe rect", () => {
        const viewportWidth = 1200;
        const viewportHeight = 800;
        const safeRect = calculateSafeRect({
            viewportWidth,
            viewportHeight,
            insets: { top: 31, right: 17, bottom: 48, left: 73 },
        });
        const layout = calculateYearReviewLayout({
            viewportWidth,
            safeAreaWidth: safeRect.width,
            safeAreaHeight: safeRect.height,
            zoom: 1,
        });

        assert.equal(layout.showNavButtons, true);
        assert.ok(Math.abs(layout.storyRect.width / layout.storyRect.height - 390 / 693) < 1e-12);
        assert.equal(layout.storyRect.x + layout.storyRect.width / 2, safeRect.width / 2);

        const localSafeRect = { x: 0, y: 0, width: safeRect.width, height: safeRect.height };
        assertContained(layout.storyRect, localSafeRect);
        assertContained(layout.closeButtonRect, localSafeRect);
        assert.ok(layout.previousButtonRect);
        assert.ok(layout.nextButtonRect);
        assertContained(layout.previousButtonRect, localSafeRect);
        assertContained(layout.nextButtonRect, localSafeRect);

        // Applying the safe frame's asymmetric offset keeps the same furniture
        // inside the global viewport-space safe rectangle.
        assertContained(toViewportRect(layout.closeButtonRect, safeRect), safeRect);
        assertContained(toViewportRect(layout.previousButtonRect, safeRect), safeRect);
        assertContained(toViewportRect(layout.nextButtonRect, safeRect), safeRect);
    });

    it("hides side navigation and contains the story and close control on mobile", () => {
        const safeRect = calculateSafeRect({
            viewportWidth: 430,
            viewportHeight: 932,
            insets: { top: 43, right: 0, bottom: 34, left: 0 },
        });
        const layout = calculateYearReviewLayout({
            viewportWidth: 430,
            safeAreaWidth: safeRect.width,
            safeAreaHeight: safeRect.height,
            zoom: 1,
        });

        assert.equal(layout.showNavButtons, false);
        assert.equal(layout.previousButtonRect, null);
        assert.equal(layout.nextButtonRect, null);
        assertContained(layout.storyRect, { x: 0, y: 0, width: safeRect.width, height: safeRect.height });
        assertContained(layout.closeButtonRect, { x: 0, y: 0, width: safeRect.width, height: safeRect.height });
    });

    it("shrinks furniture without allowing overflow in a constrained zoomed viewport", () => {
        const layout = calculateYearReviewLayout({
            viewportWidth: 80,
            safeAreaWidth: 52,
            safeAreaHeight: 76,
            zoom: 10,
        });
        const safeRect = { x: 0, y: 0, width: 52, height: 76 };

        assert.equal(layout.showNavButtons, true);
        assertContained(layout.storyRect, safeRect);
        assertContained(layout.closeButtonRect, safeRect);
        assert.ok(layout.previousButtonRect);
        assert.ok(layout.nextButtonRect);
        assertContained(layout.previousButtonRect, safeRect);
        assertContained(layout.nextButtonRect, safeRect);
    });
});
