const MINIMUM_MAX_SCALE = 2;
const MAX_CELL_MAGNIFICATION = 2;

export function getAdaptiveMaxScale(viewBoxWidth, viewportWidth, viewBoxHeight, viewportHeight) {
  const ratio = getViewportUnitRatio(viewBoxWidth, viewportWidth, viewBoxHeight, viewportHeight);
  return Math.max(MINIMUM_MAX_SCALE, ratio * MAX_CELL_MAGNIFICATION);
}

export function getReadableObjectScale(options) {
  const {
    viewBoxWidth,
    viewportWidth,
    viewBoxHeight,
    viewportHeight,
    objectWidth = 100,
    targetPixels = 140,
    currentScale = 1
  } = options;
  const width = Math.max(1, Number(objectWidth) || 1);
  const readableScale = (
    targetPixels * getViewportUnitRatio(viewBoxWidth, viewportWidth, viewBoxHeight, viewportHeight)
  ) / width;
  return clamp(
    Math.max(currentScale, readableScale),
    1.8,
    getAdaptiveMaxScale(viewBoxWidth, viewportWidth, viewBoxHeight, viewportHeight)
  );
}

export function getFocusedObjectTransform(options) {
  const viewBoxWidth = positiveNumber(options?.viewBox?.width, 1);
  const viewBoxHeight = positiveNumber(options?.viewBox?.height, 1);
  const viewportWidth = positiveNumber(options?.viewportWidth, 1);
  const viewportHeight = Number(options?.viewportHeight);
  const objectWidth = positiveNumber(options?.bounds?.width, 1);
  const targetPixels = positiveNumber(options?.targetPixels, 320);
  const minimumScale = positiveNumber(options?.minimumScale, 0.25);
  const maximumScale = positiveNumber(
    options?.maximumScale,
    getAdaptiveMaxScale(viewBoxWidth, viewportWidth, viewBoxHeight, viewportHeight)
  );
  const scale = clamp(
    (
      targetPixels * getViewportUnitRatio(
        viewBoxWidth,
        viewportWidth,
        viewBoxHeight,
        viewportHeight
      )
    ) / objectWidth,
    Math.min(minimumScale, maximumScale),
    Math.max(minimumScale, maximumScale)
  );
  const centerX = finiteNumber(options?.bounds?.x, 0) + objectWidth / 2;
  const centerY = finiteNumber(options?.bounds?.y, 0) + positiveNumber(options?.bounds?.height, 1) / 2;
  return {
    x: finiteNumber(options?.viewBox?.x, 0) + viewBoxWidth / 2 - centerX * scale,
    y: finiteNumber(options?.viewBox?.y, 0) + viewBoxHeight / 2 - centerY * scale,
    scale
  };
}

export function getZoomStep(viewBoxWidth, viewportWidth) {
  const ratio = safeRatio(viewBoxWidth, viewportWidth);
  if (ratio >= 100) {
    return 1.5;
  }
  if (ratio >= 20) {
    return 1.3;
  }
  return 1.12;
}

export function getZoomedTransform(
  transform,
  point,
  deltaY,
  viewBoxWidth,
  viewportWidth,
  minScale = 0.25,
  viewBoxHeight,
  viewportHeight
) {
  const oldScale = positiveNumber(transform?.scale, 1);
  const oldX = finiteNumber(transform?.x, 0);
  const oldY = finiteNumber(transform?.y, 0);
  const zoomStep = getZoomStep(viewBoxWidth, viewportWidth);
  const maxScale = getAdaptiveMaxScale(
    viewBoxWidth,
    viewportWidth,
    viewBoxHeight,
    viewportHeight
  );
  const nextScale = clamp(
    oldScale * (deltaY < 0 ? zoomStep : 1 / zoomStep),
    minScale,
    maxScale
  );
  const ratio = nextScale / oldScale;
  return {
    x: point.x - (point.x - oldX) * ratio,
    y: point.y - (point.y - oldY) * ratio,
    scale: nextScale
  };
}

export function getSteppedZoomedTransform(
  transform,
  point,
  steps,
  viewBoxWidth,
  viewportWidth,
  minScale = 0.25,
  viewBoxHeight,
  viewportHeight
) {
  const direction = steps < 0 ? -1 : 1;
  const count = Math.abs(Math.trunc(steps));
  let next = transform;
  for (let index = 0; index < count; index += 1) {
    const candidate = getZoomedTransform(
      next,
      point,
      direction,
      viewBoxWidth,
      viewportWidth,
      minScale,
      viewBoxHeight,
      viewportHeight
    );
    if (candidate.scale === next.scale) break;
    next = candidate;
  }
  return next;
}

export function getPannedTransform(transform, startClient, currentClient, viewBox, viewport) {
  const viewportWidth = positiveNumber(viewport?.width, 1);
  const viewportHeight = positiveNumber(viewport?.height, 1);
  const viewBoxWidth = positiveNumber(viewBox?.width, viewportWidth);
  const viewBoxHeight = positiveNumber(viewBox?.height, viewportHeight);
  const viewportUnitRatio = getViewportUnitRatio(
    viewBoxWidth,
    viewportWidth,
    viewBoxHeight,
    viewportHeight
  );
  const startX = finiteNumber(startClient?.x, 0);
  const startY = finiteNumber(startClient?.y, 0);
  const currentX = finiteNumber(currentClient?.x, startX);
  const currentY = finiteNumber(currentClient?.y, startY);
  return {
    ...transform,
    x: finiteNumber(transform?.x, 0) + (currentX - startX) * viewportUnitRatio,
    y: finiteNumber(transform?.y, 0) + (currentY - startY) * viewportUnitRatio
  };
}

export function clientPointToViewBox(client, viewport, viewBox) {
  const viewportWidth = positiveNumber(viewport?.width, 1);
  const viewportHeight = positiveNumber(viewport?.height, 1);
  const viewBoxWidth = positiveNumber(viewBox?.width, viewportWidth);
  const viewBoxHeight = positiveNumber(viewBox?.height, viewportHeight);
  const viewportUnitRatio = getViewportUnitRatio(
    viewBoxWidth,
    viewportWidth,
    viewBoxHeight,
    viewportHeight
  );
  const horizontalInset = (viewportWidth - viewBoxWidth / viewportUnitRatio) / 2;
  const verticalInset = (viewportHeight - viewBoxHeight / viewportUnitRatio) / 2;
  return {
    x: finiteNumber(viewBox?.x, 0) +
      (finiteNumber(client?.x, 0) - finiteNumber(viewport?.left, 0) - horizontalInset) * viewportUnitRatio,
    y: finiteNumber(viewBox?.y, 0) +
      (finiteNumber(client?.y, 0) - finiteNumber(viewport?.top, 0) - verticalInset) * viewportUnitRatio
  };
}

export function formatViewportTransform(transform) {
  return `translate(${round(transform.x)} ${round(transform.y)}) scale(${round(transform.scale)})`;
}

function safeRatio(viewBoxWidth, viewportWidth) {
  const rawViewportWidth = Number(viewportWidth);
  const width = Number.isFinite(rawViewportWidth) && rawViewportWidth > 0 ? rawViewportWidth : 1;
  const rawViewBoxWidth = Number(viewBoxWidth);
  const graphWidth = Number.isFinite(rawViewBoxWidth) && rawViewBoxWidth > 0 ? rawViewBoxWidth : width;
  return Math.max(1, graphWidth / width);
}

function getViewportUnitRatio(viewBoxWidth, viewportWidth, viewBoxHeight, viewportHeight) {
  const hasHeightRatio = Number.isFinite(Number(viewBoxHeight)) && Number(viewBoxHeight) > 0 &&
    Number.isFinite(Number(viewportHeight)) && Number(viewportHeight) > 0;
  return Math.max(
    safeRatio(viewBoxWidth, viewportWidth),
    hasHeightRatio ? safeRatio(viewBoxHeight, viewportHeight) : 1
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
