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
