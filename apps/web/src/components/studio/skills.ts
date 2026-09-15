export type StudioSkill = { id: string; label: string; description: string; prompt: string; minImages: number; previewImage: string };

// These presets only prepare an editable prompt; submission uses the existing image workflow.
export const studioSkills: StudioSkill[] = [
  { id: 'id-photo', label: '证件照', description: '白底、正面、自然修复', minImages: 1, prompt: '将参考人像制作成白底证件照，保留人物真实五官，正面居中，光线均匀，边缘自然。', previewImage: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=640&q=80' },
  { id: 'remove-watermark', label: '去除水印', description: '背景智能修复', minImages: 1, prompt: '去除参考图中的水印，自然修复对应背景，保留其他画面内容和细节。', previewImage: 'https://images.unsplash.com/photo-1518005020951-eccb494ad742?w=640&q=80' },
  { id: 'collage', label: '拼图', description: '多图组合与排版', minImages: 2, prompt: '将参考图片组合成一张拼图，完整保留各图主体，统一间距、边框和整体色调。', previewImage: 'https://images.unsplash.com/photo-1549490349-8643362247b5?w=640&q=80' }
];
