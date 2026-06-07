import { Inject, Injectable } from '@nestjs/common';
import { extname } from 'node:path';
import { ObjectStorageService } from '../../common/object-storage.service';
import type { ImageProvider, ProviderImageInput, ProviderImageResult } from './provider.types';

@Injectable()
export class MockProvider implements ImageProvider {
  constructor(@Inject(ObjectStorageService) private readonly objectStorage: ObjectStorageService) {}

  async generate(input: ProviderImageInput): Promise<ProviderImageResult> {
    if (input.images.length > 0) {
      const source = input.images[0];
      const sourceName = this.objectStorage.filenameFromUrl(source.url);
      const extension = extname(sourceName) || '.png';
      const outputName = `${input.jobId}-mock${extension}`;
      const buffer = await this.objectStorage.readByUrl(source.url);
      const url = await this.objectStorage.save('outputs', outputName, buffer, source.mimeType);
      return {
        images: [{ url, mimeType: source.mimeType }],
        textOutputs: [`Mock completed: ${input.prompt}`]
      };
    }

    const outputName = `${input.jobId}-mock.svg`;
    const svg = this.createSvg(input);
    const url = await this.objectStorage.save('outputs', outputName, Buffer.from(svg, 'utf8'), 'image/svg+xml');
    return {
      images: [{ url, mimeType: 'image/svg+xml', width: 1024, height: 1024 }],
      textOutputs: [`Mock completed: ${input.prompt}`]
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
