import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export async function hasTransparency(image: Buffer) {
  const { data, info } = await sharp(image, { limitInputPixels: 32_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = info.channels - 1; i < data.length; i += info.channels) {
    if (data[i] < 255) return true;
  }
  return false;
}

// Removal may change selected content, but cannot paint over existing transparency.
export async function compositeRemoval(original: Buffer, mask: Buffer, generated: Buffer) {
  await validateEditMask(original, mask);
  const { data: source, info } = await sharp(original).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const metadata = await sharp(generated, { limitInputPixels: 32_000_000 }).metadata();
  if (!metadata.width || !metadata.height || Math.abs(metadata.width / metadata.height - info.width / info.height) > 0.005) {
    throw new Error('消除结果比例与原图不一致，无法安全合成');
  }
  const output = await sharp(generated).resize(info.width, info.height, { fit: 'fill' }).toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const selection = await sharp(mask).extractChannel('alpha').raw().toBuffer();
  for (let pixel = 0; pixel < selection.length; pixel++) {
    const offset = pixel * 4;
    if (selection[pixel] !== 0 || source[offset + 3] === 0) {
      source.copy(output, offset, offset, offset + 4);
    } else {
      output[offset + 3] = Math.min(output[offset + 3], source[offset + 3]);
    }
  }
  return { body: await sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer(), width: info.width, height: info.height };
}

export async function validateEditMask(original: Buffer, mask: Buffer) {
  try {
    const source = await sharp(original, { limitInputPixels: 32_000_000 }).metadata();
    const selection = await sharp(mask, { limitInputPixels: 32_000_000 }).metadata();
    if (source.format !== 'png' || selection.format !== 'png' || !selection.hasAlpha || source.width !== selection.width || source.height !== selection.height) throw new Error();
    const alpha = await sharp(mask).extractChannel('alpha').raw().toBuffer();
    if (!alpha.some(value => value === 0)) throw new Error();
  } catch {
    throw new BadRequestException('蒙版必须是与原图同尺寸的 PNG，并包含透明选区');
  }
}
