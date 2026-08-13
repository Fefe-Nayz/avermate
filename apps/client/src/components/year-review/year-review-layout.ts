export const YEAR_REVIEW_CANONICAL_WIDTH = 390;
export const YEAR_REVIEW_CANONICAL_HEIGHT = 693;

const NAV_BUTTON_SIZE_BASE = 70;
const CLOSE_BUTTON_SIZE_BASE = 32;
const BUTTON_GAP_BASE = 16;
const CLOSE_BUTTON_GAP_BASE = 12;
const MIN_MARGIN_BASE = 20;
const NAV_BUTTON_HIDE_THRESHOLD = 600;

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SafeAreaInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface CalculateSafeRectInput {
    viewportWidth: number;
    viewportHeight: number;
    insets: SafeAreaInsets;
}

interface CalculateYearReviewLayoutInput {
    viewportWidth: number;
    safeAreaWidth: number;
    safeAreaHeight: number;
    zoom: number;
}

export interface YearReviewLayout {
    safeAreaWidth: number;
    safeAreaHeight: number;
    storyScale: number;
    storyRect: Rect;
    closeButtonRect: Rect;
    previousButtonRect: Rect | null;
    nextButtonRect: Rect | null;
    showNavButtons: boolean;
}

function finiteNonNegative(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteZoom(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.min(10, Math.max(0.1, value));
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Converts four independent (and potentially asymmetric) insets into the
 * rectangle in which interactive UI may be placed.
 */
export function calculateSafeRect({
    viewportWidth,
    viewportHeight,
    insets,
}: CalculateSafeRectInput): Rect {
    const width = finiteNonNegative(viewportWidth);
    const height = finiteNonNegative(viewportHeight);
    const left = Math.min(finiteNonNegative(insets.left), width);
    const top = Math.min(finiteNonNegative(insets.top), height);
    const right = Math.min(finiteNonNegative(insets.right), width - left);
    const bottom = Math.min(finiteNonNegative(insets.bottom), height - top);

    return {
        x: left,
        y: top,
        width: width - left - right,
        height: height - top - bottom,
    };
}

/**
 * Lays out the canonical story and its furniture in safe-area-local
 * coordinates. Every returned rectangle is contained by the safe area.
 */
export function calculateYearReviewLayout({
    viewportWidth,
    safeAreaWidth,
    safeAreaHeight,
    zoom: rawZoom,
}: CalculateYearReviewLayoutInput): YearReviewLayout {
    const width = finiteNonNegative(safeAreaWidth);
    const height = finiteNonNegative(safeAreaHeight);
    const zoom = finiteZoom(rawZoom);
    const physicalViewportWidth = finiteNonNegative(viewportWidth) * zoom;
    const showNavButtons = physicalViewportWidth >= NAV_BUTTON_HIDE_THRESHOLD && width > 0 && height > 0;

    const targetNavButtonSize = NAV_BUTTON_SIZE_BASE / zoom;
    const targetCloseButtonSize = CLOSE_BUTTON_SIZE_BASE / zoom;
    const targetButtonGap = BUTTON_GAP_BASE / zoom;
    const targetCloseButtonGap = CLOSE_BUTTON_GAP_BASE / zoom;
    const targetMinimumMargin = MIN_MARGIN_BASE / zoom;

    // The caps only affect extremely constrained viewports. They preserve room
    // for the canonical story while ensuring every control remains in bounds.
    const navButtonSize = showNavButtons
        ? Math.min(targetNavButtonSize, height, width / 4)
        : 0;
    const widthAfterNavButtons = Math.max(0, width - navButtonSize * 2);
    const buttonGap = showNavButtons
        ? Math.min(targetButtonGap, widthAfterNavButtons / 6)
        : 0;
    const horizontalFurniture = showNavButtons
        ? (navButtonSize + buttonGap) * 2
        : 0;
    const horizontalCore = Math.max(0, width - horizontalFurniture);
    const sideMargin = Math.min(
        Math.max(width * 0.05, targetMinimumMargin),
        horizontalCore / 4,
    );

    const closeButtonSize = Math.min(targetCloseButtonSize, width, height / 4);
    const heightAfterCloseButton = Math.max(0, height - closeButtonSize);
    const closeButtonGap = Math.min(targetCloseButtonGap, heightAfterCloseButton / 4);
    const verticalCore = Math.max(0, height - closeButtonSize - closeButtonGap);
    const verticalMargin = Math.min(
        Math.max(height * 0.05, targetMinimumMargin),
        verticalCore / 4,
    );

    const availableStoryWidth = Math.max(0, horizontalCore - sideMargin * 2);
    const availableStoryHeight = Math.max(0, verticalCore - verticalMargin * 2);
    const storyScale = Math.max(0, Math.min(
        availableStoryWidth / YEAR_REVIEW_CANONICAL_WIDTH,
        availableStoryHeight / YEAR_REVIEW_CANONICAL_HEIGHT,
    ));
    const storyWidth = YEAR_REVIEW_CANONICAL_WIDTH * storyScale;
    const storyHeight = YEAR_REVIEW_CANONICAL_HEIGHT * storyScale;

    const storyX = (width - storyWidth) / 2;
    const furnitureHeight = closeButtonSize + closeButtonGap + storyHeight;
    const closeButtonY = (height - furnitureHeight) / 2;
    const storyY = closeButtonY + closeButtonSize + closeButtonGap;
    const closeButtonX = clamp(
        storyX + storyWidth - closeButtonSize,
        0,
        Math.max(0, width - closeButtonSize),
    );

    const storyRect: Rect = {
        x: storyX,
        y: storyY,
        width: storyWidth,
        height: storyHeight,
    };
    const closeButtonRect: Rect = {
        x: closeButtonX,
        y: closeButtonY,
        width: closeButtonSize,
        height: closeButtonSize,
    };

    if (!showNavButtons) {
        return {
            safeAreaWidth: width,
            safeAreaHeight: height,
            storyScale,
            storyRect,
            closeButtonRect,
            previousButtonRect: null,
            nextButtonRect: null,
            showNavButtons,
        };
    }

    const navButtonY = clamp(
        storyY + (storyHeight - navButtonSize) / 2,
        0,
        Math.max(0, height - navButtonSize),
    );

    return {
        safeAreaWidth: width,
        safeAreaHeight: height,
        storyScale,
        storyRect,
        closeButtonRect,
        previousButtonRect: {
            x: storyX - buttonGap - navButtonSize,
            y: navButtonY,
            width: navButtonSize,
            height: navButtonSize,
        },
        nextButtonRect: {
            x: storyX + storyWidth + buttonGap,
            y: navButtonY,
            width: navButtonSize,
            height: navButtonSize,
        },
        showNavButtons,
    };
}
