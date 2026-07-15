const DEFAULT_MAX_SCALE = 4;
const ABSOLUTE_MAX_SCALE = 2048;

export function getAdaptiveMaxScale(viewBoxWidth, viewportWidth) {
  const ratio = safeRatio(viewBoxWidth, viewportWidth);
  return clamp(Math.ceil(ratio * 4), DEFAULT_MAX_SCALE, ABSOLUTE_MAX_SCALE);
}

export function getReadableObjectScale(options) {
  const {
    viewBoxWidth,
    viewportWidth,
    objectWidth = 100,
    targetPixels = 140,
    currentScale = 1
  } = options;
  const width = Math.max(1, Number(objectWidth) || 1);
  const readableScale = (targetPixels * safeRatio(viewBoxWidth, viewportWidth)) / width;
  return clamp(
    Math.max(currentScale, readableScale),
    1.8,
    getAdaptiveMaxScale(viewBoxWidth, viewportWidth)
  );
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
  minScale = 0.25
) {
  const oldScale = positiveNumber(transform?.scale, 1);
  const oldX = finiteNumber(transform?.x, 0);
  const oldY = finiteNumber(transform?.y, 0);
  const zoomStep = getZoomStep(viewBoxWidth, viewportWidth);
  const maxScale = getAdaptiveMaxScale(viewBoxWidth, viewportWidth);
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

export function getPannedTransform(transform, startClient, currentClient, viewBox, viewport) {
  const viewportWidth = positiveNumber(viewport?.width, 1);
  const viewportHeight = positiveNumber(viewport?.height, 1);
  const startX = finiteNumber(startClient?.x, 0);
  const startY = finiteNumber(startClient?.y, 0);
  const currentX = finiteNumber(currentClient?.x, startX);
  const currentY = finiteNumber(currentClient?.y, startY);
  return {
    ...transform,
    x: finiteNumber(transform?.x, 0) + ((currentX - startX) * viewBox.width) / viewportWidth,
    y: finiteNumber(transform?.y, 0) + ((currentY - startY) * viewBox.height) / viewportHeight
  };
}

export function clientPointToViewBox(client, viewport, viewBox) {
  const width = positiveNumber(viewport?.width, 1);
  const height = positiveNumber(viewport?.height, 1);
  return {
    x: viewBox.x + ((client.x - viewport.left) / width) * viewBox.width,
    y: viewBox.y + ((client.y - viewport.top) / height) * viewBox.height
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
