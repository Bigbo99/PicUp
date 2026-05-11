import { Injectable } from '@nestjs/common';
import { copyFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { ensureStorage, publicMediaUrl } from '../../common/storage-paths';
import type { ImageProvider, ProviderImageInput, ProviderImageResult } from './provider.types';

@Injectable()
export class MockProvider implements ImageProvider {
  async generate(input: ProviderImageInput): Promise<ProviderImageResult> {
    const paths = await ensureStorage();

    if (input.images.length > 0) {
      const source = input.images[0];
      const sourceName = source.url.split('/').pop();
      if (!sourceName) throw new Error('输入图片不存在');
      const extension = extname(sourceName) || '.png';
      const outputName = `${input.jobId}-mock${extension}`;
      await copyFile(resolve(paths.inputs, sourceName), resolve(paths.outputs, outputName));
      return {
        images: [{ url: publicMediaUrl('outputs', outputName), mimeType: source.mimeType }],
        textOutputs: [`Mock 已完成：${input.prompt}`]
      };
    }

    const outputName = `${input.jobId}-mock.svg`;
    const svg = this.createSvg(input);
    await writeFile(resolve(paths.outputs, outputName), svg, 'utf8');
    return {
      images: [{ url: publicMediaUrl('outputs', outputName), mimeType: 'image/svg+xml', width: 1024, height: 1024 }],
      textOutputs: [`Mock 已完成：${input.prompt}`]
    };
  }

  private createSvg(input: ProviderImageInput) {
    const safePrompt = input.prompt.replace(/[<>&"]/g, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#F8FAFC"/>
  <rect x="80" y="80" width="864" height="864" rx="32" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="3"/>
  <circle cx="812" cy="204" r="72" fill="#14B8A6"/>
  <rect x="150" y="250" width="520" height="54" rx="16" fill="#1F2937"/>
  <rect x="150" y="336" width="620" height="28" rx="14" fill="#CBD5E1"/>
  <rect x="150" y="394" width="470" height="28" rx="14" fill="#CBD5E1"/>
  <rect x="150" y="520" width="724" height="300" rx="24" fill="#EEF2FF"/>
  <text x="150" y="170" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#111827">PicUp Mock Result</text>
  <text x="150" y="882" font-family="Arial, sans-serif" font-size="24" fill="#475569">${safePrompt.slice(0, 58)}</text>
</svg>`;
  }
}
