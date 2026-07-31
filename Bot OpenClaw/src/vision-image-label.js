'use strict';

const photon = require('@silvia-odwyer/photon-node');

const LABEL_HEIGHT = 80;
const MIN_VISION_WIDTH = 640;
const MIN_VISION_HEIGHT = 160;
const MAX_VISION_SIDE = 2048;

function targetDimensions(width, height) {
  const desiredScale = Math.max(
    1,
    MIN_VISION_WIDTH / width,
    MIN_VISION_HEIGHT / height,
  );
  const maxScale = MAX_VISION_SIDE / Math.max(width, height);
  const scale = Math.min(desiredScale, maxScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function labelImageForVision(bytes, index, total) {
  let source;
  let resized;
  let labeled;
  try {
    source = photon.PhotonImage.new_from_byteslice(bytes);
    const dimensions = targetDimensions(source.get_width(), source.get_height());
    const needsResize = dimensions.width !== source.get_width()
      || dimensions.height !== source.get_height();
    resized = needsResize
      ? photon.resize(
        source,
        dimensions.width,
        dimensions.height,
        photon.SamplingFilter.Lanczos3,
      )
      : source;

    // The label is part of the pixels, so OpenClaw cannot detach it from its image.
    const labelBackground = new photon.Rgba(15, 23, 42, 255);
    labeled = photon.padding_top(resized, LABEL_HEIGHT, labelBackground);
    const fontSize = Math.max(36, Math.min(56, Math.floor(dimensions.width / 12)));
    photon.draw_text_with_border(labeled, `ANH ${index}/${total}`, 20, 10, fontSize);

    return {
      bytes: Buffer.from(labeled.get_bytes_jpeg(90)),
      mime: 'image/jpeg',
    };
  } finally {
    labeled?.free();
    if (resized && resized !== source) {
      resized.free();
    }
    source?.free();
  }
}

module.exports = {
  labelImageForVision,
  targetDimensions,
};
