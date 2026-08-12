"use client";

import * as React from "react";
import type { BreadcrumbMeasurements } from "./types";

const EMPTY_MEASUREMENTS: BreadcrumbMeasurements = {
  containerWidth: 0,
  itemWidths: [],
  separatorWidths: [],
  ellipsisWidth: 0,
  nextArrowWidth: 0,
  titleOnlyWidth: 0,
  gap: 0,
  ready: false,
  signature: "empty",
};

export function useBreadcrumbMeasurements({
  containerRef,
  measureRef,
  locked,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  measureRef: React.RefObject<HTMLElement | null>;
  locked: boolean;
}) {
  const frameRef = React.useRef<number | null>(null);
  const lastSignatureRef = React.useRef("empty");
  const [measurements, setMeasurements] =
    React.useState<BreadcrumbMeasurements>(EMPTY_MEASUREMENTS);

  const measure = React.useCallback(() => {
    if (locked) {
      return;
    }

    const container = containerRef.current;
    const measureRoot = measureRef.current;

    if (!container || !measureRoot) {
      return;
    }

    const itemWidths = readIndexedWidths(measureRoot, "measureItem");
    const separatorWidths = readIndexedWidths(measureRoot, "measureSeparator");
    const ellipsisWidth = readSingleWidth(measureRoot, "measureEllipsis");
    const nextArrowWidth = readSingleWidth(measureRoot, "measureNext");
    const titleOnlyWidth = readSingleWidth(measureRoot, "measureTitleOnly");
    const containerWidth = container.getBoundingClientRect().width;
    const gapSource =
      measureRoot.querySelector<HTMLElement>('[data-measure-list="full"]') ??
      measureRoot;
    const gap = readFlexGap(gapSource);
    const signature = [
      round(containerWidth),
      itemWidths.map(round).join(","),
      separatorWidths.map(round).join(","),
      round(ellipsisWidth),
      round(nextArrowWidth),
      round(titleOnlyWidth),
      round(gap),
    ].join("|");

    if (signature === lastSignatureRef.current) {
      return;
    }

    lastSignatureRef.current = signature;
    setMeasurements({
      containerWidth,
      itemWidths,
      separatorWidths,
      ellipsisWidth,
      nextArrowWidth,
      titleOnlyWidth,
      gap,
      ready: itemWidths.length > 0,
      signature,
    });
  }, [containerRef, locked, measureRef]);

  const scheduleMeasure = React.useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  React.useLayoutEffect(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    measure();

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  });

  React.useLayoutEffect(() => {
    if (locked) {
      return;
    }

    const container = containerRef.current;
    const measureRoot = measureRef.current;

    if (!container || !measureRoot || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => scheduleMeasure());
    observer.observe(container);
    observer.observe(measureRoot);

    return () => observer.disconnect();
  }, [containerRef, locked, measureRef, scheduleMeasure]);

  React.useEffect(() => {
    if (!("fonts" in document)) {
      return;
    }

    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) {
        scheduleMeasure();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [scheduleMeasure]);

  return measurements;
}

function readIndexedWidths(root: HTMLElement, dataKey: string) {
  const selector = `[data-${toKebabCase(dataKey)}]`;
  const widths: number[] = [];

  root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const index = Number(element.dataset[dataKey]);
    if (!Number.isFinite(index)) {
      return;
    }

    widths[index] = element.getBoundingClientRect().width;
  });

  return widths.map((width) => width ?? 0);
}

function readSingleWidth(root: HTMLElement, dataKey: string) {
  const selector = `[data-${toKebabCase(dataKey)}]`;
  const element = root.querySelector<HTMLElement>(selector);
  return element?.getBoundingClientRect().width ?? 0;
}

function readFlexGap(element: HTMLElement) {
  const styles = window.getComputedStyle(element);
  return firstFiniteNumber(styles.columnGap, styles.gap, styles.rowGap);
}

function firstFiniteNumber(...values: string[]) {
  for (const value of values) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function toKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
